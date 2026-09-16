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
select plan(33);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('aaaa1111-0000-0000-0000-000000000001', 'Search Catalog Test Partner');

-- Établissement A : DEUX couchages vendables → doit être groupé en UNE carte.
-- Établissement B : UN seul couchage vendable → ne doit PAS être groupé.
-- Établissement C : archivé → rien de lui ne doit sortir.
-- Établissement D : DEUX couchages vendables aussi, mais JAMAIS taggé (chantier "catégories
-- partout", 2026-09-14) — sert à distinguer, sous p_sin_tag, une carte groupée non classée d'une
-- carte groupée classée (A, ci-dessous).
insert into establishments (id, partner_id, name, status) values
  ('aaaa1111-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Hotel Agrupado"}'::jsonb, 'active'),
  ('aaaa1111-0000-0000-0000-00000000000b', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Cabaña Sola"}'::jsonb, 'active'),
  ('aaaa1111-0000-0000-0000-00000000000c', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Archivado"}'::jsonb, 'archived'),
  ('aaaa1111-0000-0000-0000-00000000000d', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Hotel Agrupado Sin Tag"}'::jsonb, 'active');

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
  -- D : deux couchages, jamais taggés (ni au niveau produit ni au niveau établissement)
  ('aaaa1111-0000-0000-0000-000000000106', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000d', 'lodging', 'sc-hab-d1',
   '{"es":"Hab D1"}'::jsonb, 80000, true, 2, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000107', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000d', 'lodging', 'sc-hab-d2',
   '{"es":"Hab D2"}'::jsonb, 85000, true, 2, null, 'date'),
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

-- Événements (2026-09-15, retour Jérôme : trier les evento par prochaine occurrence, du plus
-- proche au plus éloigné — migration 20260915110000_search_catalog_evento_next_occurrence.sql).
-- Toutes les dates relatives à `today_in_bogota()`, jamais en dur (ce fichier doit rester vrai
-- indéfiniment). Assertions plus bas en ORDRE RELATIF entre CES fixtures (jamais un rango_seccion
-- absolu, qui dépendrait des evento déjà présents ailleurs dans la base — même discipline que le
-- reste de ce fichier, cf. en-tête).
insert into products (
  id, partner_id, establishment_id, type, slug, name, price_cop, sellable,
  occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count
) values
  -- E1 : ponctuel, dans 30 jours — le plus ÉLOIGNÉ des événements « à venir » de ce lot.
  ('aaaa1111-0000-0000-0000-000000000401', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-loin',
   '{"es":"Evento Lejano"}'::jsonb, 50000, true,
   'once', today_in_bogota() + 30, null, null, null),
  -- E2 : ponctuel, dans 10 jours — plus PROCHE que E1.
  ('aaaa1111-0000-0000-0000-000000000402', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-cerca',
   '{"es":"Evento Cercano"}'::jsonb, 50000, true,
   'once', today_in_bogota() + 10, null, null, null),
  -- E3 : ponctuel, déjà PASSÉ — aucune occurrence à venir, doit finir après E1/E2.
  ('aaaa1111-0000-0000-0000-000000000403', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-pasado',
   '{"es":"Evento Pasado"}'::jsonb, 50000, true,
   'once', today_in_bogota() - 5, null, null, null),
  -- E4 : récurrent tous les 7 jours, ancre lointaine dans le passé, SANS fin — sa prochaine
  -- occurrence tombe forcément dans les 6 prochains jours, donc avant E2 (+10j).
  ('aaaa1111-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-recurrente',
   '{"es":"Evento Recurrente"}'::jsonb, 50000, true,
   'recurring', today_in_bogota() - 100, 7, null, null),
  -- E5 : récurrent, mais la série s'est terminée (recurrence_end_date déjà dépassée) — même
  -- traitement que E3, doit finir après tous les événements à venir.
  ('aaaa1111-0000-0000-0000-000000000405', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-termine',
   '{"es":"Evento Terminado"}'::jsonb, 50000, true,
   'recurring', today_in_bogota() - 100, 10, today_in_bogota() - 50, null);

-- L'activité `sc-cerrada` est explicitement fermée sur toute une plage (calendrier CREUX :
-- l'absence de ligne vaut `calendar_default_open`, `true` par défaut).
insert into product_calendar (product_id, date, open) values
  ('aaaa1111-0000-0000-0000-000000000203', date '2030-03-10', false),
  ('aaaa1111-0000-0000-0000-000000000203', date '2030-03-11', false);

-- Spec 29 — fixtures de tags. `sc-jetski` est classée, `sc-sin-tope` et `sc-cerrada` ne le sont
-- pas : c'est ce contraste qui rend `p_sin_tag` vérifiable.
insert into catalog_tags (id, label, slug) values
  ('aaaa1111-0000-0000-0000-000000000301', '{"es":"Kayak de prueba"}'::jsonb, 'sc-tag-kayak'),
  -- Chantier "catégories partout" (2026-09-14) — deux tags DISTINCTS pour isoler chaque source de
  -- la bifurcation établissement/produit (cf. section dédiée plus bas) : les mélanger sur un seul
  -- tag aurait rendu chaque assertion positive par la MAUVAISE raison.
  ('aaaa1111-0000-0000-0000-000000000302', '{"es":"Piscina de prueba"}'::jsonb, 'sc-tag-piscina'),
  ('aaaa1111-0000-0000-0000-000000000303', '{"es":"Vista de prueba"}'::jsonb, 'sc-tag-vista');

insert into product_tag_assignments (product_id, tag_id) values
  ('aaaa1111-0000-0000-0000-000000000201', 'aaaa1111-0000-0000-0000-000000000301'),
  -- Cabaña Sola (B, UN seul couchage → carte PRODUIT) : source produit, cas non-groupé inchangé.
  ('aaaa1111-0000-0000-0000-000000000104', 'aaaa1111-0000-0000-0000-000000000302'),
  -- Une CHAMBRE de l'Hotel Agrupado (A, DEUX couchages → carte ÉTABLISSEMENT groupée), avec un tag
  -- QUI N'EST JAMAIS POSÉ AU NIVEAU ÉTABLISSEMENT : doit rester sans aucun effet sur la carte
  -- groupée — c'est exactement la limite structurelle que la bifurcation corrige.
  ('aaaa1111-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000000303');

insert into establishment_tag_assignments (establishment_id, tag_id) values
  -- L'Hotel Agrupado (A) lui-même, au niveau ÉTABLISSEMENT, avec un tag DIFFÉRENT de celui posé
  -- sur sa chambre : c'est CE tag-ci qui doit le faire apparaître.
  ('aaaa1111-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000302');

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

-- ── n_alojamientos : le décompte d'une carte groupée (spec 30 §3.6) ─────────────────────────────
-- L'établissement A porte TROIS couchages, dont un NON vendable ; le visiteur doit lire 2.
--
-- ⚠️ CE QUE CETTE ASSERTION PROUVE, ET CE QU'ELLE NE PROUVE PAS — mesuré par mutation le
-- 2026-09-08, et écrit ici parce que le contraire se croit facilement. Remplacer le décompte par
-- un compte BRUT (`select count(*) from products where establishment_id = … and type = 'lodging'`,
-- sans aucun filtre `sellable`) NE FAIT PAS rougir cette assertion : tout ce fichier tourne en
-- `anon` (l. 85), et la policy `products_select_public` écarte déjà le non-vendable avant que le
-- décompte ne compte quoi que ce soit. En `postgres`, la même mutation rend bien 3.
--
-- L'assertion vérifie donc la propriété qui compte POUR L'ÉCRAN — « le visiteur lit le nombre de
-- couchages qu'il peut réellement réserver » —, et cette propriété est tenue DEUX fois : par le
-- prédicat de `candidatos` et par la RLS. Elle ne verrouille pas le prédicat à elle seule, et
-- prétendre le contraire ferait croire à un filet qui n'existe pas.
select is(
  (select n_alojamientos from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  2::bigint, 'une carte groupée annonce le nombre de couchages VISIBLES par le visiteur (2 sur 3)'
);

-- `null`, jamais 0 : « 0 alojamientos » se lirait « cet établissement n'en a aucun », alors que la
-- carte est justement celle d'une offre isolée.
select is(
  (select n_alojamientos from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  null::bigint, 'une carte NON groupée n''annonce aucun décompte — null, jamais 0'
);

select is(
  (select n_alojamientos from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  null::bigint, '…et une activité non plus'
);

-- ── Bifurcation établissement/produit du filtre par tag (chantier "catégories partout", 2026-09-14) ─
-- cf. commentaire de tête de la migration `search_catalog_tag_bifurcation` : un tag posé sur
-- `establishment_tag_assignments` décide pour une carte GROUPÉE, un tag posé sur
-- `product_tag_assignments` décide pour une carte PRODUIT — jamais l'inverse.
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-piscina')
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  1, 'un tag posé sur l''ÉTABLISSEMENT groupé le fait apparaître comme carte groupée'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-piscina')
   where id = 'aaaa1111-0000-0000-0000-000000000104' and not es_establecimiento),
  1, '…et le MÊME slug, posé sur un PRODUIT non groupé, fait apparaître sa carte produit'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-vista')),
  0,
  'un tag posé sur une CHAMBRE d''un établissement groupé n''a aucun effet — seul le tag de l''établissement compte pour une carte groupée'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-00000000000d' and es_establecimiento),
  1, 'p_sin_tag garde une carte groupée qu''AUCUN tag d''établissement ne classe'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  0, '…et écarte une carte groupée dont l''établissement porte un tag'
);

-- ── Tri des evento par prochaine occurrence (2026-09-15) ────────────────────────────────────────
-- En ORDRE RELATIF entre les fixtures E1-E5 ci-dessus, jamais un rango_seccion absolu (d'autres
-- evento peuvent exister ailleurs dans la base, cf. discipline de ce fichier en en-tête).
select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000402') -- E2, +10j
  <
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000401'), -- E1, +30j
  'evento ponctuel le plus proche (+10j) est classé avant celui le plus éloigné (+30j)'
);

select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000404') -- E4, recurring, prochaine occurrence < 7j
  <
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000402'), -- E2, +10j
  'evento récurrent dont la prochaine occurrence est plus proche (<7j) qu''un ponctuel à +10j est classé avant'
);

select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000403') -- E3, ponctuel déjà passé
  >
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000401'), -- E1, à venir
  'evento ponctuel déjà passé (aucune occurrence à venir) est classé après tous ceux à venir'
);

select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000405') -- E5, série récurrente terminée
  >
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000401'), -- E1, à venir
  'evento récurrent dont la série est terminée (recurrence_end_date passée) est classé après ceux à venir'
);

select * from finish();
rollback;
