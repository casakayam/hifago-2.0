-- Spec 29 (Tranche 2) — `search_catalog_tags`, l'index des catégories de `/es/actividades`.
--
-- ⚠️ CHAQUE assertion est SCOPÉE sur les fixtures de ce fichier (préfixe `cccc3333-`, slugs
-- `sct-…`), jamais sur un comptage global : la base locale accumule des données d'e2e au fil des
-- exécutions, et six fichiers pgTAP de ce dossier en souffrent déjà (cf. docs/backlog.md).
--
-- ⚠️ ET LE SCOPAGE A UNE LIMITE ICI, qu'il faut connaître : la ligne « sans tag » est UNIQUE et
-- AGRÉGÉE sur tout le catalogue — son `total` compte les activités non taguées de la base entière,
-- pas seulement les nôtres. On affirme donc sa PRÉSENCE ou son ABSENCE, jamais son compte. C'est
-- exactement la leçon du 2026-09-07, où un `p_limite` par défaut avait fait passer ce dossier de
-- vert à six assertions rouges sans qu'une ligne de SQL ait bougé.
--
-- Tout tourne en `anon` : le rôle réel d'un visiteur, ce qui vérifie du même geste que les policies
-- `_select_public` laissent bien passer ce qu'il faut.

begin;
select plan(10);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('cccc3333-0000-0000-0000-000000000001', 'Search Catalog Tags Test Partner');

insert into establishments (id, partner_id, name, status) values
  ('cccc3333-0000-0000-0000-00000000000a', 'cccc3333-0000-0000-0000-000000000001',
   '{"es":"Operador SCT"}'::jsonb, 'active');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, max_qty, schedule)
values
  -- Taguée « sct-kayak », et trouvable par le mot « Sctunico ».
  ('cccc3333-0000-0000-0000-000000000101', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'activity', 'sct-taguee',
   '{"es":"Sctunico actividad taguée"}'::jsonb, 50000, true, 2, 'date'),
  -- Taguée elle aussi, mais NON VENDABLE : elle ne doit compter nulle part.
  ('cccc3333-0000-0000-0000-000000000102', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'activity', 'sct-no-vendible',
   '{"es":"Sctunico no vendible"}'::jsonb, 50000, false, null, 'date'),
  -- Un LOGEMENT portant le même tag : il ne doit pas remonter dans l'index des ACTIVITÉS.
  ('cccc3333-0000-0000-0000-000000000103', 'cccc3333-0000-0000-0000-000000000001',
   'cccc3333-0000-0000-0000-00000000000a', 'lodging', 'sct-alojamiento',
   '{"es":"Sctunico alojamiento"}'::jsonb, 90000, true, null, 'date');

insert into catalog_tags (id, label, slug, description, image_path) values
  ('cccc3333-0000-0000-0000-000000000301', '{"es":"Kayak SCT"}'::jsonb, 'sct-kayak',
   '{"es":"Texto editorial de prueba"}'::jsonb, 'tags/sct-kayak.webp'),
  -- Une catégorie qui n'est assignée à RIEN : elle ne doit jamais apparaître (cahier §2a).
  ('cccc3333-0000-0000-0000-000000000302', '{"es":"Vacía SCT"}'::jsonb, 'sct-vacia', null, null),
  -- Une catégorie assignée uniquement à une offre NON vendable : invisible aussi.
  ('cccc3333-0000-0000-0000-000000000303', '{"es":"Oculta SCT"}'::jsonb, 'sct-oculta', null, null);

insert into product_tag_assignments (product_id, tag_id) values
  ('cccc3333-0000-0000-0000-000000000101', 'cccc3333-0000-0000-0000-000000000301'),
  ('cccc3333-0000-0000-0000-000000000102', 'cccc3333-0000-0000-0000-000000000303'),
  ('cccc3333-0000-0000-0000-000000000103', 'cccc3333-0000-0000-0000-000000000301');

-- ── Le slug réservé (spec 29 §6a) ───────────────────────────────────────────────────────────────
-- ⚠️ Vérifié EN TANT QUE POSTGRES, avant le passage en `anon` : une policy RLS refuserait l'écriture
-- avant que la contrainte n'ait son mot à dire, et le test prouverait alors la policy, pas la
-- contrainte.
--
-- Ce qu'elle empêche : `/es/actividades/otras` est la page des activités qu'aucune catégorie ne
-- classe, servie par la route `[tag]`. Une catégorie portant ce slug la masquerait — et la
-- collision serait SILENCIEUSE, les deux adresses étant légitimes. Sans cette assertion, la
-- contrainte serait une règle que rien ne vérifie (CLAUDE.md §11.20).
select throws_ok(
  $$insert into catalog_tags (label, slug) values ('{"es":"Otras"}'::jsonb, 'otras')$$,
  '23514',
  null,
  'le slug « otras » est refusé : il est réservé à la page des activités non classées'
);

set local role anon;

-- ── Ce que l'index montre ───────────────────────────────────────────────────────────────────────
select is(
  (select total from search_catalog_tags() where slug = 'sct-kayak'),
  1::bigint,
  'une catégorie portant une activité vendable apparaît, avec son nombre d''offres'
);

-- ⚠️ Le logement `sct-alojamiento` porte le MÊME tag, et il ne doit pas être compté : l'index est
-- celui d'un type. Sans le `p_tipos => array[p_tipo]` passé à search_catalog, le total vaudrait 2.
select is(
  (select total from search_catalog_tags(p_tipo => 'lodging') where slug = 'sct-kayak'),
  1::bigint,
  'le même tag compté sur un AUTRE type ne mélange pas les deux'
);

-- ⚠️ LA règle du cahier §2a : « seuls les tags portant au moins une offre publiée y figurent — un
-- tag vide produirait une page vide que Google indexerait ».
select is(
  (select count(*)::int from search_catalog_tags() where slug = 'sct-vacia'),
  0, 'une catégorie sans aucune offre n''apparaît JAMAIS'
);

select is(
  (select count(*)::int from search_catalog_tags() where slug = 'sct-oculta'),
  0, '…ni une catégorie dont la seule offre n''est pas vendable'
);

-- ── Le contenu éditorial (spec 29 §6a) ──────────────────────────────────────────────────────────
select is(
  (select description ->> 'es' from search_catalog_tags() where slug = 'sct-kayak'),
  'Texto editorial de prueba', 'le texte de la catégorie est rendu, résolvable par locale'
);

select is(
  (select image_path from search_catalog_tags() where slug = 'sct-kayak'),
  'tags/sct-kayak.webp', 'le chemin de l''image est rendu tel quel — la couche résout l''URL'
);

-- ── La ligne « sans tag » (décision 1) ───────────────────────────────────────────────────────────
-- ⚠️ Présence seulement, jamais son `total` : il agrège TOUT le catalogue (cf. en-tête).
select ok(
  (select bool_or(es_sin_tag) from search_catalog_tags()),
  'la ligne « sans tag » existe tant qu''une activité publiée n''est classée nulle part'
);

-- ⚠️ Et elle DISPARAÎT quand le filtre ne laisse que des offres classées — sinon l'index
-- afficherait « Otras actividades » menant à une page vide, exactement ce que la règle interdit.
-- C'est le `having count(*) > 0` : sans lui, un agrégat sans `group by` rendrait toujours une ligne.
select is(
  (select count(*)::int from search_catalog_tags(p_query => 'Sctunico actividad taguée')
   where es_sin_tag),
  0, 'la ligne « sans tag » disparaît quand aucune offre non classée ne correspond'
);

-- ── Les critères de recherche s'appliquent, sans être recopiés ──────────────────────────────────
-- `sct-taguee` est bornée à `max_qty = 2` : au-delà, elle sort — donc sa catégorie aussi. C'est ce
-- qui prouve que les six prédicats de `search_catalog` s'appliquent ici sans avoir été redéfinis.
select is(
  (select count(*)::int from search_catalog_tags(p_personas => 5) where slug = 'sct-kayak'),
  0, 'un critère qui exclut la dernière offre d''une catégorie fait disparaître la catégorie'
);

select * from finish();
rollback;
