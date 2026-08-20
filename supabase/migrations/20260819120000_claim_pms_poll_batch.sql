-- Spec 21 — Connecteur LobbyPMS, Phase 1 (suite) : claim_pms_poll_batch.
--
-- Réclame un lot de bookings PMS dus au poll, SKIP LOCKED (même patron de verrouillage en lot que
-- expire_stale_payment_orders, 20260818230000, adapté avec un retour de lignes au lieu d'un CTE
-- agrégé — ici on a besoin des lignes elles-mêmes pour l'appel Lobby, pas seulement de leurs ids).
-- Fréquence/taille de lot (15 min / 20) tranchées par Jérôme — cf. spec 21 §10.6.
--
-- CRITIQUE : cette fonction renvoie le jeton PMS en clair — jamais de grant PUBLIC implicite
-- (piège documenté hifago/CLAUDE.md §11.1 : EXECUTE n'est pas accordé par défaut côté local, mais
-- un REVOKE explicite est plus sûr que de compter sur ce comportement, notamment vis-à-vis d'un
-- provisioning cloud qui pourrait différer). Réservée à service_role — appelée uniquement par
-- l'Edge Function pms-poll-bookings, jamais depuis un Route Handler authentifié utilisateur.
create or replace function claim_pms_poll_batch(p_limit int default 20)
returns table (
  order_line_id uuid,
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
      select ol.id
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.pms_booking_id is not null
         and ol.status = 'reserved'
         and e.lobby_connector_active = true
       order by ol.pms_last_polled_at asc nulls first
       limit p_limit
       for update of ol skip locked
    )
    update public.order_lines ol
       set pms_last_polled_at = now()
      from claimed c, public.products p, public.establishments e
     where ol.id = c.id and p.id = ol.product_id and e.id = p.establishment_id
    returning ol.id, ol.pms_booking_id, e.id, e.lobby_api_token;
end;
$$;

revoke execute on function claim_pms_poll_batch(int) from public, authenticated, anon;
grant execute on function claim_pms_poll_batch(int) to service_role;
