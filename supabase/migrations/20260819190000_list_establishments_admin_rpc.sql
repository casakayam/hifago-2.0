-- Revue admin établissements (Jérôme, 2026-08-19) — RPC list_establishments_admin.
--
-- Remplace la query .from("establishments") de apps/admin/app/admin/establishments/page.tsx.
-- Deux raisons cumulées, vérifiées empiriquement avant d'écrire cette migration :
--
-- 1. Recherche unifiée nom établissement + nom partenaire. Un or=() PostgREST ne peut pas
--    combiner une colonne de la table de base (establishments.name) avec une colonne d'une
--    relation embarquée (partners.display_name) — testé en direct contre l'instance locale
--    (GET .../establishments?select=...&or=(name->>es.ilike.*a*,partner.display_name.ilike.*a*)
--    → 400 PGRST100 "failed to parse logic tree"), quel que soit l'alias de table utilisé. Les
--    deux seuls .or() existants du projet (apps/admin/app/admin/partners/page.tsx,
--    apps/admin/app/admin/tags/page.tsx) ne combinent d'ailleurs que des colonnes de la MÊME
--    table — jamais reproduit ici pour cette raison.
-- 2. establishments n'a plus de GRANT SELECT table-large depuis 20260819110000 (colonne
--    lobby_api_token cachée, grants colonne par colonne). Un count(*) over() (nécessaire pour la
--    pagination) exige ce grant table-large, absent — même root cause et même correctif que
--    count_partner_establishments (20260819170000_fix_partners_establishments_count.sql).
--
-- Lecture cross-partenaires (établissements de tous les partenaires + statut de capacité d'un
-- tiers) : RPC-only par nature de toute façon (hifago/CLAUDE.md §3 critère 1 — vue miroir admin),
-- indépendamment des deux points ci-dessus.
--
-- Deux indicateurs additionnels calculés, jamais de nouvelle valeur sur establishments.status
-- (reste volontairement 'active'/'archived') :
-- - pending_proposal_* : une édition ou un ajout de photos en attente de validation sur CET
--   établissement (establishment_proposals, kind in ('edit','photos'), status='pending'). Un
--   kind='create' pending n'a jamais establishment_id renseigné (contrainte
--   establishment_proposals_scope, 20260815170000) — structurellement exclu ici, ne peut jamais
--   concerner une ligne déjà listée. Si edit et photos sont pending en même temps (rare, rien ne
--   l'empêche au schéma), la plus récente gagne — un seul badge affiché à la fois, limitation
--   assumée, pas bloquante.
-- - operator_inactive : établissement actif dont AUCUNE capacité operator scopée à CET
--   établissement n'est active — cas réel confirmé (pas hypothétique) : create_establishment crée
--   la capacité operator en 'onboarding' (jamais 'active' à la création), et
--   offboarding_revoke_capability suspend la capacité operator sans jamais toucher
--   establishments.status.
create or replace function public.list_establishments_admin(
  p_search text default null,
  p_status text default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  name jsonb,
  status text,
  partner_id uuid,
  partner_display_name text,
  activities_count int,
  pending_proposal_id uuid,
  pending_proposal_kind text,
  operator_inactive boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_establishments_admin réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.name,
    e.status,
    e.partner_id,
    p.display_name,
    coalesce(ac.activities_count, 0)::int,
    pp.id,
    pp.kind,
    (e.status = 'active' and not exists (
      select 1 from public.partner_capabilities pc
      where pc.partner_id = e.partner_id
        and pc.role = 'operator'
        and pc.establishment_id = e.id
        and pc.status = 'active'
    )),
    count(*) over()
  from public.establishments e
  join public.partners p on p.id = e.partner_id
  left join lateral (
    select count(*) as activities_count
    from public.products pr
    where pr.establishment_id = e.id
  ) ac on true
  left join lateral (
    select ep.id, ep.kind
    from public.establishment_proposals ep
    where ep.establishment_id = e.id
      and ep.status = 'pending'
      and ep.kind in ('edit', 'photos')
    order by ep.created_at desc
    limit 1
  ) pp on true
  where
    (p_search is null or e.name ->> 'es' ilike '%' || p_search || '%'
                       or p.display_name ilike '%' || p_search || '%')
    and (p_status is null or e.status = p_status)
  -- Même invariant que ESTABLISHMENTS_SORT_WHITELIST côté TS (sortable-columns.ts) : p_sort_key
  -- ne pilote jamais un ORDER BY dynamique — reproduit ici en CASE statique, défense en
  -- profondeur (protège aussi un futur appelant direct de la RPC, hors du layer TS). Clé
  -- inconnue ⇒ repli sur created_at, même posture défensive que la whitelist TS.
  order by
    case when p_sort_key = 'name' and not p_sort_desc then e.name ->> 'es' end asc nulls last,
    case when p_sort_key = 'name' and p_sort_desc then e.name ->> 'es' end desc nulls last,
    case when p_sort_key = 'status' and not p_sort_desc then e.status end asc nulls last,
    case when p_sort_key = 'status' and p_sort_desc then e.status end desc nulls last,
    case when p_sort_key = 'updated_at' and not p_sort_desc then e.updated_at end asc nulls last,
    case when p_sort_key = 'updated_at' and p_sort_desc then e.updated_at end desc nulls last,
    case when p_sort_key not in ('name', 'status', 'updated_at') and not p_sort_desc then e.created_at end asc nulls last,
    case when p_sort_key not in ('name', 'status', 'updated_at') and p_sort_desc then e.created_at end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.list_establishments_admin(text, text, text, boolean, int, int) to authenticated;
