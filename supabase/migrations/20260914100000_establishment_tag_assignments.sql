-- Généralisation des catégories à tout type de listing (chantier "catégories partout", 2026-09-14)
-- — cf. `docs/specs/29-vitrine-listings-et-index-de-categories.md` (révisée par ce chantier) et le
-- commentaire de tête de `20260815210000_catalog_tags.sql` : « le cahier décrit un système de tags
-- PARTAGÉ entre établissements et produits ; cette spec ne construit que l'assignation produit,
-- mais le nom générique évite un renommage futur » — c'est ce trou que cette migration comble.
--
-- POURQUOI UNE TABLE SÉPARÉE, PAS UN RÉEMPLOI DE `product_tag_assignments`. Un tag éditorial comme
-- « Con piscina »/« Frente al mar » décrit le LIEU, pas une chambre précise. `/alojamientos`
-- affiche un établissement à ≥2 couchages vendables comme UNE SEULE carte groupée
-- (`search_catalog`, `es_establecimiento = true`) : assigner un tag à une seule chambre parmi
-- cinq pour le faire « remonter » serait une UX admin absurde (quelle chambre a la piscine ?).
-- `product_tag_assignments` reste la source pour toute carte NON groupée (tout autre type, et un
-- établissement à un seul couchage, qui s'affiche lui-même comme carte produit individuelle) —
-- inchangé, aucune régression.
--
-- Frontière RLS/RPC-only (hifago/CLAUDE.md §3) : RLS directe, même calibrage EXACT que
-- `product_tag_assignments` (même migration ci-dessus) — pas de compteur de capacité, pas de
-- verrou optimiste multi-admin, pas de lecture cross-identité (un tag est un contenu de catalogue
-- public par nature), écriture non nominative.
create table establishment_tag_assignments (
  -- Cascade des deux côtés, même raisonnement que product_tag_assignments : une assignation
  -- tag↔établissement n'est pas de l'historique de commande, rien à préserver après suppression.
  establishment_id uuid not null references establishments(id) on delete cascade,
  tag_id           uuid not null references catalog_tags(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (establishment_id, tag_id)
);

alter table establishment_tag_assignments enable row level security;

-- Visibilité héritée de l'établissement parent — même idiome que product_tag_assignments_select.
create policy establishment_tag_assignments_select on establishment_tag_assignments
  for select using (exists (
    select 1 from establishments e where e.id = establishment_tag_assignments.establishment_id
  ));

create policy establishment_tag_assignments_write_admin on establishment_tag_assignments
  for all using ((select is_admin(auth.uid())));

create index establishment_tag_assignments_tag_id_idx on establishment_tag_assignments(tag_id);
