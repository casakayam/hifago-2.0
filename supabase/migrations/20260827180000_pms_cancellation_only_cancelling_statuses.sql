-- C2, correctif trouvé par le test LIVE du 2026-08-27 — et il aurait annulé des séjours effectués.
--
-- LE DÉFAUT. `enqueue_pms_cancellations` (20260827160000) enfilait sur `nr.status <> 'reserved'`.
-- Or `order_lines.status` compte SEPT valeurs, et deux d'entre elles ne sont pas des annulations :
--
--   reserved              -- vivante, n'enfile pas (correct)
--   fulfilled             -- le séjour A EU LIEU              ← enfilait à tort
--   no_show               -- le client n'est pas venu, la nuit reste due ← enfilait à tort
--   cancelled_by_client   -- annulation                       ← correct
--   cancelled_by_provider -- annulation                       ← correct
--   expired               -- commande jamais payée            ← correct
--   superseded            -- remplacée par modify_order_line  ← correct
--
-- Autrement dit : à la première ligne passée en `fulfilled` — le cas NOMINAL d'un séjour qui se
-- termine bien — hifago aurait demandé à LobbyPMS d'annuler la réservation correspondante. Lobby
-- l'aurait probablement refusée (`BOOKING_CHECK_IN_COMPLETE` ou `RESTRICTED_RESERVATION`), mais
-- compter sur le refus d'un tiers pour protéger les données d'un partenaire n'est pas une garantie,
-- c'est un pari.
--
-- Non attrapé par les 9 cas pgTAP du 20260827160000 : ils n'exerçaient que des statuts d'annulation.
-- Un test qui ne teste que les cas où l'on veut que ça marche ne prouve jamais que ça s'abstient.
--
-- `hifago_status` est ajoutée par la même occasion : LobbyPMS n'accepte pas un motif libre mais un
-- CODE pris dans une liste fermée (NS/RC/RE/TTC/CC/OTH, cf. docs/3-integrations/lobby_pms_api.md),
-- et le bon code dépend de la raison hifago. Sans cette colonne, le drainage ne peut qu'envoyer un
-- générique.

alter table public.pms_cancellation_queue
  add column hifago_status text;

comment on column public.pms_cancellation_queue.hifago_status is
  'Statut d''order_line qui a déclenché l''enfilement. Sert à choisir le code de motif LobbyPMS (liste fermée NS/RC/RE/TTC/CC/OTH) — jamais affiché au partenaire tel quel.';

create or replace function public.enqueue_pms_cancellations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
  select distinct on (nr.pms_booking_id) nr.pms_booking_id, p.establishment_id, nr.status
    from new_rows nr
    join public.products p on p.id = nr.product_id
    join public.establishments e on e.id = p.establishment_id
   where nr.pms_booking_id is not null
     -- LISTE BLANCHE, jamais « tout sauf reserved » : `fulfilled` et `no_show` ne sont pas des
     -- annulations. Le séjour a eu lieu (ou la nuit reste due) — annuler chez le partenaire
     -- effacerait une réservation légitime.
     and nr.status in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
     and e.lobby_connector_active = true
     -- Le booking est PARTAGÉ entre lignes : on ne l'annule que s'il ne porte plus aucune
     -- réservation vivante (spec 25 §3.2).
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

-- Le drainage a besoin du statut hifago pour choisir le code de motif. Recréée verbatim de
-- 20260827160000, avec `hifago_status` en plus dans le retour — rien d'autre ne change.
--
-- DROP obligatoire : `create or replace` ne peut PAS changer le type de retour d'une fonction
-- existante (`cannot change return type of existing function`, SQLSTATE 42P13). Même famille de
-- piège que celui consigné le 2026-08-24 sur les surcharges de signature — `create or replace` ne
-- remplace que ce qui a exactement la même forme.
drop function if exists claim_pms_cancellation_batch(int);

create function claim_pms_cancellation_batch(p_limit int default 20)
returns table (
  entry_id uuid,
  pms_booking_id text,
  establishment_id uuid,
  lobby_api_token text,
  hifago_status text
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
    returning q.id, q.pms_booking_id, e.id, e.lobby_api_token, q.hifago_status;
end;
$$;

revoke execute on function claim_pms_cancellation_batch(int) from public, authenticated, anon;
grant execute on function claim_pms_cancellation_batch(int) to service_role;
