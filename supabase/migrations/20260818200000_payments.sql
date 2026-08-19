-- Spec 19 §0 Tranche 1 — capture Mercado Pago de l'acompte. Schéma propre, PAS une reprise du
-- scaffolding `payments` legacy pensé pour Wompi (00-modele-de-donnees.md, décision 2026-08-11
-- rouverte 2026-08-18) : colonnes repensées pour Mercado Pago (mp_payment_id, provider) et pour le
-- modèle acompte-seul déjà tranché (client §3f l.844-847 — jamais le total de la réservation).
--
-- create_payment_intent NE CONTACTE JAMAIS Mercado Pago elle-même : Postgres ne fait pas d'appel
-- HTTP sortant synchrone (cf. spec §0 Tranche 1, écart assumé à l'invariant anti-survente "un seul
-- aller-retour", justifié explicitement en §8 de la spec). Elle réserve une ligne `payments`
-- 'pending' ; l'appel SDK réel (création de la préférence Checkout Pro) se fait ENSUITE côté Route
-- Handler (apps/web/app/api/payments/create/route.ts), avec external_reference = payments.id.

-- orders.payment_status — colonne explicitement réservée à cette spec par
-- 01-cahier-des-charges-client.md §3f point 4.
alter table orders
  add column payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'partially_refunded', 'refunded'));

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  provider text not null default 'mercadopago',
  mp_payment_id text unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  amount_cop bigint not null check (amount_cop > 0),
  payer_email text,
  raw_last_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_order_id_idx on payments(order_id);

alter table payments enable row level security;
revoke insert, update, delete on payments from authenticated, anon;
-- Lecture directe réservée à l'admin (même patron que ledger_entries) — ni un invité ni un compte
-- connecté n'a besoin de lire cette table en direct : le statut de paiement passe par
-- GET /api/payments/[orderId]/status (Route Handler service_role, Tranche 1), jamais une lecture
-- Supabase directe côté navigateur — cohérent avec orders_select qui exclut déjà l'invité de toute
-- lecture directe de sa propre commande (spec client : « le client garde son numéro de réservation
-- ... comme seul repère »).
create policy payments_select_admin on payments
  for select using ((select is_admin(auth.uid())));

-- create_payment_intent — appelée par le client (invité OU connecté) juste après create_order,
-- dans la même page/session, avant toute redirection Checkout Pro.
--
-- Autorisation délibérément PLUS LARGE que cancel_order (account_id = auth.uid()) : un invité n'a
-- justement aucune session pour prouver la propriété de sa commande (orders_select l'exclut déjà
-- de toute lecture RLS directe), et le paiement immédiat après réservation doit fonctionner pour
-- un invité comme pour un compte — c'est le chemin PRINCIPAL, pas un cas limite. La possession de
-- p_order_id (uuid à haute entropie, jamais exposé publiquement, renvoyé une seule fois par
-- create_order à l'appelant) fait foi, exactement le même modèle de capacité que la confirmation
-- de commande elle-même. Un compte AUTHENTIFIÉ sous une identité différente du propriétaire de la
-- commande reste refusé (empêche un compte connecté d'intercepter le paiement d'une commande d'un
-- autre compte connu) — seul un appelant anonyme (comportement invité) ou le propriétaire exact
-- passe. Cf. spec 19 §0 Tranche 1, cas limite « commande invité qui revient payer plus tard ».
create or replace function create_payment_intent(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_order_account_id uuid;
  v_payer_email text;
  v_existing_status text;
  v_amount_cop bigint;
  v_payment_id uuid;
begin
  select account_id, holder_email into v_order_account_id, v_payer_email
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if v_account_id is not null and v_order_account_id is not null
     and v_order_account_id is distinct from v_account_id then
    -- Même réponse qu'une commande inexistante, jamais un refus distinct qui confirmerait
    -- l'existence d'une commande d'un autre compte (même logique que cancel_order).
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select status into v_existing_status
    from public.payments
   where order_id = p_order_id and status in ('pending', 'approved')
   order by created_at desc
   limit 1
   for update;

  if v_existing_status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;
  if v_existing_status = 'pending' then
    -- Idempotence métier (spec §0 Tranche 1) : jamais un second intent tant que le premier n'a pas
    -- été refusé/annulé/expiré — pas de double-clic "payer" créant deux payments 'pending'.
    return jsonb_build_object('ok', false, 'reason', 'payment_already_pending');
  end if;

  -- Seulement les lignes ENCORE actives (status = 'reserved') : une ligne déjà superseded par
  -- modify_order_line, ou déjà annulée/expirée, ne doit jamais gonfler l'acompte demandé — même
  -- discipline que cancel_order (« seulement les lignes ENCORE actives »).
  select coalesce(sum(acompte_cop), 0) into v_amount_cop
    from public.order_lines
   where order_id = p_order_id and status = 'reserved';

  if v_amount_cop <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_pay');
  end if;

  insert into public.payments (order_id, amount_cop, payer_email)
  values (p_order_id, v_amount_cop, v_payer_email)
  returning id into v_payment_id;

  update public.orders set payment_status = 'pending' where id = p_order_id;

  return jsonb_build_object(
    'ok', true, 'payment_id', v_payment_id, 'amount_cop', v_amount_cop, 'payer_email', v_payer_email
  );
end;
$$;

grant execute on function create_payment_intent(uuid) to anon, authenticated;
