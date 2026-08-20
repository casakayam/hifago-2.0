-- Retour Jérôme (2026-08-20) — même diagnostic que establishments.status avant
-- 20260820020000 : filtré/trié dans l'admin (list_partners_admin, écran "Partenaires") mais
-- aucune RPC ne l'a jamais transitionné. Contrairement à establishments/products/
-- partner_capabilities, aucun besoin métier décrit pour un statut au niveau du partenaire entier
-- (le modèle de Jérôme raisonne capacité/établissement/activité, jamais partenaire-organisation) —
-- retrait pur, pas de levier à construire. Décision assumée malgré le risque de collision avec
-- l'écran "Partenaires" en cours de construction (non commité) au moment de cette migration.

-- Changement de type de retour (colonne `status` en moins dans returns table) : drop explicite
-- avant de recréer, même précaution que pour un changement d'arité de paramètres.
drop function if exists list_partners_admin(
  text, text, text, text, double precision, double precision, double precision, text, boolean, int, int
);

alter table public.partners drop constraint partners_status_check;
alter table public.partners drop column status;

-- Corps copié depuis 20260819240000_partners_geo_admin_rpc.sql moins p_status/p.status (paramètre,
-- clause where, colonne retournée, 2 lignes order by, et 'status' retiré de la liste p_sort_key
-- not in (...) du tri par défaut).
create or replace function public.list_partners_admin(
  p_search text default null,
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
    case when p_sort_key = 'partner_city' and not p_sort_desc then p.partner_city end asc nulls last,
    case when p_sort_key = 'partner_city' and p_sort_desc then p.partner_city end desc nulls last,
    case when p_sort_key = 'updated_at' and not p_sort_desc then p.updated_at end asc nulls last,
    case when p_sort_key = 'updated_at' and p_sort_desc then p.updated_at end desc nulls last,
    case when p_sort_key not in ('display_name','partner_city','updated_at') and not p_sort_desc then p.created_at end asc nulls last,
    case when p_sort_key not in ('display_name','partner_city','updated_at') and p_sort_desc then p.created_at end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.list_partners_admin(
  text, text, text, double precision, double precision, double precision, text, boolean, int, int
) to authenticated;
