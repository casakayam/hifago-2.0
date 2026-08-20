-- Revue admin partenaires (Jérôme, 2026-08-19) — recherche géographique réelle pour filtrer
-- /admin/partners. Constats vérifiés empiriquement avant d'écrire ce fichier (instance locale) :
-- 0/32 partenaires ont des coordonnées aujourd'hui (une seule ligne partner_crm_profile existe au
-- total, sans lat/lon), aucune RPC d'écriture n'existait pour ce profil hors création
-- (create_partner_direct), et PostGIS n'est pas activé (0 ligne pg_extension, bien que disponible
-- dans l'image) — Haversine en SQL brut plutôt que ST_DWithin : à 32 partenaires, un calcul de
-- distance sur chaque ligne coûte l'ordre de la microseconde, rien à optimiser par un type
-- geography. Décision assumée, pas une impasse technique.

-- 1. haversine_km — distance en km entre deux points (lat/lon en degrés décimaux), réutilisable.
create or replace function public.haversine_km(
  p_lat1 double precision, p_lon1 double precision,
  p_lat2 double precision, p_lon2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371 * asin(
    sqrt(
      sin(radians(p_lat2 - p_lat1) / 2) ^ 2
      + cos(radians(p_lat1)) * cos(radians(p_lat2)) * sin(radians(p_lon2 - p_lon1) / 2) ^ 2
    )
  );
$$;

grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to authenticated;

-- 2. set_partner_location — seule RPC d'écriture sur partner_crm_profile hors création
-- (create_partner_direct). Admin uniquement : aucune UI socio n'écrit ce profil aujourd'hui, pas
-- de socle à étendre pour l'instant (extensible plus tard, le contrôle est isolé sur une ligne).
-- upsert : la ligne partner_crm_profile n'existe pour AUCUN partenaire créé avant cette feature
-- (31/32 aujourd'hui) — un simple update échouerait silencieusement (0 ligne affectée).
create or replace function public.set_partner_location(
  p_partner_id uuid,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_partner_location réservé au rôle admin' using errcode = '42501';
  end if;

  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'partner introuvable';
  end if;

  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'latitud fuera de rango (-90..90)';
  end if;
  if p_lon is not null and (p_lon < -180 or p_lon > 180) then
    raise exception 'longitud fuera de rango (-180..180)';
  end if;

  select jsonb_build_object('address', pcp.address, 'lat', pcp.lat, 'lon', pcp.lon)
    into v_before
    from public.partner_crm_profile pcp
   where pcp.partner_id = p_partner_id;

  insert into public.partner_crm_profile (partner_id, address, lat, lon)
  values (p_partner_id, p_address, p_lat, p_lon)
  on conflict (partner_id) do update
    set address = excluded.address,
        lat = excluded.lat,
        lon = excluded.lon,
        updated_at = now();

  perform public.log_admin_action(
    'partner.set_location', 'partners', p_partner_id,
    v_before,
    jsonb_build_object('address', p_address, 'lat', p_lat, 'lon', p_lon),
    null
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.set_partner_location(uuid, text, double precision, double precision) to authenticated;

-- 3. list_partners_admin — remplace la query .from("partners") + count_partner_establishments de
-- apps/admin/app/admin/partners/page.tsx. RPC-only par nature (lecture cross-partenaires, vue
-- miroir admin, hifago/CLAUDE.md §3 critère 1) + le filtre par rayon est structurellement
-- impossible à exprimer en .or()/.filter() PostgREST.
--
-- active_roles : reproduit fidèlement le calcul actuel côté page.tsx (string_agg des rôles ACTIFS
-- — un partner avec 2 capacités operator actives, une par établissement, autorisé par
-- partner_capabilities_operator_establishment_idx, affichera "operator, operator", exactement
-- comme aujourd'hui côté TS, sans distinct — comportement préexistant reproduit à l'identique).
--
-- Filtre p_role : reproduit EXACTEMENT la sémantique actuelle (.eq("partner_capabilities.role",
-- ...) sans condition de statut) — montre un partenaire qui a DÉJÀ EU cette capacité (active,
-- suspended ou pending_review), pas seulement les capacités actives. Comportement préexistant
-- préservé à l'identique (fidélité de migration, pas une décision produit prise ici).
--
-- Filtre rayon : LEFT JOIN partner_crm_profile (pas INNER) — 31/32 partenaires n'ont AUCUNE ligne
-- dans cette table aujourd'hui ; un INNER JOIN ferait disparaître silencieusement la quasi-totalité
-- de la liste même SANS filtre de rayon actif. La condition de distance n'exclut que si le filtre
-- est réellement actif (p_lat/p_lon/p_radius_km tous non-null) ET que la ligne n'a pas de
-- coordonnées connues — partenaire sans position ⇒ exclu (pas de preuve qu'il est dans le rayon).
create or replace function public.list_partners_admin(
  p_search text default null,
  p_status text default null,
  p_role text default null,
  p_city text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_radius_km double precision default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  display_name text,
  status text,
  active_roles text,
  establishments_count int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_partners_admin réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.status,
    coalesce((
      select string_agg(pc.role, ', ' order by pc.role)
        from public.partner_capabilities pc
       where pc.partner_id = p.id and pc.status = 'active'
    ), ''),
    coalesce(ec.establishments_count, 0)::int,
    count(*) over()
  from public.partners p
  left join public.partner_crm_profile pcp on pcp.partner_id = p.id
  left join lateral (
    select count(*) as establishments_count
    from public.establishments e
    where e.partner_id = p.id
  ) ec on true
  where
    (p_search is null or p.display_name ilike '%' || p_search || '%' or p.email ilike '%' || p_search || '%')
    and (p_status is null or p.status = p_status)
    and (
      p_role is null or exists (
        select 1 from public.partner_capabilities pc2
        where pc2.partner_id = p.id and pc2.role = p_role
      )
    )
    and (p_city is null or p.partner_city ilike '%' || p_city || '%')
    and (
      p_lat is null or p_lon is null or p_radius_km is null
      or (
        pcp.lat is not null and pcp.lon is not null
        and public.haversine_km(p_lat, p_lon, pcp.lat, pcp.lon) <= p_radius_km
      )
    )
  order by
    case when p_sort_key = 'display_name' and not p_sort_desc then p.display_name end asc nulls last,
    case when p_sort_key = 'display_name' and p_sort_desc then p.display_name end desc nulls last,
    case when p_sort_key = 'status' and not p_sort_desc then p.status end asc nulls last,
    case when p_sort_key = 'status' and p_sort_desc then p.status end desc nulls last,
    case when p_sort_key = 'partner_city' and not p_sort_desc then p.partner_city end asc nulls last,
    case when p_sort_key = 'partner_city' and p_sort_desc then p.partner_city end desc nulls last,
    case when p_sort_key = 'updated_at' and not p_sort_desc then p.updated_at end asc nulls last,
    case when p_sort_key = 'updated_at' and p_sort_desc then p.updated_at end desc nulls last,
    case when p_sort_key not in ('display_name','status','partner_city','updated_at') and not p_sort_desc then p.created_at end asc nulls last,
    case when p_sort_key not in ('display_name','status','partner_city','updated_at') and p_sort_desc then p.created_at end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.list_partners_admin(
  text, text, text, text, double precision, double precision, double precision, text, boolean, int, int
) to authenticated;

-- Supersédée par list_partners_admin ci-dessus (establishments_count désormais calculé dans la
-- même RPC security definer, qui n'a pas besoin du grant SELECT table-large manquant sur
-- establishments) — seul appelant (apps/admin/app/admin/partners/page.tsx) réécrit dans ce même
-- lot, grep confirmé avant suppression.
drop function if exists public.count_partner_establishments(uuid[]);
