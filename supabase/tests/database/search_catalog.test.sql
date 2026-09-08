-- Spec 27 Lot A — `search_catalog`, la seule lecture publique du catalogue.
--
-- ⚠️ CHAQUE assertion est SCOPÉE sur les fixtures de ce fichier (identifiants fixes, préfixe
-- `aaaa1111-`), jamais sur un comptage global. La base locale accumule des données d'e2e au fil des
-- exécutions — six fichiers pgTAP de ce dossier en souffrent déjà (cf. docs/backlog.md). Un test
-- qui compte le catalogue entier serait vert aujourd'hui et rouge demain sans qu'une ligne de code
-- ait bougé.
--
-- ⚠️ ET LE SCOPAGE NE SUFFIT PAS — corrigé le 2026-09-07, après que ce fichier soit passé de vert à
-- SIX assertions rouges sans qu'aucune ligne de SQL ait bougé. `search_catalog()` porte un
-- `p_limite` par DÉFAUT de 24 et un `order by tipo`, et `activity` trie en premier : le jour où la
-- base locale a dépassé 24 activités accumulées, la fenêtre s'est refermée avant les couchages et
-- le `where id = …` d'ici filtrait un ensemble qui ne les contenait déjà plus. D'où le
-- `p_limite => 100000` explicite sur CHAQUE appel : le filtre de l'assertion doit s'appliquer au
-- catalogue entier, jamais à une page de résultats. Ne jamais appeler `search_catalog()` nu ici.
--
-- Tout tourne en `anon` : c'est le rôle réel d'un visiteur de la vitrine, et ça vérifie du même
-- geste que les policies `_select_public` laissent bien passer ce qu'il faut.

begin;
select plan(21);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('aaaa1111-0000-0000-0000-000000000001', 'Search Catalog Test Partner');

-- Établissement A : DEUX couchages vendables → doit être groupé en UNE carte.
-- Établissement B : UN seul couchage vendable → ne doit PAS être groupé.
-- Établissement C : archivé → rien de lui ne doit sortir.
insert into establishments (id, partner_id, name, status) values
  ('aaaa1111-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Hotel Agrupado"}'::jsonb, 'active'),
  ('aaaa1111-0000-0000-0000-00000000000b', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Cabaña Sola"}'::jsonb, 'active'),
  ('aaaa1111-0000-0000-0000-00000000000c', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Archivado"}'::jsonb, 'archived');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, capacity, max_qty, schedule)
values
  -- A : deux couchages, prix 200000 et 90000 → « desde » doit valoir 90000
  ('aaaa1111-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000a', 'lodging', 'sc-hab-cara',
   '{"es":"Habitación cara"}'::jsonb, 200000, true, 4, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000102', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000a', 'lodging', 'sc-hab-barata',
   '{"es":"Habitación barata"}'::jsonb, 90000, true, 2, null, 'date'),
  -- A : un troisième NON vendable — ne doit compter ni dans le seuil ni dans le « desde »
  ('aaaa1111-0000-0000-0000-000000000103', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000a', 'lodging', 'sc-hab-oculta',
   '{"es":"Habitación oculta"}'::jsonb, 10, false, 8, null, 'date'),
  -- B : couchage unique
  ('aaaa1111-0000-0000-0000-000000000104', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'lodging', 'sc-cabana',
   '{"es":"Cabaña Guatapé"}'::jsonb, 150000, true, 6, null, 'date'),
  -- C : archivé
  ('aaaa1111-0000-0000-0000-000000000105', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000c', 'lodging', 'sc-archivado',
   '{"es":"Archivado"}'::jsonb, 1000, true, 2, null, 'date'),
  -- Activités : bornes de quantité différentes, pour le filtre personas
  ('aaaa1111-0000-0000-0000-000000000201', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-jetski',
   '{"es":"Jetski"}'::jsonb, 90000, true, 20, 2, 'date'),
  ('aaaa1111-0000-0000-0000-000000000202', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-sin-tope',
   '{"es":"Sin tope"}'::jsonb, 30000, true, 20, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000203', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-cerrada',
   '{"es":"Cerrada"}'::jsonb, 40000, true, 20, null, 'date');

-- L'activité `sc-cerrada` est explicitement fermée sur toute une plage (calendrier CREUX :
-- l'absence de ligne vaut `calendar_default_open`, `true` par défaut).
insert into product_calendar (product_id, date, open) values
  ('aaaa1111-0000-0000-0000-000000000203', date '2030-03-10', false),
  ('aaaa1111-0000-0000-0000-000000000203', date '2030-03-11', false);

-- Spec 29 — fixtures de tags. `sc-jetski` est classée, `sc-sin-tope` et `sc-cerrada` ne le sont
-- pas : c'est ce contraste qui rend `p_sin_tag` vérifiable.
insert into catalog_tags (id, label, slug) values
  ('aaaa1111-0000-0000-0000-000000000301', '{"es":"Kayak de prueba"}'::jsonb, 'sc-tag-kayak');

insert into product_tag_assignments (product_id, tag_id) values
  ('aaaa1111-0000-0000-0000-000000000201', 'aaaa1111-0000-0000-0000-000000000301');

set local role anon;

-- ── Visibilité ──────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000103'),
  0, 'un produit non vendable n''apparaît jamais'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000105'),
  0, 'un produit d''un établissement archivé n''apparaît jamais'
);

-- ── Regroupement d'établissement ────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  1, 'un établissement à deux couchages vendables sort comme UNE carte'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id in ('aaaa1111-0000-0000-0000-000000000101',
                'aaaa1111-0000-0000-0000-000000000102')),
  0, 'ses couchages n''apparaissent PAS en plus de la carte groupée'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000104' and not es_establecimiento),
  1, 'un établissement à un seul couchage n''est pas groupé — le produit sort seul'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000b' and es_establecimiento),
  0, '…et son établissement ne sort pas comme carte'
);

-- ── Prix ────────────────────────────────────────────────────────────────────────────────────────
select is(
  (select precio_desde from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a'),
  90000::bigint, 'la carte groupée porte le prix MINIMUM de ses couchages vendables'
);

select is(
  (select precio_cop from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  150000::bigint, 'une carte produit porte son propre prix'
);

-- ── Total de section : des CARTES, pas des produits ─────────────────────────────────────────────
-- A donne 1 carte (2 couchages groupés) + B donne 1 carte = 2, jamais 3.
select ok(
  (select total_seccion from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a') >= 2,
  'total_seccion compte des cartes, pas des produits (le regroupement précède le comptage)'
);

-- ── Recherche texte ─────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'guatape')
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  1, 'unaccent : « guatape » sans accent trouve « Guatapé »'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'JETSKI')
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  1, 'la recherche ignore la casse'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'Cabaña Sola')
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  1, 'chercher un nom d''établissement remonte ses offres'
);

-- ── Filtre personas : la colonne juste de chaque type ────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_personas => 4)
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  1, 'un logement de capacité 6 passe le filtre « 4 personnes »'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_personas => 4)
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  0, 'une activité bornée à max_qty=2 ne passe pas « 4 personnes »'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_personas => 99)
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  1, 'une borne ABSENTE ne filtre pas — sinon un trou de saisie cacherait une offre réelle'
);

-- ── Filtre dates : le calendrier est CREUX ──────────────────────────────────────────────────────
select is(
  (select count(*)::int
   from search_catalog(p_limite => 100000, p_desde => date '2030-03-10', p_hasta => date '2030-03-11')
   where id in ('aaaa1111-0000-0000-0000-000000000203',   -- fermée sur TOUTE la plage
                'aaaa1111-0000-0000-0000-000000000202')), -- aucune ligne : défaut = ouvert
  1, 'fermée sur toute la plage → absente ; sans ligne de calendrier → présente (défaut ouvert)'
);

-- ── Filtre par tag, et le slug inconnu (spec 29 §6c) ────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-kayak')
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  1, 'un tag connu remonte l''offre qui le porte'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-kayak')
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  0, '…et écarte celle qui ne le porte pas'
);

-- ⚠️ LE correctif du 2026-09-08 (spec 28 §10quinquies). Avant lui, un slug absent de catalog_tags
-- filtrait TOUT : la page restait vide, et comme le bloc de recherche reportait le paramètre à
-- chaque soumission, elle ne se déverrouillait plus jamais. Un tag inconnu est un paramètre
-- invalide, donc il est IGNORÉ — exactement comme un `tipo` inconnu.
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'zzz-inexistant')
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  1, 'un slug de tag INCONNU est ignoré — il ne filtre rien'
);

-- ── p_sin_tag : la page « Otras actividades » (spec 29 §0) ──────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  0, 'p_sin_tag écarte une offre qui porte au moins un tag'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  1, '…et garde celle qu''aucune catégorie ne classe'
);

select * from finish();
rollback;
