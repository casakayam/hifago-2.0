-- Spec 08 (Admin : gestion CRUD d'une activité — tags de catégorisation) — remplace la catégorie
-- fixe actuelle (products.category, 6 valeurs) côté écran admin direct, cf. audit
-- 00-modele-de-donnees.md §3 et cahier admin §3c : "l'admin crée/corrige/retire les tags — y
-- compris ceux proposés par un prestataire".
--
-- Nom catalog_tags (pas product_tags) : le cahier décrit un système de tags PARTAGÉ entre
-- établissements et produits (00-modele-de-donnees.md, décision client §2) ; cette spec ne
-- construit que l'assignation produit, mais le nom générique évite un renommage futur. Écho
-- délibéré à catalog-media (spec 04). Pas de collision avec partner_crm_profile.tags (text[], CRM
-- partenaire, concept différent).
--
-- Frontière RLS/RPC-only (hifago/CLAUDE.md §3) : RLS directe sur les deux tables. Aucun des 4
-- critères ne s'applique — pas de compteur de capacité, pas de verrou optimiste multi-admin, pas
-- de lecture cross-identité (un tag est un contenu de catalogue public par nature), et l'écriture
-- n'est pas plus "nominative" que products.category aujourd'hui (jamais auditée). Même calibrage
-- que product_media (spec 04).
create table catalog_tags (
  id uuid primary key default gen_random_uuid(),
  -- Même convention que products.name/description : {es, en?}. L'identifiant stable (id/slug) ne
  -- change jamais de langue, seul le libellé affiché varie.
  label jsonb not null,
  constraint catalog_tags_label_es_required check (label ? 'es' and btrim(label->>'es') <> ''),
  -- Jamais saisi manuellement — dérivé de label.es via slugify() côté client (même convention que
  -- products.slug), unique pour prévenir les doublons quasi identiques.
  slug text not null unique,
  created_at timestamptz not null default now()
);

alter table catalog_tags enable row level security;

create policy catalog_tags_select_public on catalog_tags
  for select using (true);

create policy catalog_tags_write_admin on catalog_tags
  for all using ((select is_admin(auth.uid())));

create table product_tag_assignments (
  -- Cascade des deux côtés (contrairement à product_calendar/product_availability/
  -- product_proposals, cf. 20260815220000_delete_product_rpc.sql) : une assignation tag↔produit
  -- n'est PAS de l'historique de commande — rien à préserver après suppression du produit ou du
  -- tag.
  product_id uuid not null references products(id) on delete cascade,
  tag_id uuid not null references catalog_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, tag_id)
);

alter table product_tag_assignments enable row level security;

-- Visibilité héritée du produit parent (même idiome que product_media_select, spec 04) : le
-- sous-select re-traverse products_select_public/products_select_own — jamais dupliqué ici.
create policy product_tag_assignments_select on product_tag_assignments
  for select using (exists (
    select 1 from products p where p.id = product_tag_assignments.product_id
  ));

create policy product_tag_assignments_write_admin on product_tag_assignments
  for all using ((select is_admin(auth.uid())));

create index product_tag_assignments_tag_id_idx on product_tag_assignments(tag_id);
