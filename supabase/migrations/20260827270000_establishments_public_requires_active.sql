-- `establishments_select_public` exige désormais `status = 'active'` — trouvé par la revue
-- `/simplify` du 2026-08-27, sous l'angle « la règle est-elle à la bonne altitude ».
--
-- LE DÉFAUT. La dépublication d'un établissement (`set_establishment_status('archived')`)
-- n'existait, sur toute la surface publique, que dans le `.eq("status", "active")` de la requête de
-- la page établissement (20260827200000). La policy, elle, n'autorisait que sur « porte au moins un
-- produit sellable » — sans aucune condition de statut. Or `status` fait explicitement partie du
-- `grant select (…)` accordé à `anon` (20260819110000) : un `GET /rest/v1/establishments?slug=eq.x`
-- anonyme lisait donc nom, description, adresse, horaires et mode d'un établissement dépublié.
--
-- La preuve que la règle était mal placée tenait dans le catalogue : `apps/web/app/[locale]/page.tsx`
-- interrogeait `establishments` SANS ce filtre et fabriquait une carte groupée pointant vers une
-- page qui, elle, répondait 404. Deux lectures de la même table, deux règles différentes, parce
-- qu'aucune des deux ne venait de la base. Le filtre applicatif a été ajouté dans le même commit,
-- mais il redevient ce qu'il aurait toujours dû être : de la défense en profondeur.
--
-- POURQUOI CETTE POLICY ET PAS UNE AUTRE. `establishments_select` (20260813210000) couvre l'admin
-- et le partenaire propriétaire, sans condition de statut : un admin continue donc de voir et
-- d'administrer un établissement archivé, et le socio le sien. Postgres combine les policies
-- permissives en OR — restreindre celle-ci ne retire rien à personne d'autre que l'anonyme.
--
-- Pas d'échappatoire `or is_admin(...)` ici, contrairement à `products_select_public` : elle serait
-- redondante avec `establishments_select`, qui la porte déjà.

drop policy establishments_select_public on public.establishments;

create policy establishments_select_public on public.establishments
  for select
  using (
    status = 'active'
    and exists (
      select 1 from public.products p
      where p.establishment_id = establishments.id and p.sellable = true
    )
  );
