-- C2 — propagation d'une annulation hifago vers LobbyPMS. Spec 25.
--
-- LE PROBLÈME. `reserve-nights` crée un booking chez Lobby et range son identifiant dans
-- `order_lines.pms_booking_id`. RIEN ne l'annule jamais. Une commande annulée côté hifago laisse
-- donc, chez le partenaire, une chambre bloquée pour un client qui ne viendra pas.
--
-- POURQUOI UN TRIGGER ET NON UN APPEL DEPUIS `cancel_order` (raffinement de la spec 25 §3.1, qui
-- disait « posée dans la transaction des RPC de statut »). `cancel_order` n'a qu'UN appelant, dans
-- le navigateur, pour l'annulation par le client. L'admin et le socio passent par
-- `set_order_line_status`, une modification produit `superseded`, une commande impayée produit
-- `expired` — et comme `reserve-nights` tourne AVANT le paiement, une commande abandonnée au
-- paiement a déjà un booking chez Lobby quand elle expire. Accrocher le mécanisme à une RPC
-- couvrirait le cas le moins fréquent et raterait les trois autres.
--
-- Un trigger sur `order_lines` les attrape TOUS, y compris ceux qui n'existent pas encore, et il
-- est dans la transaction par construction : si l'annulation hifago échoue, l'entrée de file
-- disparaît avec elle. On n'annule jamais chez un tiers une annulation qui n'a pas eu lieu ici.
--
-- STATEMENT-LEVEL, avec table de transition, et c'est important : un trigger FOR EACH ROW verrait
-- les lignes une à une, avant que les autres du même UPDATE ne soient à jour — la garde « plus
-- aucune ligne réservée » serait évaluée sur un état intermédiaire.
--
-- LA GARDE QUI ÉVITE LE DÉSASTRE. `pms_booking_id` est PARTAGÉ entre plusieurs lignes :
-- `reserve-nights` recopie le booking du logement sur chaque ligne d'activité (route.ts:239), parce
-- qu'`add-product-service` exige un booking porteur. Annuler « la ligne » tuerait donc la nuit
-- d'hôtel en retirant une activité. L'unité d'annulation est le BOOKING, jamais la ligne : on
-- n'enfile que si plus AUCUNE ligne de ce booking n'est `reserved`.

create table public.pms_cancellation_queue (
  id uuid primary key default gen_random_uuid(),
  pms_booking_id text not null,
  establishment_id uuid not null references public.establishments(id),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  lobby_status_code int,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Idempotence : jamais deux entrées en attente pour le même booking. Si plusieurs lignes d'une même
-- commande sortent de `reserved` dans des instructions distinctes, la seconde ne fait rien.
create unique index pms_cancellation_queue_pending_uniq
  on public.pms_cancellation_queue (pms_booking_id)
  where status = 'pending';

create index pms_cancellation_queue_pending_idx
  on public.pms_cancellation_queue (created_at)
  where status = 'pending';

comment on table public.pms_cancellation_queue is
  'File des bookings LobbyPMS à annuler suite à une annulation hifago (C2, spec 25). Alimentée par un trigger sur order_lines, drainée par l''Edge Function pms-cancel-bookings. RPC-only : aucune policy RLS, aucun accès direct.';

-- Frontière RLS/RPC-only (hifago/CLAUDE.md §10) : RLS activée, AUCUNE policy. La table n'est
-- atteignable que par les fonctions SECURITY DEFINER ci-dessous.
alter table public.pms_cancellation_queue enable row level security;

-- Défense en profondeur (hifago/CLAUDE.md §3.1), et ce n'est PAS redondant avec la RLS : Supabase
-- accorde par défaut tous les droits à anon/authenticated sur toute table neuve du schéma public.
-- La RLS suffirait à bloquer à l'exécution, mais l'invariant vérifié par
-- rls_rpc_only_checklist.test.sql exige les deux — une policy ajoutée par mégarde plus tard
-- ouvrirait sinon la table en écriture d'un coup. Oubli attrapé par ce test même, le 2026-08-27.
revoke all on public.pms_cancellation_queue from authenticated, anon;

-- ============================================================================================
-- Trigger d'enfilement
-- ============================================================================================

create or replace function public.enqueue_pms_cancellations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pms_cancellation_queue (pms_booking_id, establishment_id)
  select distinct nr.pms_booking_id, p.establishment_id
    from new_rows nr
    join public.products p on p.id = nr.product_id
    join public.establishments e on e.id = p.establishment_id
   where nr.pms_booking_id is not null
     and nr.status <> 'reserved'
     and e.lobby_connector_active = true
     -- LA garde de la spec 25 §3.2 : le booking est partagé, on ne l'annule que s'il ne porte plus
     -- aucune réservation vivante.
     and not exists (
       select 1
         from public.order_lines ol
        where ol.pms_booking_id = nr.pms_booking_id
          and ol.status = 'reserved'
     )
  on conflict (pms_booking_id) where status = 'pending' do nothing;

  return null;
end;
$$;

-- Se déclenche aussi sur les UPDATE qui ne touchent pas `status` (ex. `pms_last_polled_at` écrit
-- par claim_pms_poll_batch) : ces lignes restent `reserved` et sont filtrées par le WHERE. Le coût
-- est une jointure sur un lot déjà en mémoire, pas un scan.
create trigger order_lines_enqueue_pms_cancellation
after update on public.order_lines
referencing new table as new_rows
for each statement
execute function public.enqueue_pms_cancellations();

-- ============================================================================================
-- Drainage — même patron que claim_pms_poll_batch (20260819120000)
-- ============================================================================================

-- CRITIQUE, même avertissement que son jumeau : cette fonction renvoie le jeton Lobby EN CLAIR.
-- Jamais de grant implicite — REVOKE explicite puis grant à service_role seul, appelée uniquement
-- par l'Edge Function pms-cancel-bookings.
create or replace function claim_pms_cancellation_batch(p_limit int default 20)
returns table (
  entry_id uuid,
  pms_booking_id text,
  establishment_id uuid,
  lobby_api_token text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with claimed as (
      select q.id
        from public.pms_cancellation_queue q
        join public.establishments e on e.id = q.establishment_id
       where q.status = 'pending'
         and e.lobby_connector_active = true
         and e.lobby_api_token is not null
       order by q.created_at asc
       limit p_limit
       for update of q skip locked
    )
    update public.pms_cancellation_queue q
       set attempts = q.attempts + 1
      from claimed c, public.establishments e
     where q.id = c.id and e.id = q.establishment_id
    returning q.id, q.pms_booking_id, e.id, e.lobby_api_token;
end;
$$;

revoke execute on function claim_pms_cancellation_batch(int) from public, authenticated, anon;
grant execute on function claim_pms_cancellation_batch(int) to service_role;

-- Clôture d'une entrée. `p_outcome` vaut 'done' ou 'failed'.
--
-- CE QUI COMPTE ICI, et c'est le défaut C9 en creux : `422 RESTRICTED_RESERVATION` (booking portant
-- déjà une charge) et `404` (booking déjà annulé chez Lobby) sont des cas ATTENDUS et documentés
-- (spec 21 §0) — ils closent l'entrée en 'done', jamais en 'failed'. Les traiter comme des
-- incidents produirait, via pms_reconciliation_entries et son trigger notify_all_admins SANS
-- dédup, une salve d'e-mails à chaque annulation. C'est exactement ce qui a été corrigé le
-- 2026-08-26 sur le chemin jumeau ; ne pas le réintroduire ici.
--
-- Une entrée définitivement 'failed' n'envoie DÉLIBÉRÉMENT aucun e-mail : elle est visible dans
-- cette table, et le job nocturne en rapporte le compte. La supervision d'une file est un problème
-- de comptage, pas de notification unitaire.
create or replace function resolve_pms_cancellation(
  p_entry_id uuid,
  p_outcome text,
  p_lobby_status_code int default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('done', 'failed') then
    raise exception 'resolve_pms_cancellation : issue invalide %', p_outcome;
  end if;

  update public.pms_cancellation_queue
     set status = p_outcome,
         lobby_status_code = p_lobby_status_code,
         last_error = p_error,
         processed_at = now()
   where id = p_entry_id;
end;
$$;

revoke execute on function resolve_pms_cancellation(uuid, text, int, text) from public, authenticated, anon;
grant execute on function resolve_pms_cancellation(uuid, text, int, text) to service_role;

-- Remise en attente d'une entrée dont l'appel a échoué pour une raison transitoire, tant que le
-- plafond de tentatives n'est pas atteint. Au-delà, l'appelant clôt en 'failed'.
create or replace function requeue_pms_cancellation(p_entry_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pms_cancellation_queue
     set last_error = p_error
   where id = p_entry_id and status = 'pending';
end;
$$;

revoke execute on function requeue_pms_cancellation(uuid, text) from public, authenticated, anon;
grant execute on function requeue_pms_cancellation(uuid, text) to service_role;
