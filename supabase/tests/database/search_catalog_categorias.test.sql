-- Chantier "catégories partout" (2026-09-14) — `search_catalog_categorias`, qui remplace
-- `search_catalog_tags` : les catégories d'UN type, chacune avec ses items PLAFONNÉS. Généralise
-- le pattern de section de l'accueil (spec 28) à `/es/actividades`, `/es/alojamientos`, etc.
--
-- ⚠️ CHAQUE assertion est SCOPÉE sur les fixtures de ce fichier (préfixe `cccc3333-`, slugs
-- `scc-…`), jamais sur un comptage global : la base locale accumule des données d'e2e au fil des
-- exécutions (cf. docs/backlog.md).
--
-- ⚠️ ET LE SCOPAGE A UNE LIMITE ICI, qu'il faut connaître : la catégorie de rattrapage
-- (`es_sin_tag`) est agrégée sur TOUT le catalogue du type — son `total_categoria` compte les
-- offres non taguées de la base entière, pas seulement les nôtres. On affirme donc sa PRÉSENCE ou
-- son ABSENCE, jamais son compte. Même leçon que `search_catalog.test.sql` (2026-09-07).
--
-- Tout tourne en `anon` : le rôle réel d'un visiteur, ce qui vérifie du même geste que les policies
-- `_select_public`/`establishment_tag_assignments_select` laissent bien passer ce qu'il faut.

begin;
select plan(14);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('cccc3333-0000-0000-0000-000000000001', 'Search Catalog Categorias Test Partner');

-- Établissement A : un seul couchage/activité — jamais groupé (les activités ne le sont jamais).
-- Établissement B : DEUX couchages vendables — groupé en une carte, pour la bifurcation.
insert into establishments (id, partner_id, name, status) values
  ('cccc3333-0000-0000-0000-00000000000a', 'cccc3333-0000-0000-0000-000000000001',
   '{"es":"Operador SCC"}'::jsonb, 'active'),
  ('cccc3333-0000-0000-0000-00000000000b', 'cccc3333-0000-0000-0000-000000000001',
   '{"es":"Hotel Agrupado SCC"}'::jsonb, 'active');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, capacity, max_qty, schedule)
values
  -- Deux activités, la même catégorie « scc-kayak » — pour prouver le plafond ET le regroupement.
  ('cccc3333-0000-0000-0000-000000000101', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'activity', 'scc-taguee-1',
   '{"es":"Sccunico actividad taguée un"}'::jsonb, 50000, true, null, 2, 'date'),
  ('cccc3333-0000-0000-0000-000000000102', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'activity', 'scc-taguee-2',
   '{"es":"Sccunico actividad taguée deux"}'::jsonb, 50000, true, null, 2, 'date'),
  -- Taguée elle aussi, mais NON VENDABLE : ne doit compter nulle part.
  ('cccc3333-0000-0000-0000-000000000103', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'activity', 'scc-no-vendible',
   '{"es":"Sccunico no vendible"}'::jsonb, 50000, false, null, null, 'date'),
  -- Une activité SANS aucun tag — rattrapée par la catégorie de rattrapage.
  ('cccc3333-0000-0000-0000-000000000104', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'activity', 'scc-sans-tag',
   '{"es":"Sccunico sans tag"}'::jsonb, 50000, true, null, null, 'date'),
  -- Hotel Agrupado (B) : deux couchages vendables → carte ÉTABLISSEMENT groupée.
  ('cccc3333-0000-0000-0000-000000000201', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000b', 'lodging', 'scc-hab-b1',
   '{"es":"Hab B1"}'::jsonb, 90000, true, 2, null, 'date'),
  ('cccc3333-0000-0000-0000-000000000202', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000b', 'lodging', 'scc-hab-b2',
   '{"es":"Hab B2"}'::jsonb, 95000, true, 2, null, 'date');

insert into catalog_tags (id, label, slug, description, image_path) values
  ('cccc3333-0000-0000-0000-000000000301', '{"es":"Kayak SCC"}'::jsonb, 'scc-kayak',
   '{"es":"Texto editorial de prueba"}'::jsonb, 'tags/scc-kayak.webp'),
  ('cccc3333-0000-0000-0000-000000000302', '{"es":"Piscina SCC"}'::jsonb, 'scc-piscina', null, null),
  -- Jamais assignée à rien : ne doit jamais apparaître (cahier §2a).
  ('cccc3333-0000-0000-0000-000000000303', '{"es":"Vacía SCC"}'::jsonb, 'scc-vacia', null, null);

insert into product_tag_assignments (product_id, tag_id) values
  ('cccc3333-0000-0000-0000-000000000101', 'cccc3333-0000-0000-0000-000000000301'),
  ('cccc3333-0000-0000-0000-000000000102', 'cccc3333-0000-0000-0000-000000000301'),
  ('cccc3333-0000-0000-0000-000000000103', 'cccc3333-0000-0000-0000-000000000301');

-- Le tag est posé sur l'ÉTABLISSEMENT groupé, jamais sur une de ses chambres — c'est la bifurcation
-- que cette RPC applique elle-même (indépendamment de `search_catalog`, cf. `etiquetas` dans sa
-- définition).
insert into establishment_tag_assignments (establishment_id, tag_id) values
  ('cccc3333-0000-0000-0000-00000000000b', 'cccc3333-0000-0000-0000-000000000302');

set local role anon;

-- ── Regroupement et plafond par catégorie ───────────────────────────────────────────────────────
select is(
  (select total_categoria::int from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where categoria_slug = 'scc-kayak' limit 1),
  2, 'une catégorie de deux offres vendables compte 2 AVANT plafonnement'
);

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 1)
   where categoria_slug = 'scc-kayak'),
  1, 'le plafond par catégorie limite bien le nombre de LIGNES rendues'
);

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where slug = 'scc-no-vendible'),
  0, 'une offre non vendable n''apparaît dans AUCUNE catégorie'
);

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where categoria_slug = 'scc-vacia'),
  0, 'une catégorie sans aucune offre n''apparaît JAMAIS (cahier §2a)'
);

-- ── La catégorie de rattrapage ───────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where es_sin_tag and slug = 'scc-sans-tag'),
  1, 'une offre qu''aucun tag ne classe apparaît dans la catégorie de rattrapage'
);

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where es_sin_tag and slug = 'scc-taguee-1'),
  0, '…et une offre CLASSÉE n''y apparaît pas en plus de sa vraie catégorie'
);

-- ── Contenu éditorial ────────────────────────────────────────────────────────────────────────────
select is(
  (select categoria_description ->> 'es' from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where categoria_slug = 'scc-kayak' limit 1),
  'Texto editorial de prueba', 'le texte de la catégorie est rendu, résolvable par locale'
);

select is(
  (select categoria_image_path from search_catalog_categorias(p_tipo => 'activity', p_por_categoria => 10)
   where categoria_slug = 'scc-kayak' limit 1),
  'tags/scc-kayak.webp', 'le chemin de l''image est rendu tel quel — la couche résout l''URL'
);

-- ── Bifurcation établissement/produit (propre à cette RPC, pas seulement à search_catalog) ────────
select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'lodging', p_por_categoria => 10)
   where categoria_slug = 'scc-piscina' and es_establecimiento
     and id = 'cccc3333-0000-0000-0000-00000000000b'),
  1, 'un tag posé sur l''ÉTABLISSEMENT groupé range sa carte groupée dans la catégorie'
);

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'lodging', p_por_categoria => 10)
   where id in ('cccc3333-0000-0000-0000-000000000201', 'cccc3333-0000-0000-0000-000000000202')),
  0, 'les CHAMBRES d''un établissement groupé n''apparaissent jamais individuellement ici'
);

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'lodging', p_por_categoria => 10)
   where es_sin_tag and es_establecimiento
     and id = 'cccc3333-0000-0000-0000-00000000000b'),
  0, 'une carte groupée déjà classée n''apparaît pas AUSSI dans le rattrapage'
);

-- ── Les critères de recherche s'appliquent, sans être recopiés ──────────────────────────────────
-- `scc-taguee-1`/`scc-taguee-2` sont bornées à `max_qty = 2` : au-delà, elles sortent — donc la
-- catégorie aussi. Preuve que les six prédicats de `search_catalog` s'appliquent ici sans avoir été
-- redéfinis (même convention que l'ex-`search_catalog_tags`, cf. commentaire de tête de la RPC).
select is(
  (select count(*)::int from search_catalog_categorias(
     p_tipo => 'activity', p_por_categoria => 10, p_personas => 5)
   where categoria_slug = 'scc-kayak'),
  0, 'un critère qui exclut toutes les offres d''une catégorie fait disparaître la catégorie'
);

select is(
  (select count(*)::int from search_catalog_categorias(
     p_tipo => 'activity', p_por_categoria => 10, p_query => 'Sccunico actividad taguée un')
   where categoria_slug = 'scc-kayak'),
  1, 'un texte libre filtre les cartes ET conserve la catégorie tant qu''une offre répond'
);

-- ── Le type isole bien ses catégories ────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'lodging', p_por_categoria => 10)
   where categoria_slug = 'scc-kayak'),
  0, 'une catégorie d''un AUTRE type ne remonte pas — le même slug ne mélange jamais deux types'
);

select * from finish();
rollback;
