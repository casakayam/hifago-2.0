-- Spec 21 — Connecteur LobbyPMS, Phase 1 : schéma. Un jeton PAR ÉTABLISSEMENT (jamais un jeton
-- global comme le legacy LOBBY_API_TOKEN) — cohérent avec le contrat générique multi-prestataire
-- déjà validé (01-cahier-des-charges-client.md §5) et le précédent dormant legacy
-- providers.lobby_api_token (jamais branché, cf. spec 21 §3).
--
-- lobby_api_token illisible même par l'admin via PostgREST : une policy RLS est scopée par LIGNE,
-- pas par colonne — establishments_select autorise déjà l'admin ET le partenaire propriétaire à
-- lire la ligne, donc RLS ne peut pas cacher cette seule colonne au socio tout en la montrant à
-- l'admin sous le même rôle Postgres `authenticated`. Un REVOKE au niveau colonne est la seule
-- protection possible ici — personne ne le lit jamais via PostgREST, admin compris (cohérent avec
-- la spec §5 : « jamais renvoyé en clair après saisie », l'écran n'a donc jamais besoin de le
-- relire). lobby_has_token (dérivée, non secrète) porte l'affichage « configuré : oui/non ».
alter table establishments
  add column lobby_api_token text,
  add column lobby_connector_active boolean not null default false,
  add column lobby_last_synced_at timestamptz,
  add column lobby_has_token boolean generated always as (lobby_api_token is not null) stored;

-- Un REVOKE SELECT(colonne) seul ne suffit PAS : establishments a déjà un GRANT SELECT
-- table-large sur authenticated/anon (ALTER DEFAULT PRIVILEGES, 20260813163456_identity_rls.sql),
-- et en Postgres un grant table-level continue de couvrir une colonne même après un revoke
-- column-level ciblé (confirmé empiriquement par has_column_privilege dans le test pgTAP associé
-- avant ce correctif). Seule combinaison qui bloque réellement la colonne : REVOKE SELECT sur
-- toute la table, puis GRANT SELECT explicite sur les autres colonnes.
revoke select on establishments from authenticated, anon;
grant select (
  id, partner_id, name, status, created_at, updated_at, description, address, lat, lon,
  operated_directly, lobby_connector_active, lobby_last_synced_at, lobby_has_token
) on establishments to authenticated, anon;

-- RPC-only en écriture (cf. hifago/CLAUDE.md §3 : donnée admin-only, écriture nominative
-- auditable) — même patron que set_establishment_payout_account (20260818130000).
create or replace function set_establishment_pms_connector(
  p_establishment_id uuid,
  p_lobby_api_token text default null, -- null = ne remplace pas le jeton existant
  p_connector_active boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before record;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_establishment_pms_connector réservé au rôle admin' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier le connecteur PMS';
  end if;

  select lobby_connector_active, lobby_has_token into v_before
    from public.establishments where id = p_establishment_id for update;
  if not found then
    raise exception 'établissement introuvable';
  end if;

  update public.establishments
     set lobby_api_token = coalesce(p_lobby_api_token, lobby_api_token),
         lobby_connector_active = p_connector_active
   where id = p_establishment_id;

  perform public.log_admin_action(
    'establishment.set_pms_connector', 'establishments', p_establishment_id,
    jsonb_build_object('connector_active', v_before.lobby_connector_active, 'had_token', v_before.lobby_has_token),
    jsonb_build_object('connector_active', p_connector_active, 'token_replaced', p_lobby_api_token is not null),
    p_reason
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_establishment_pms_connector(uuid, text, boolean, text) to authenticated;

-- order_lines : identifiant du booking Lobby (pour cibler le poll/l'annulation) + curseur de poll
-- (fenêtre glissante équitable — nécessaire pour qu'un lot borné en taille finisse par couvrir
-- toutes les réservations actives, cf. claim_pms_poll_batch).
alter table order_lines
  add column pms_booking_id text,
  add column pms_last_polled_at timestamptz;

create index order_lines_pms_poll_idx on order_lines (pms_last_polled_at)
  where pms_booking_id is not null and status = 'reserved';

-- products.lobby_category_id/lobby_product_id (20260813190232) et product_room_types.* (20260816110000,
-- hors périmètre Tranche 1) existent déjà — aucune migration nécessaire pour eux.
