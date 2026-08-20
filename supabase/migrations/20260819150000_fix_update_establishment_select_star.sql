-- Correctif — régression réelle introduite par la spec 21 (connecteur LobbyPMS), trouvée en
-- FAISANT TOURNER les e2e existants (admin-establishment-edit.spec.ts), pas en écrivant le code.
--
-- Root cause : la migration 20260819110000_pms_connector_schema.sql a remplacé le GRANT SELECT
-- table-large sur establishments par un GRANT SELECT limité à une liste de colonnes (excluant
-- lobby_api_token, jamais lisible même par l'admin via PostgREST — cf. cette même migration).
-- update_establishment (20260815170000_gestion_etablissement.sql) est `security invoker` (pas
-- definer — un admin a déjà un accès RLS direct à establishments) et fait
-- `select * into v_before from public.establishments` : un `select *` exige SELECT sur TOUTES les
-- colonnes de la table, y compris lobby_api_token — désormais absent du grant de `authenticated`.
-- Conséquence observée : tout admin qui éditait N'IMPORTE QUEL établissement recevait un 403
-- PostgREST (Postgres 42501, insufficient_privilege), confirmé via le trace réseau Playwright de
-- l'e2e existant (pas seulement un établissement PMS-backed — TOUT update_establishment cassait).
--
-- Correctif : v_before ne porte plus qu'un snapshot des 6 colonnes réellement utilisées par la
-- fonction (celles écrites dans audit_log), jamais establishments%rowtype — élimine le select *
-- à la racine plutôt que de rouvrir le grant sur lobby_api_token. Signature inchangée.
create or replace function update_establishment(
  p_establishment_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_before_name jsonb;
  v_before_description jsonb;
  v_before_address text;
  v_before_lat double precision;
  v_before_lon double precision;
  v_before_operated_directly boolean;
begin
  select name, description, address, lat, lon, operated_directly
    into v_before_name, v_before_description, v_before_address,
         v_before_lat, v_before_lon, v_before_operated_directly
    from public.establishments where id = p_establishment_id;

  update public.establishments
     set name = p_name,
         description = p_description,
         address = p_address,
         lat = p_lat,
         lon = p_lon,
         operated_directly = p_operated_directly,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    raise exception 'établissement introuvable ou non autorisé';
  end if;

  perform public.log_admin_action(
    'establishment.update', 'establishments', p_establishment_id,
    jsonb_build_object(
      'name', v_before_name, 'description', v_before_description, 'address', v_before_address,
      'lat', v_before_lat, 'lon', v_before_lon, 'operated_directly', v_before_operated_directly
    ),
    jsonb_build_object(
      'name', p_name, 'description', p_description, 'address', p_address,
      'lat', p_lat, 'lon', p_lon, 'operated_directly', p_operated_directly
    ),
    p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function update_establishment(
  uuid, jsonb, jsonb, text, double precision, double precision, boolean, text
) to authenticated;
