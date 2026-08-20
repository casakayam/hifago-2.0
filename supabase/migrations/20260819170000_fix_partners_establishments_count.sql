-- Correctif — régression réelle trouvée en faisant tourner les e2e existants
-- (admin-partner-create.spec.ts), même root cause que 20260819150000, symptôme différent.
--
-- Root cause : 20260819110000_pms_connector_schema.sql a remplacé le GRANT SELECT table-large sur
-- establishments par un GRANT SELECT limité à une liste de colonnes (excluant lobby_api_token) —
-- cf. le commentaire de cette migration : confirmé empiriquement, un GRANT colonne par colonne est
-- la SEULE façon de cacher une colonne en Postgres (un GRANT table-large + REVOKE colonne ciblé ne
-- bloque rien, le grant table-large continue de couvrir la colonne). L'embed PostgREST
-- `establishments(count)` utilisé par /admin/partners (apps/admin/app/admin/partners/page.tsx)
-- compile en `select count(*) from establishments ...` : un count(*) ne référence aucune colonne,
-- donc ne peut s'appuyer sur AUCUN grant colonne par colonne — il exige le grant table-large,
-- absent depuis 20260819110000. Conséquence observée : /admin/partners affichait "Ningún partner
-- todavía." même avec des partners existants (0 ligne renvoyée, count(*) en 403 PostgREST/42501
-- avalé silencieusement par `const { data: partners } = await query` sans gestion d'erreur).
--
-- Correctif : même principe que 20260819150000 (éliminer le count(*) à la racine plutôt que
-- rouvrir le grant sur lobby_api_token) — une RPC dédiée remplace l'embed. Lecture cross-partenaires
-- (établissements de tous les partners de la page courante) déjà RPC-only par nature — vue miroir
-- admin, hifago/CLAUDE.md §3 critère 1 — jamais un candidat RLS directe de toute façon.
create or replace function public.count_partner_establishments(p_partner_ids uuid[])
returns table(partner_id uuid, establishments_count int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'count_partner_establishments réservé au rôle admin' using errcode = '42501';
  end if;

  return query
    select e.partner_id, count(*)::int
      from public.establishments e
     where e.partner_id = any(p_partner_ids)
     group by e.partner_id;
end;
$$;

grant execute on function public.count_partner_establishments(uuid[]) to authenticated;
