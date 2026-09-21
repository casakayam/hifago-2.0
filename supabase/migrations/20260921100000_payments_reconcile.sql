-- Lot B — la réconciliation Mercado Pago PILOTE l'expiration (D1), libère les cupos (D1-bis),
-- borne les paiements en attente (D2) et prépare le remboursement (D3). Spec :
-- docs/specs/39-garantie-confirmation-paiement.md (§0 contrat compact). Arbitrage Jérôme du
-- 2026-09-20 ; réalisation relue par un agent réfuteur (12 failles intégrées, journal du jour).
--
-- Ce que ça change : plus RIEN n'expire une commande sans avoir demandé à Mercado Pago (sauf une
-- commande sans aucun `payments` — aucune préférence n'a jamais existé). Le job
-- `payments-reconcile` (pg_cron */2 → Edge Function → MP → RPC sous verrou) remplace
-- `expire_stale_payment_orders` (retirée par la migration de bascule 20260921100100). Échec fermé :
-- MP injoignable, identité du token non prouvée, horodatage de contrôle périmé ⇒ rien n'expire.
--
-- Ordre des verrous, partout : `orders` d'abord (règle 8 de .claude/rules/supabase.md), puis les
-- lignes en bloc, puis les lignes de capacité dans l'ordre de create_order (product_availability →
-- provider_resource_calendar → product_slot_availability), puis les écritures.
--
-- Grants : `revoke all … from public, anon, authenticated` sur TOUTES les fonctions de ce fichier
-- (un `revoke from public` seul est inopérant sur Supabase — service_role_only_functions.test.sql),
-- `grant … to service_role` pour celles que l'Edge Function appelle. Toutes listées dans ce test.

-- ============================================================================================
-- 1. Colonnes, contraintes, index
-- ============================================================================================
alter table public.payments
  add column mp_preference_id text,
  add column mp_collector_id text,
  add column mp_last_status text,
  add column mp_last_checked_at timestamptz,
  add column mp_cancel_attempts int not null default 0;

alter table public.payments drop constraint payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back'));

alter table public.orders
  add column reconcile_claimed_at timestamptz,
  add column reconcile_checked_at timestamptz;

create index orders_awaiting_payment_idx
  on public.orders (created_at)
  where payment_status in ('unpaid', 'pending');

alter table public.payment_reconciliation_entries
  add column reason_code text
    check (reason_code in ('paid_after_expiry', 'double_payment', 'amount_mismatch',
                           'refunded_externally', 'charged_back'));

alter table public.payment_reconciliation_entries drop constraint payment_reconciliation_entries_kind_check;
alter table public.payment_reconciliation_entries
  add constraint payment_reconciliation_entries_kind_check
  check (kind in ('webhook_failure', 'refund_required', 'refunded_externally'));

-- Deux livraisons MP d'un même remboursement externe = une entrée ; un retry MP en boucle sur un
-- webhook en échec (500 pendant une bascule mal ordonnée) = une entrée par motif, pas une par
-- livraison — la « bombe d'e-mails » du 2026-09-20 est bornée structurellement.
create unique index payment_reconciliation_entries_refunded_externally_mp_payment_idx
  on public.payment_reconciliation_entries (mp_payment_id)
  where kind = 'refunded_externally';
-- ⚠️ La préprod porte déjà des doublons de ce type (les 8 livraisons `SignatureMismatch` du
-- 2026-09-20, plusieurs pour le même data.id) : avant de poser l'index, on résout les doublons
-- ouverts en ne gardant que la première livraison — rien n'est supprimé, la note dit pourquoi.
with ranked as (
  select id,
         row_number() over (partition by mp_payment_id, failure_reason order by created_at, id) as rn
    from public.payment_reconciliation_entries
   where kind = 'webhook_failure' and status in ('open', 'retrying') and mp_payment_id is not null
)
update public.payment_reconciliation_entries e
   set status = 'resolved',
       resolution_note = 'Doublon de livraison Mercado Pago (même data.id, même motif) — dédupliqué par la migration 20260921100000, la première livraison reste ouverte.',
       resolved_at = now()
  from ranked
 where e.id = ranked.id and ranked.rn > 1;

create unique index payment_reconciliation_entries_webhook_failure_idx
  on public.payment_reconciliation_entries (mp_payment_id, failure_reason)
  where kind = 'webhook_failure' and status in ('open', 'retrying');

alter table public.notification_emails drop constraint notification_emails_event_type_check;
alter table public.notification_emails
  add constraint notification_emails_event_type_check
  check (event_type in (
    'partner_invitation', 'admin_new_proposal', 'admin_new_reconciliation_exception',
    'partner_proposal_decided', 'partner_commission_earned', 'partner_payment_confirmed',
    'client_order_confirmed', 'partner_camp_evento_blocked',
    -- Lot B (spec 39 §5) : 9 client payé sans prestation, 10 double paiement, 11 job arrêté.
    'client_payment_received_not_honored', 'client_duplicate_payment_refund', 'admin_job_stalled'
  ));

-- ============================================================================================
-- 2. job_heartbeats — premier heartbeat de cron du dépôt (aucun n'existait : net._http_response lu
--    à la main était « le seul canal de supervision »). Un job qui garantit un encaissement ne peut
--    pas tourner à vide en silence comme les crons PMS du 19 au 27/08.
-- ============================================================================================
create table public.job_heartbeats (
  job_name text primary key,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  stats jsonb not null default '{}'::jsonb,
  alerted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.job_heartbeats enable row level security;
revoke insert, update, delete on public.job_heartbeats from authenticated, anon;
grant select on public.job_heartbeats to authenticated;
create policy job_heartbeats_select_admin on public.job_heartbeats
  for select using ((select public.is_admin((select auth.uid()))));
insert into public.job_heartbeats (job_name) values ('payments-reconcile');

create function public.heartbeat_job(
  p_job text, p_ok boolean, p_stats jsonb default '{}'::jsonb, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_heartbeats as h (job_name, last_run_at, last_ok_at, last_error, stats)
  values (p_job, now(), case when p_ok then now() end, case when p_ok then null else left(p_error, 500) end, coalesce(p_stats, '{}'::jsonb))
  on conflict (job_name) do update
    set last_run_at = now(),
        last_ok_at = case when p_ok then now() else h.last_ok_at end,
        last_error = case when p_ok then null else left(p_error, 500) end,
        stats = coalesce(p_stats, '{}'::jsonb);
end;
$$;
revoke all on function public.heartbeat_job(text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.heartbeat_job(text, boolean, jsonb, text) to service_role;

-- ============================================================================================
-- 3. payment_refunds — table posée ici (apply_payment_webhook la lit pour reconnaître NOTRE
--    remboursement), RPC en B2 (20260922100000). RPC-only.
-- ============================================================================================
create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.payment_reconciliation_entries(id),
  payment_id uuid references public.payments(id),
  -- Le remboursement vise le paiement MP de l'ENTRÉE, jamais la ligne `payments` : sur un écart de
  -- montant ou un double paiement, `payments.mp_payment_id` porte un autre paiement (ou rien).
  mp_payment_id text not null,
  amount_cop bigint not null check (amount_cop > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  mp_refund_id text,
  raw_response jsonb,
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  requested_by uuid references public.partner_accounts(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payment_refunds_one_live_per_entry_idx
  on public.payment_refunds (entry_id) where status in ('pending', 'approved');
create index payment_refunds_pending_idx on public.payment_refunds (next_attempt_at) where status = 'pending';
alter table public.payment_refunds enable row level security;
revoke insert, update, delete on public.payment_refunds from authenticated, anon;
grant select on public.payment_refunds to authenticated;
create policy payment_refunds_select_admin on public.payment_refunds
  for select using ((select public.is_admin((select auth.uid()))));

-- ============================================================================================
-- 4. Drapeaux de capacité gelés tant qu'une ligne est réservée (spec 39 §10.1). La libération
--    (ci-dessous) doit pouvoir se fier à `lobby_category_id`/`evento_capacity_mode` de la ligne
--    au moment où elle a été prise ; les geler est le seul moyen sans dupliquer ces faits sur
--    order_lines (ce qui rouvrirait create_order).
-- ============================================================================================
create function public.products_capacity_flags_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.lobby_category_id is distinct from old.lobby_category_id
      or new.evento_capacity_mode is distinct from old.evento_capacity_mode
      or new.evento_occupies_resource is distinct from old.evento_occupies_resource)
     and exists (
       select 1 from public.order_lines ol where ol.product_id = new.id and ol.status = 'reserved'
     ) then
    raise exception 'capacity_flags_frozen_while_reserved'
      using detail = 'Ce produit porte des réservations en cours : lobby_category_id, evento_capacity_mode et evento_occupies_resource ne peuvent pas changer tant qu''elles ne sont pas réalisées ou annulées.';
  end if;
  return new;
end;
$$;
create trigger products_capacity_flags_frozen
  before update of lobby_category_id, evento_capacity_mode, evento_occupies_resource on public.products
  for each row execute function public.products_capacity_flags_frozen();

-- ============================================================================================
-- 5. Libération des places — UNE implémentation (D1-bis), miroir de create_order d'aujourd'hui
--    (20260915130000 l.632-636, 658-661, 709-710, 773-790). Décide sur des FAITS de la ligne :
--    la ressource partagée se lit dans availability_blocks (posé par create_order pour un camp OU
--    un evento occupant), jamais dans un drapeau produit relu après coup — la version PMS
--    (20260829100000 l.109) ne rendait la ressource que pour `camp`, dérive corrigée ici.
-- ============================================================================================
create function public.lock_order_capacity_rows(p_line_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  -- Même ordre de tables que create_order (l.303-356) : product_availability →
  -- provider_resource_calendar → product_slot_availability, chaque ensemble trié.
  for v_row in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select ol.product_id, ol.date
         from public.order_lines ol
        where ol.id = any(p_line_ids) and ol.end_date is null and ol.slot_start_time is null
       union
       select ol.product_id, (ol.date + gs)::date
         from public.order_lines ol
         cross join lateral generate_series(0, (ol.end_date - ol.date) - 1) as gs
        where ol.id = any(p_line_ids) and ol.end_date is not null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  for v_row in
    select prc.establishment_id, prc.slot_date
      from public.provider_resource_calendar prc
     where (prc.establishment_id, prc.slot_date) in (
       select ab.establishment_id, (ab.start_date + gs)::date
         from public.availability_blocks ab
         cross join lateral generate_series(0, ab.end_date - ab.start_date) as gs
        where ab.source_order_line_id = any(p_line_ids)
     )
     order by prc.establishment_id, prc.slot_date
     for update
  loop
    null;
  end loop;

  for v_row in
    select psa.product_id, psa.slot_date, psa.slot_start_time
      from public.product_slot_availability psa
     where (psa.product_id, psa.slot_date, psa.slot_start_time) in (
       select ol.product_id, ol.date, ol.slot_start_time
         from public.order_lines ol
        where ol.id = any(p_line_ids) and ol.slot_start_time is not null
     )
     order by psa.product_id, psa.slot_date, psa.slot_start_time
     for update
  loop
    null;
  end loop;
end;
$$;
revoke all on function public.lock_order_capacity_rows(uuid[]) from public, anon, authenticated;

create function public.release_order_line_capacity(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_block record;
begin
  select ol.id, ol.product_id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, p.lobby_category_id
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_line_id;
  if not found then
    return;
  end if;

  if v_line.end_date is not null then
    -- Séjour par plage. Une ligne PMS-backed n'a JAMAIS été décrémentée (create_order l.632) —
    -- rien à lui rendre ; le drapeau est gelé tant que la ligne est réservée (trigger ci-dessus).
    if v_line.lobby_category_id is null then
      perform 1 from public.product_availability
        where product_id = v_line.product_id and date >= v_line.date and date < v_line.end_date
          and booked < v_line.qty;
      if found then
        raise warning 'release_order_line_capacity: booked < qty sur la plage de la ligne % — une place rendue deux fois ?', p_line_id;
      end if;
      update public.product_availability
         set booked = greatest(0, booked - v_line.qty)
       where product_id = v_line.product_id and date >= v_line.date and date < v_line.end_date;
    end if;
  elsif v_line.slot_start_time is not null then
    perform 1 from public.product_slot_availability
      where product_id = v_line.product_id and slot_date = v_line.date
        and slot_start_time = v_line.slot_start_time and booked < v_line.qty;
    if found then
      raise warning 'release_order_line_capacity: booked < qty sur le créneau de la ligne %', p_line_id;
    end if;
    update public.product_slot_availability
       set booked = greatest(0, booked - v_line.qty)
     where product_id = v_line.product_id and slot_date = v_line.date
       and slot_start_time = v_line.slot_start_time;
  else
    -- Date simple : activité, camp, evento `metered` (les modes unlimited/rsvp n'ont aucune ligne
    -- product_availability — create_order l.286-290 —, l'UPDATE ne touche rien, c'est voulu).
    perform 1 from public.product_availability
      where product_id = v_line.product_id and date = v_line.date and booked < v_line.qty;
    if found then
      raise warning 'release_order_line_capacity: booked < qty sur la date de la ligne %', p_line_id;
    end if;
    update public.product_availability
       set booked = greatest(0, booked - v_line.qty)
     where product_id = v_line.product_id and date = v_line.date;
  end if;

  -- Ressource partagée du prestataire : le FAIT est le blocage d'agenda que create_order a posé
  -- (camp, ou evento occupant) — on rend exactement la plage bloquée, puis on retire le blocage.
  for v_block in
    select id, establishment_id, start_date, end_date
      from public.availability_blocks
     where source_order_line_id = p_line_id
  loop
    update public.provider_resource_calendar
       set booked = greatest(0, booked - v_line.qty)
     where establishment_id = v_block.establishment_id
       and slot_date between v_block.start_date and v_block.end_date;
    delete from public.availability_blocks where id = v_block.id;
  end loop;
end;
$$;
revoke all on function public.release_order_line_capacity(uuid) from public, anon, authenticated;

-- release_order_after_pms_refusal — réécrite sur les deux fonctions ci-dessus (même signature,
-- mêmes grants, même contrat : cancelled_by_provider, tout-ou-rien, idempotente). Verrous en bloc
-- AVANT le premier UPDATE (interblocage possible de l'ancienne version avec modify_order_line, qui
-- verrouille la ligne puis ses product_availability). Récit d'origine : 20260829100000.
create or replace function public.release_order_after_pms_refusal(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_released_ids uuid[];
  v_line_id uuid;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_required');
  end if;

  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  with l as (
    select ol.id from public.order_lines ol
     where ol.order_id = p_order_id and ol.status = 'reserved'
     order by ol.id
     for update
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_released_ids from l;

  if array_length(v_released_ids, 1) is null then
    return jsonb_build_object('ok', true, 'released_lines', 0);
  end if;

  perform public.lock_order_capacity_rows(v_released_ids);

  foreach v_line_id in array v_released_ids loop
    perform public.release_order_line_capacity(v_line_id);
  end loop;

  -- UNE SEULE instruction UPDATE : le trigger order_lines_enqueue_pms_cancellation est FOR EACH
  -- STATEMENT et doit voir toutes les lignes mortes d'un coup.
  update public.order_lines
     set status = 'cancelled_by_provider'
   where id = any(v_released_ids);

  perform public.apply_order_line_ledger_transition(v_released_ids, 'cancelled_by_provider');

  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = p_order_id and status = 'pending';

  update public.orders set payment_status = 'unpaid' where id = p_order_id;

  return jsonb_build_object('ok', true, 'released_lines', array_length(v_released_ids, 1));
end;
$$;

-- ============================================================================================
-- 6. Expiration sous verrou (remplace expire_stale_payment_orders, cf. 20260921100100)
-- ============================================================================================
create function public.expire_payment_order(
  p_order_id uuid,
  p_checked_at timestamptz,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_line_ids uuid[];
  v_line_id uuid;
begin
  select id, payment_status, created_at into v_order
    from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Même prédicat que l'ancien cron : impayée, plus de 30 min, une ligne réservée à acompte dû
  -- (un walk-in ou un evento gratuit/sur place n'attend aucun paiement en ligne).
  if v_order.payment_status not in ('unpaid', 'pending')
     or v_order.created_at >= now() - interval '30 minutes'
     or not exists (
       select 1 from public.order_lines ol
        where ol.order_id = p_order_id and ol.status = 'reserved' and ol.acompte_cop > 0
     ) then
    return jsonb_build_object('ok', false, 'reason', 'not_candidate');
  end if;

  -- Échec fermé : la décision d'expirer repose sur une réponse de Mercado Pago, qui ne peut pas
  -- dater de plus de 2 minutes (un run lent, un tick en retard — on repasse la question).
  if p_checked_at is null or p_checked_at < now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'stale_check');
  end if;

  -- Un paiement que MP dit approuvé n'est JAMAIS expiré tant qu'il n'a pas été TRAITÉ : c'est
  -- apply_payment_webhook_checked qui décide (appliqué → commande payée, donc plus candidate ;
  -- refusé → entrée refund_required). Seul un approuvé encore non traité bloque — un approuvé déjà
  -- signalé (mauvais montant, double paiement) laisse expirer : rien n'est honorable, l'argent est
  -- à rembourser (D3).
  if exists (
    select 1 from public.payments p
     where p.order_id = p_order_id and p.mp_last_status = 'approved'
       and p.status not in ('approved', 'refunded', 'charged_back')
       and not exists (
         select 1 from public.payment_reconciliation_entries e
          where e.payment_id = p.id and e.kind = 'refund_required'
       )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'mp_approved');
  end if;

  -- D2 : un paiement encore en attente chez MP est toléré 2 h, puis annulé en meilleur effort
  -- (3 tentatives) ; au-delà de 2 h 30 on expire quand même — la garde du Lot A rattrape un
  -- virement qui aboutirait ensuite.
  if not p_force and exists (
    select 1 from public.payments p
     where p.order_id = p_order_id
       and p.mp_last_status in ('pending', 'in_process', 'authorized', 'in_mediation')
       and p.mp_cancel_attempts < 3
       and p.created_at + interval '2 hours 30 minutes' > now()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'mp_pending');
  end if;

  with l as (
    select ol.id from public.order_lines ol
     where ol.order_id = p_order_id and ol.status = 'reserved'
     order by ol.id
     for update
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_line_ids from l;

  perform public.lock_order_capacity_rows(v_line_ids);

  -- D1-bis : les places reviennent. Personne n'a rien immobilisé volontairement (l'argument de
  -- 20260829100000 l.19-25 vaut ici aussi) — aucune compensation à devoir.
  foreach v_line_id in array v_line_ids loop
    perform public.release_order_line_capacity(v_line_id);
  end loop;

  update public.order_lines
     set status = 'expired'
   where id = any(v_line_ids);

  perform public.apply_order_line_ledger_transition(v_line_ids, 'expired');

  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = p_order_id and status = 'pending';

  update public.orders
     set payment_status = 'unpaid', reconcile_checked_at = now()
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'expired_lines', array_length(v_line_ids, 1));
end;
$$;
revoke all on function public.expire_payment_order(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.expire_payment_order(uuid, timestamptz, boolean) to service_role;

-- ============================================================================================
-- 7. apply_payment_webhook — corps du Lot A (20260920120000) repris par pg_get_functiondef, six
--    modifications comptées : (a) statuts refunded/charged_back acceptés ; (b) mp_payment_id lu
--    sous verrou ; (c) bloc refunded/charged_back ; (d) double paiement sur le MÊME
--    external_reference dans le court-circuit ; (e) reason_code sur l'entrée de la garde.
--    Signature et grants intacts (aucun drop, aucun grant retouché).
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  v_order record;
  v_referrer_account record;
  v_owner_account record;
  v_order_summary text;
  v_site_url text;
  -- Ajout 20260920120000 (durcissement) :
  v_order_id uuid;
  v_has_honorable_line boolean;
  v_other_approved_payment_id uuid;
  v_refund_code text;
  v_refund_reason text;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back') then
    raise exception 'statut de paiement Mercado Pago inconnu : %', p_status;
  end if;

  -- (1) ORDRE DES VERROUS : `orders` d'abord, toujours (cf. en-tête) — lecture non verrouillante de
  -- la commande, verrou sur `orders`, PUIS verrou sur `payments`, dont le statut est relu après.
  select order_id into v_order_id
    from public.payments
   where id = p_external_reference;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  perform 1 from public.orders where id = v_order_id for update;

  select id, order_id, status, mp_payment_id into v_payment
    from public.payments
   where id = p_external_reference
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotent par construction : un webhook dupliqué ou reçu hors-ordre après approbation est un
  -- no-op — Mercado Pago retente un webhook qui ne renvoie pas 2xx, un no-op DOIT donc renvoyer
  -- ok:true (jamais une erreur), sans quoi le Route Handler entrerait en boucle de retry infinie.
  -- (6) Lot B — `refunded`/`charged_back` (20260921100000). Jusqu'ici le mapper les envoyait sur
  -- `cancelled` : une commande PAYÉE redevenait `unpaid`, lignes toujours `reserved`. Trois cas :
  -- déjà remboursé → no-op ; NOTRE remboursement (payment_refunds vivant, B2) → no-op, jamais une
  -- entrée ; externe (panel MP, contracargo) → entrée `refunded_externally` pour l'admin, et les
  -- statuts ne bougent QUE si ce paiement MP est celui qui a payé la commande. Jamais `unpaid`.
  if p_status in ('refunded', 'charged_back') then
    if v_payment.status in ('refunded', 'charged_back') then
      return jsonb_build_object('ok', true, 'reason', 'already_refunded');
    end if;
    if exists (
      select 1 from public.payment_refunds r
       where r.mp_payment_id = p_mp_payment_id and r.status in ('pending', 'approved')
    ) then
      return jsonb_build_object('ok', true, 'reason', 'own_refund');
    end if;
    insert into public.payment_reconciliation_entries (
      payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
    )
    values (
      v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
      case when p_status = 'charged_back'
           then 'contracargo (charged_back) reçu de Mercado Pago — litige à documenter'
           else 'remboursement effectué hors hifago (panel Mercado Pago)' end,
      'refunded_externally',
      case when p_status = 'charged_back' then 'charged_back' else 'refunded_externally' end
    )
    on conflict (mp_payment_id) where kind = 'refunded_externally' do nothing;

    if v_payment.status = 'approved' and v_payment.mp_payment_id = p_mp_payment_id then
      update public.payments
         set status = p_status, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;
      update public.orders set payment_status = 'refunded' where id = v_payment.order_id;
    end if;
    return jsonb_build_object('ok', true, 'reason', p_status);
  end if;

  if v_payment.status = 'approved' then
    -- (7) Lot B — double paiement sur le MÊME external_reference : le client a payé deux fois dans
    -- la même session Checkout Pro (m1 puis m2 sous P1). Sans ceci, m2 tombait dans
    -- `already_applied` et l'argent en double restait invisible.
    if p_status = 'approved'
       and v_payment.mp_payment_id is not null
       and v_payment.mp_payment_id <> p_mp_payment_id then
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
        'double paiement : ce paiement Mercado Pago double le paiement ' || v_payment.mp_payment_id
          || ' déjà appliqué à la commande',
        'refund_required', 'double_payment'
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;
      return jsonb_build_object('ok', true, 'reason', 'double_payment');
    end if;
    return jsonb_build_object('ok', true, 'reason', 'already_applied');
  end if;

  -- (5) Un paiement `cancelled` (par le cron d'expiration) ne bouge plus, sauf pour un `approved`
  -- qui est traité par la garde (2) ci-dessous : un `pending` PSE tardif, un `rejected` en retard
  -- ne ressuscitent jamais une commande morte.
  if v_payment.status = 'cancelled' and p_status <> 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already_cancelled');
  end if;

  -- (2) GARDE « RIEN À HONORER » — cf. en-tête, points (a) (b) (c).
  if p_status = 'approved' then
    select exists (
      select 1 from public.order_lines ol
       where ol.order_id = v_payment.order_id
         and ol.status in ('reserved', 'fulfilled', 'no_show')
    ) into v_has_honorable_line;

    select id into v_other_approved_payment_id
      from public.payments
     where order_id = v_payment.order_id
       and status = 'approved'
       and id <> v_payment.id
     limit 1;

    if v_other_approved_payment_id is not null then
      v_refund_code := 'double_payment';
      v_refund_reason := 'double paiement : la commande est déjà payée par le paiement '
        || v_other_approved_payment_id;
    elsif v_payment.status = 'cancelled' or not v_has_honorable_line then
      v_refund_code := 'paid_after_expiry';
      v_refund_reason := case
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'expired')
          then 'paiement approuvé après expiration de la commande'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_client')
          then 'paiement approuvé après annulation par le client'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_provider')
          then 'paiement approuvé après annulation par le prestataire'
        else 'paiement approuvé sans aucune prestation à honorer'
      end;
    end if;

    if v_refund_code is not null then
      -- L'argent est chez Mercado Pago : on garde de quoi le rembourser (identifiant MP, événement
      -- brut), sans jamais toucher au statut du paiement ni à celui de la commande.
      update public.payments
         set mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;

      -- (3) Une seule entrée par paiement Mercado Pago, quel que soit le nombre de livraisons.
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event, v_refund_reason,
        'refund_required', v_refund_code
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;

      return jsonb_build_object('ok', true, 'reason', v_refund_code);
    end if;
  end if;

  update public.payments
     set status = p_status, mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
   where id = v_payment.id;

  if p_status = 'approved' then
    update public.orders set payment_status = 'paid' where id = v_payment.order_id;

    -- (4) Les autres paiements de cette commande n'ont plus lieu d'être : un `rejected` retenté
    -- plus tard chez Mercado Pago tombera dans la garde (2c) au lieu d'être appliqué à son tour.
    update public.payments
       set status = 'cancelled', updated_at = now()
     where order_id = v_payment.order_id
       and id <> v_payment.id
       and status in ('pending', 'rejected');

    -- (a) commission attribuée — un email par compte du/des référent(s) externe(s) distinct(s).
    for v_referrer_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.partner_accounts pa on pa.partner_id = ol.referrer_partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id and ol.commission_case = 'external_referrer'
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
          'Nueva comisión asignada',
          '<p>Se te asignó una comisión por una reserva confirmada.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
      end;
    end loop;

    -- (b) paiement effectué — un email par compte du/des partenaire(s) propriétaire(s) distinct(s)
    -- des produits commandés (spec 23 §10 point 8 : lecture retenue, à confirmer par Jérôme).
    for v_owner_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.partner_accounts pa on pa.partner_id = p.partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_payment_confirmed', v_owner_account.email, v_owner_account.account_id,
          'Pago confirmado',
          '<p>Se confirmó el pago de una reserva en tu establecimiento.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification paiement annulée (query_canceled) pour compte % — %', v_owner_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification paiement pour compte % — %', v_owner_account.account_id, sqlerrm;
      end;
    end loop;

    -- (c) confirmation de réservation au client — un seul email par commande.
    --
    -- ⚠️ SPEC 33 : CET EMAIL PORTE DÉSORMAIS LE NUMÉRO ET LE LIEN. Le commentaire qu'il remplace
    -- disait « lien vers /orders/[id]/status non ajouté en v1, à confirmer par Jérôme » — c'est
    -- confirmé et tranché (cahier client §2b.9, 2026-09-07) : l'adresse de la commande « part aussi
    -- dans l'email de confirmation, ce qui la rend retrouvable des mois plus tard ». Pour un client
    -- sans compte, cet email EST le canal de suivi : le WhatsApp pré-rempli a été retiré le même
    -- jour, et la zone tunnel n'a pas de pied de page.
    --
    -- ⚠️ L'URL publique du site vient du VAULT, comme `admin_app_public_url` pour l'email
    -- d'invitation partenaire (20260824040000) et `pms_functions_base_url` pour les crons
    -- (20260819140000). Une première version de la spec 33 avait inventé un jeton de gabarit
    -- `{{SITE_URL}}` résolu à l'envoi par l'Edge Function, en justifiant que « Postgres ne connaît
    -- pas l'URL publique du site » — c'était FAUX : ce dépôt a déjà ce mécanisme, pour exactement
    -- cette raison (« seedée par environnement, jamais une valeur en dur, elle diffère
    -- local/preprod/prod »). Deux patrons concurrents pour mettre un lien dans un email, c'est un
    -- de trop.
    --
    -- ⚠️ DIFFÉRENCE ASSUMÉE avec l'invitation partenaire : là-bas, un secret manquant fait SAUTER
    -- l'email (le lien reste affiché à l'écran, donc rien n'est perdu). Ici le client a PAYÉ et
    -- n'a plus l'écran sous les yeux : on envoie la confirmation dans tous les cas, avec le lien
    -- si le secret existe, sans lui sinon. Un email de confirmation sans lien reste utile ; pas
    -- d'email du tout ne l'est pas.
    begin
      select holder_name, holder_email, reference, access_token into v_order
        from public.orders where id = v_payment.order_id;

      select decrypted_secret into v_site_url
        from vault.decrypted_secrets where name = 'web_app_public_url';
      if v_site_url is null then
        raise warning 'apply_payment_webhook: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', v_payment.order_id;
      end if;

      select string_agg(
        '<li>' || coalesce(p.name ->> 'es', 'Producto') || ' — ' || ol.date
          || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
        ''
      ) into v_order_summary
      from public.order_lines ol join public.products p on p.id = ol.product_id
      where ol.order_id = v_payment.order_id;

      perform public.enqueue_notification_email(
        'client_order_confirmed', v_order.holder_email, null,
        'Reserva ' || v_order.reference || ' confirmada',
        '<p>Hola ' || coalesce(v_order.holder_name, '') || ', tu reserva fue confirmada.</p>'
          || '<p>Número de reserva : <strong>' || v_order.reference || '</strong></p>'
          || '<ul>' || coalesce(v_order_summary, '') || '</ul>'
          || coalesce(
               '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">'
                 || 'Ver tu reserva</a> — guarda este enlace, puedes volver a abrirlo cuando quieras.</p>',
               ''
             ),
        'orders', v_payment.order_id
      );
    exception
      when query_canceled then
        raise warning 'apply_payment_webhook: notification client annulée (query_canceled) pour commande % — %', v_payment.order_id, sqlerrm;
      when others then
        raise warning 'apply_payment_webhook: échec notification client pour commande % — %', v_payment.order_id, sqlerrm;
    end;
  elsif p_status in ('rejected', 'cancelled') then
    -- (5) Jamais rétrograder une commande qu'un AUTRE paiement porte encore (pending) ou a déjà
    -- réglée (approved) — une notification `rejected` en retard sur P1 ne doit pas effacer P2.
    update public.orders
       set payment_status = 'unpaid'
     where id = v_payment.order_id
       and not exists (
         select 1 from public.payments other
          where other.order_id = v_payment.order_id
            and other.id <> v_payment.id
            and other.status in ('pending', 'approved')
       );
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$function$;

-- apply_payment_webhook_checked — la comparaison de montant en SQL, pour le JOB (la route garde
-- la sienne en TypeScript : aucune dépendance d'ordre de déploiement entre Vercel et la base).
create function public.apply_payment_webhook_checked(
  p_mp_payment_id text,
  p_external_reference uuid,
  p_status text,
  p_transaction_amount numeric,
  p_raw_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
begin
  select p.id, p.order_id, p.status, p.amount_cop into v_payment
    from public.payments p where p.id = p_external_reference;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  if p_status = 'approved'
     and p_transaction_amount is not null
     and round(p_transaction_amount) <> v_payment.amount_cop then
    perform 1 from public.orders where id = v_payment.order_id for update;
    perform 1 from public.payments where id = v_payment.id for update;
    -- L'argent EST encaissé (au mauvais montant) : de quoi rembourser (id MP, événement brut),
    -- sans jamais approuver. Un paiement déjà approuvé (autre id MP) garde son mp_payment_id.
    update public.payments
       set mp_payment_id = case when status = 'approved' then mp_payment_id else p_mp_payment_id end,
           raw_last_event = p_raw_event, updated_at = now()
     where id = v_payment.id;
    insert into public.payment_reconciliation_entries (
      payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
    )
    values (
      v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
      'montant Mercado Pago (' || p_transaction_amount || ') ≠ acompte attendu (' || v_payment.amount_cop || ' COP)',
      'refund_required', 'amount_mismatch'
    )
    on conflict (mp_payment_id) where kind = 'refund_required' do nothing;
    return jsonb_build_object('ok', true, 'reason', 'amount_mismatch');
  end if;

  return public.apply_payment_webhook(p_mp_payment_id, p_external_reference, p_status, p_raw_event);
end;
$$;
revoke all on function public.apply_payment_webhook_checked(text, uuid, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment_webhook_checked(text, uuid, text, numeric, jsonb) to service_role;

-- ============================================================================================
-- 8. Claims (pattern claim_pms_poll_batch : for update skip locked, horodatage posé ET renvoyé)
-- ============================================================================================
create function public.claim_orders_to_reconcile(p_limit int default 25)
returns table (
  order_id uuid,
  created_at timestamptz,
  claimed_at timestamptz,
  payment_status text,
  payments jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with cand as (
      select o.id
        from public.orders o
       where o.payment_status in ('unpaid', 'pending')
         and (
           exists (select 1 from public.order_lines ol
                    where ol.order_id = o.id and ol.status = 'reserved' and ol.acompte_cop > 0)
           -- Commande sans ligne vivante mais dont un paiement est encore en cours : le client a
           -- tout annulé (ou l'opérateur a expiré à la main) pendant que la préférence était
           -- payable — il faut aller demander à MP, sinon un paiement resterait invisible.
           or exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'pending')
         )
         -- Sans aucun `payments`, aucune préférence n'a jamais existé : rien à demander à MP avant
         -- l'échéance des 30 minutes.
         and (exists (select 1 from public.payments p where p.order_id = o.id)
              or o.created_at < now() - interval '30 minutes')
         and o.created_at < now() - interval '2 minutes'
         and (o.reconcile_claimed_at is null or o.reconcile_claimed_at < now() - interval '2 minutes')
       order by o.created_at
       limit p_limit
       for update of o skip locked
    )
    update public.orders o
       set reconcile_claimed_at = now()
      from cand
     where o.id = cand.id
    returning o.id, o.created_at, o.reconcile_claimed_at, o.payment_status,
      (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', p.id, 'status', p.status, 'amount_cop', p.amount_cop,
                 'mp_payment_id', p.mp_payment_id, 'mp_collector_id', p.mp_collector_id,
                 'mp_last_status', p.mp_last_status, 'created_at', p.created_at,
                 'mp_cancel_attempts', p.mp_cancel_attempts
               ) order by p.created_at), '[]'::jsonb)
         from public.payments p where p.order_id = o.id);
end;
$$;
revoke all on function public.claim_orders_to_reconcile(int) from public, anon, authenticated;
grant execute on function public.claim_orders_to_reconcile(int) to service_role;

-- Surveillance APRÈS expiration/annulation (48 h) : un virement PSE qui aboutit après coup, ou une
-- approbation indexée tard chez MP, doit rester visible même si le webhook est mort.
create function public.claim_payments_to_watch(p_limit int default 25)
returns table (
  payment_id uuid,
  order_id uuid,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with cand as (
      select p.id
        from public.payments p
        join public.orders o on o.id = p.order_id
       where p.status in ('rejected', 'cancelled')
         and p.created_at > now() - interval '48 hours'
         and (p.mp_last_status is null
              or p.mp_last_status in ('pending', 'in_process', 'authorized', 'in_mediation')
              -- 'none' = MP n'a rien renvoyé ; une préférence morte (+28 min) ne peut plus
              -- produire de paiement, mais l'indexation MP peut être en retard : on revérifie
              -- tant que la commande a moins d'une heure.
              or (p.mp_last_status = 'none' and o.created_at > now() - interval '1 hour'))
         and (p.mp_last_checked_at is null or p.mp_last_checked_at < now() - interval '10 minutes')
       order by p.mp_last_checked_at asc nulls first
       limit p_limit
       for update of p skip locked
    )
    update public.payments p
       set mp_last_checked_at = now()
      from cand
     where p.id = cand.id
    returning p.id, p.order_id, p.mp_last_checked_at;
end;
$$;
revoke all on function public.claim_payments_to_watch(int) from public, anon, authenticated;
grant execute on function public.claim_payments_to_watch(int) to service_role;

-- ============================================================================================
-- 9. Décision (LA fonction du lot) et ses deux compagnes
-- ============================================================================================
-- p_mp_payments : tableau d'objets {payment_id (uuid local), mp_payment_id, status, status_detail,
-- transaction_amount, date_created, date_approved, collector_id} — la réponse de
-- GET /v1/payments/search pour chaque external_reference de la commande, aplatie par l'Edge Function.
create function public.reconcile_order(
  p_order_id uuid,
  p_mp_payments jsonb,
  p_checked_at timestamptz,
  p_collector_id text,
  p_expiry_margin interval default interval '2 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_local record;
  v_mp record;
  v_live boolean;
  v_pending_ids text[] := array[]::text[];
  v_pending_anchor timestamptz;
  v_result jsonb;
  v_applied boolean := false;
  v_status_after text;
begin
  select id, payment_status, created_at into v_order
    from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('action', 'noop', 'reason', 'order_not_found');
  end if;

  select exists (
    select 1 from public.order_lines ol
     where ol.order_id = p_order_id and ol.status in ('reserved', 'fulfilled', 'no_show')
  ) into v_live;

  if v_order.payment_status not in ('unpaid', 'pending') then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    return jsonb_build_object('action', 'noop', 'reason', 'not_candidate');
  end if;

  -- Identité du token : une recherche vide avec le token d'un AUTRE compte MP est exactement
  -- l'incident du 2026-09-20 — elle ne vaut jamais « pas payé ».
  if exists (
    select 1 from public.payments p
     where p.order_id = p_order_id and p.mp_collector_id is not null
       and p_collector_id is not null and p.mp_collector_id <> p_collector_id
  ) then
    return jsonb_build_object('action', 'identity_mismatch');
  end if;

  -- Dernier statut MP connu par paiement local ('none' si MP n'a rien renvoyé).
  for v_local in select p.id from public.payments p where p.order_id = p_order_id loop
    select m->>'status' as status into v_mp
      from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where (m->>'payment_id')::uuid = v_local.id
     order by m->>'date_created' desc nulls last
     limit 1;
    update public.payments
       set mp_last_status = coalesce(v_mp.status, 'none'), mp_last_checked_at = p_checked_at
     where id = v_local.id;
  end loop;

  -- Paiements approuvés, du plus ancien au plus récent : la garde du Lot A (rien à honorer, double
  -- paiement) et la comparaison de montant décident ; ici on ne fait qu'appeler.
  for v_mp in
    select m from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where m->>'status' = 'approved'
     order by m->>'date_created' asc nulls last
  loop
    v_result := public.apply_payment_webhook_checked(
      v_mp.m->>'mp_payment_id', (v_mp.m->>'payment_id')::uuid, 'approved',
      (v_mp.m->>'transaction_amount')::numeric, v_mp.m
    );
    v_applied := true;
  end loop;

  select payment_status into v_status_after from public.orders where id = p_order_id;
  if v_status_after = 'paid' then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    return jsonb_build_object('action', 'applied');
  end if;

  select array_agg(m->>'mp_payment_id'), min((select p.created_at from public.payments p where p.id = (m->>'payment_id')::uuid))
    into v_pending_ids, v_pending_anchor
    from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
   where m->>'status' in ('pending', 'in_process', 'authorized', 'in_mediation');

  if not v_live then
    -- Plus rien à honorer : on ferme localement (les paiements approuvés ont déjà produit leurs
    -- entrées refund_required ci-dessus) ; un pending chez MP est annulé en meilleur effort par
    -- l'Edge Function (rien à attendre, D2 sans délai).
    update public.payments set status = 'cancelled', updated_at = now()
     where order_id = p_order_id and status = 'pending';
    update public.orders set payment_status = 'unpaid', reconcile_checked_at = now()
     where id = p_order_id;
    return jsonb_build_object('action', 'closed',
      'refund_flagged', v_applied,
      'mp_cancel_ids', coalesce(to_jsonb(v_pending_ids), '[]'::jsonb));
  end if;

  if v_pending_ids is not null and array_length(v_pending_ids, 1) > 0 then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    if v_pending_anchor + interval '2 hours' > now() then
      return jsonb_build_object('action', 'kept_pending');
    end if;
    return jsonb_build_object('action', 'cancel_at_mp', 'mp_cancel_ids', to_jsonb(v_pending_ids));
  end if;

  if v_order.created_at + interval '30 minutes' + p_expiry_margin < now() then
    v_result := public.expire_payment_order(p_order_id, p_checked_at);
    return jsonb_build_object('action', case when (v_result->>'ok')::boolean then 'expired' else 'kept' end,
                              'expire', v_result);
  end if;

  update public.orders set reconcile_checked_at = now() where id = p_order_id;
  return jsonb_build_object('action', 'kept');
end;
$$;
revoke all on function public.reconcile_order(uuid, jsonb, timestamptz, text, interval) from public, anon, authenticated;
grant execute on function public.reconcile_order(uuid, jsonb, timestamptz, text, interval) to service_role;

create function public.mark_mp_cancel_attempt(p_payment_id uuid, p_mp_status_after text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
     set mp_cancel_attempts = mp_cancel_attempts + 1,
         mp_last_status = coalesce(p_mp_status_after, mp_last_status),
         mp_last_checked_at = now(),
         updated_at = now()
   where id = p_payment_id;
end;
$$;
revoke all on function public.mark_mp_cancel_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_mp_cancel_attempt(uuid, text) to service_role;

create function public.record_mp_payment_status(
  p_payment_id uuid,
  p_mp_payments jsonb,
  p_checked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_mp record;
  v_result jsonb := jsonb_build_object('action', 'recorded');
begin
  select p.id, p.order_id into v_payment from public.payments p where p.id = p_payment_id;
  if not found then
    return jsonb_build_object('action', 'noop', 'reason', 'payment_not_found');
  end if;
  perform 1 from public.orders where id = v_payment.order_id for update;

  for v_mp in
    select m from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where m->>'status' = 'approved'
     order by m->>'date_created' asc nulls last
  loop
    v_result := public.apply_payment_webhook_checked(
      v_mp.m->>'mp_payment_id', p_payment_id, 'approved',
      (v_mp.m->>'transaction_amount')::numeric, v_mp.m
    );
  end loop;

  update public.payments
     set mp_last_status = coalesce(
           (select m->>'status' from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
             order by m->>'date_created' desc nulls last limit 1),
           'none'),
         mp_last_checked_at = p_checked_at
   where id = p_payment_id;
  return v_result;
end;
$$;
revoke all on function public.record_mp_payment_status(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_mp_payment_status(uuid, jsonb, timestamptz) to service_role;

-- ============================================================================================
-- 10. Cron : wrapper (gabarit invoke_pms_sync_availability) + watchdog SQL pur
-- ============================================================================================
create function public.invoke_payments_reconcile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_key text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'pms_functions_base_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_service_role_key';
  if v_base_url is null or v_key is null then
    raise warning 'payments_reconcile : secrets Vault manquants — job ignoré (cf. supabase/scripts/seed_pms_vault_secrets.example.sql)';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/payments-reconcile',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    -- Lot explicite ici (comme 20260917160000) : 25 commandes, ≤ 60 appels MP par run.
    body := '{"limit": 25}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function public.invoke_payments_reconcile() from public, anon, authenticated;
select cron.schedule('payments-reconcile', '*/2 * * * *', $$select invoke_payments_reconcile();$$);

-- Le watchdog n'expire JAMAIS rien : il dit seulement, une fois, que le job ne bat plus. Se réarme
-- dès qu'un run réussit (alerted_at < last_ok_at).
create function public.payments_reconcile_watchdog()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hb record;
begin
  select * into v_hb from public.job_heartbeats where job_name = 'payments-reconcile';
  if not found then
    return;
  end if;
  if coalesce(v_hb.last_ok_at, v_hb.created_at) < now() - interval '15 minutes'
     and (v_hb.alerted_at is null or v_hb.alerted_at < coalesce(v_hb.last_ok_at, v_hb.created_at)) then
    perform public.notify_all_admins(
      'admin_job_stalled',
      'El job de conciliación de pagos no responde desde hace 15 min',
      '<p>Última ejecución exitosa: ' || coalesce(v_hb.last_ok_at::text, 'nunca') || '.</p>'
        || '<p>Último error: ' || coalesce(v_hb.last_error, '—') || '.</p>'
        || '<p>Mientras esté detenido, ninguna reserva expira y ningún pago tardío se concilia: revisar secrets, despliegue de la Edge Function y net._http_response.</p>',
      'job_heartbeats', null
    );
    update public.job_heartbeats set alerted_at = now() where job_name = 'payments-reconcile';
  end if;
end;
$$;
revoke all on function public.payments_reconcile_watchdog() from public, anon, authenticated;
select cron.schedule('payments-reconcile-watchdog', '*/15 * * * *', $$select payments_reconcile_watchdog();$$);
