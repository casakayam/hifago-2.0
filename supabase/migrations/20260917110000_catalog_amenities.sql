-- Équipements structurés (établissement + logement), à sélectionner via un dropdown de recherche
-- fermé — décision Jérôme du 2026-09-17. Table dédiée, séparée de `catalog_tags` : celle-ci reste
-- réservée aux catégories ÉDITORIALES d'activités (Kayak, Fiesta…), branchées sur `search_catalog`
-- et `/actividades` (20260908150000_search_catalog_tags.sql). Un équipement décrit une CHOSE que le
-- lieu/le logement possède (wifi, piscina, jacuzzi) — pas une catégorie de recherche par centre
-- d'intérêt. Les mélanger polluerait le mécanisme de bifurcation de recherche
-- (20260914110000_search_catalog_tag_bifurcation.sql), qui n'a rien à voir avec cette feature.
--
-- Patron répliqué à l'identique de `catalog_tags`/`product_tag_assignments`/
-- `establishment_tag_assignments` (20260815210000, 20260914100000) : deux tables d'assignation,
-- une par niveau, plutôt qu'une seule table polymorphe (établissement OU produit) — même
-- raisonnement que pour les tags, jamais reproblématisé ici.
--
-- ⚠️ LISTE FERMÉE, PAS DE CRÉATION À LA VOLÉE PAR L'ADMIN (contrairement à catalog_tags, qui a son
-- écran CRUD /admin/tags). Le référentiel est peuplé UNIQUEMENT par migration, contrôlé par
-- Jérôme/l'équipe dev — aucun écran admin de création/édition n'est prévu pour ces 4 tables. La
-- policy d'écriture reste admin-only pour l'ASSIGNATION (un admin choisit dans la liste), jamais
-- pour la CRÉATION de nouvelles lignes de `catalog_amenities`/`catalog_amenity_categories`, que
-- rien côté admin n'expose.
--
-- Frontière RLS/RPC-only (hifago/CLAUDE.md §3) : RLS directe sur les 4 tables. Aucun des 4 critères
-- RPC-only ne s'applique — pas de compteur de capacité, pas de verrou optimiste multi-admin, pas de
-- lecture cross-identité (un équipement est un contenu de catalogue public par nature), écriture
-- non nominative. Même calibrage que catalog_tags/product_tag_assignments/
-- establishment_tag_assignments.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Catégories d'équipement (Baño, Cocina y comedor, Piscina y bienestar…) — table de référence
-- séparée plutôt qu'un `text` libre sur `catalog_amenities.category` : donne l'intégrité
-- référentielle (pas de faute de frappe silencieuse dans une migration de seed future) ET un
-- libellé affichable {es, en} pour le regroupement sur la fiche publique, sans dupliquer ce
-- libellé sur chaque équipement de la catégorie.
create table catalog_amenity_categories (
  -- Clé stable en snake_case, jamais renommée après coup (référencée par catalog_amenities) — pas
  -- d'UUID : une vingtaine de lignes fixes, une clé lisible vaut mieux qu'un UUID opaque dans les
  -- migrations de seed qui la référencent.
  key text primary key,
  -- Même convention que catalog_tags.label : {es, en?}. Ici les DEUX langues sont attendues dans
  -- les faits (référentiel déjà traduit intégralement) mais la contrainte reste la même que
  -- catalog_tags (es seul obligatoire), pour ne pas bloquer un ajout hâtif d'une nouvelle catégorie
  -- non encore traduite.
  label jsonb not null,
  constraint catalog_amenity_categories_label_es_required
    check (label ? 'es' and btrim(label->>'es') <> ''),
  -- Ordre d'affichage des sections sur la fiche publique — jamais l'ordre alphabétique, qui
  -- mettrait "Accesibilidad" avant "Servicios básicos".
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table catalog_amenity_categories enable row level security;

create policy catalog_amenity_categories_select_public on catalog_amenity_categories
  for select using (true);

create policy catalog_amenity_categories_write_admin on catalog_amenity_categories
  for all using ((select is_admin(auth.uid())));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Le référentiel d'équipements lui-même.
create table catalog_amenities (
  id uuid primary key default gen_random_uuid(),
  -- Même convention que catalog_tags.label : {es, en?}. En pratique le seed fournit toujours les
  -- deux (référentiel déjà traduit) — la contrainte reste alignée sur catalog_tags pour ne pas
  -- diverger sans raison.
  label jsonb not null,
  constraint catalog_amenities_label_es_required
    check (label ? 'es' and btrim(label->>'es') <> ''),
  -- Jamais saisi à la main : dérivé de label.es via slugify() au moment du seed (même convention
  -- que catalog_tags.slug), unique pour prévenir les doublons quasi identiques.
  slug text not null unique,
  category_key text not null references catalog_amenity_categories(key),
  -- Purement informatif, jamais vérifié en écriture (voir en-tête de fichier) : sert à pré-trier/
  -- pré-filtrer côté admin, pas à interdire une assignation à l'autre niveau.
  recommended_level text not null default 'both'
    check (recommended_level in ('establishment', 'lodging', 'both')),
  -- « souvent payant » : un jacuzzi ou un service de lavandería sont fréquemment facturés en sus
  -- même quand ils sont listés comme équipement — affiché en note sur la fiche publique, jamais un
  -- prix réel (aucune colonne de prix ici, ce n'est pas products.price_cop).
  often_paid boolean not null default false,
  -- Ordre d'affichage au sein de sa catégorie sur la fiche publique.
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table catalog_amenities enable row level security;

create policy catalog_amenities_select_public on catalog_amenities
  for select using (true);

create policy catalog_amenities_write_admin on catalog_amenities
  for all using ((select is_admin(auth.uid())));

create index catalog_amenities_category_key_idx on catalog_amenities(category_key);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Niveau ÉTABLISSEMENT — copie littérale du patron establishment_tag_assignments.
create table establishment_amenity_assignments (
  -- Cascade des deux côtés : une assignation équipement↔établissement n'est pas de l'historique de
  -- commande, rien à préserver après suppression.
  establishment_id uuid not null references establishments(id) on delete cascade,
  amenity_id uuid not null references catalog_amenities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (establishment_id, amenity_id)
);

alter table establishment_amenity_assignments enable row level security;

-- Visibilité héritée de l'établissement parent — même idiome que establishment_tag_assignments_select.
create policy establishment_amenity_assignments_select on establishment_amenity_assignments
  for select using (exists (
    select 1 from establishments e where e.id = establishment_amenity_assignments.establishment_id
  ));

create policy establishment_amenity_assignments_write_admin on establishment_amenity_assignments
  for all using ((select is_admin(auth.uid())));

create index establishment_amenity_assignments_amenity_id_idx
  on establishment_amenity_assignments(amenity_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Niveau LOGEMENT (products.type = 'lodging') — copie littérale du patron product_tag_assignments.
-- ⚠️ Aucune contrainte DB n'impose type='lodging' ici : même précédent que product_tag_assignments,
-- qui accepte n'importe quel type de produit sans restriction en base. Le gating reste applicatif
-- (productTypeGating.hasAmenities) — un choix délibéré, pas un oubli : une contrainte CHECK
-- référençant products.type depuis une table séparée demanderait un trigger, pour une garantie que
-- l'écran admin donne déjà (le bloc ne se monte que pour un lodging).
create table product_amenity_assignments (
  product_id uuid not null references products(id) on delete cascade,
  amenity_id uuid not null references catalog_amenities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, amenity_id)
);

alter table product_amenity_assignments enable row level security;

create policy product_amenity_assignments_select on product_amenity_assignments
  for select using (exists (
    select 1 from products p where p.id = product_amenity_assignments.product_id
  ));

create policy product_amenity_assignments_write_admin on product_amenity_assignments
  for all using ((select is_admin(auth.uid())));

create index product_amenity_assignments_amenity_id_idx on product_amenity_assignments(amenity_id);
