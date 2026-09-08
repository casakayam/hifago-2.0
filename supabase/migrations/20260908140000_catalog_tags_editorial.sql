-- Spec 29 (Tranche 2) — un tag devient une CATÉGORIE : une image, un nom, un texte.
--
-- Décision de Jérôme du 2026-09-08, en cours d'entretien : « les tags qui sont en fait des
-- catégories, on doit pouvoir ajouter une image et le nom et son texte que l'on display ». Ce n'est
-- pas un changement d'affichage — `catalog_tags` ne portait qu'un libellé et un slug, et une page
-- « Kayak » qui n'affiche qu'une grille de cartes n'a rien à dire d'elle-même, ni à un visiteur ni
-- à un moteur.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE COLONNE D'IMAGE, ET PAS UNE TABLE DE MÉDIAS
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `product_media` et `establishment_media` (spec 04) existent parce qu'un produit a une GALERIE
-- ordonnée : plusieurs photos, un `sort`, un carrousel. Une catégorie a UNE image de couverture.
-- Une table lui imposerait un `sort` qui ne veut rien dire, une jointure à chaque lecture, et la
-- question « laquelle affiche-t-on ? » à chaque écran. Le chemin pointe dans le bucket
-- `catalog-media` déjà en place, dossier `tags/`.
--
-- ⚠️ Remplacer l'image d'une catégorie laissera l'ancien objet dans le bucket. C'est le
-- comportement de TOUT le module images du dépôt depuis la spec 04 ; le corriger pour les seules
-- catégories créerait une incohérence de plus. Porté au backlog comme dette globale.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LES DEUX COLONNES SONT NULLABLES, ET C'EST VOULU
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Les catégories existantes n'ont ni texte ni image, et une catégorie créée en admin AVANT d'être
-- rédigée doit rester valide — sinon le formulaire de création exigerait une rédaction complète
-- pour enregistrer un nom. Les écrans traitent l'absence : pas d'image → aplat, pas de texte → le
-- nom se suffit (spec 29 §0, « Cas limites »).
--
-- `description` suit la convention de `label` et de `products.name` : `{es, en?}`, repli
-- obligatoire, jamais une colonne par langue (hifago/CLAUDE.md §5.1).
--
-- ⚠️ Aucun GRANT à poser : les privilèges de `catalog_tags` sont au niveau TABLE (vérifié le
-- 2026-09-08 — anon/authenticated/service_role y ont déjà SELECT), donc les colonnes neuves en
-- héritent. Ce n'est PAS le cas d'`establishments`, dont le SELECT est accordé colonne par colonne
-- pour protéger `lobby_api_token` : y ajouter une colonne exige un grant explicite. La différence
-- se vérifie, elle ne se suppose pas.
alter table public.catalog_tags
  add column description jsonb,
  add column image_path   text;

comment on column public.catalog_tags.description is
  'Texte éditorial de la catégorie, {es, en?} — affiché sur la tuile de /actividades ET en tête de '
  'sa page. Nullable : une catégorie non rédigée reste valide.';

comment on column public.catalog_tags.image_path is
  'Chemin de l''image de couverture dans le bucket catalog-media (dossier tags/). Nullable : sans '
  'elle la tuile rend un aplat. UNE image, jamais une galerie — voir l''en-tête de cette migration.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LE SLUG RÉSERVÉ
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `/es/actividades/otras` est la page des activités qu'AUCUNE catégorie ne classe (spec 29 §0,
-- décisions 1 et 2). Elle est servie par la route `[tag]`, donc une catégorie portant le slug
-- `otras` la masquerait — et la collision serait SILENCIEUSE : les deux adresses sont légitimes,
-- rien ne signalerait que l'une a mangé l'autre.
--
-- ⚠️ Le slug n'est jamais saisi à la main : l'admin le dérive de `label.es` via `slugify()`. Un
-- admin qui nomme une catégorie « Otras » déclenchera donc cette contrainte (code 23514) sans
-- comprendre pourquoi — c'est le formulaire qui doit le lui dire, et il le fait depuis ce même lot.
--
-- La table est vide en local (vérifié avant d'écrire) ; sur un environnement peuplé, cet `alter`
-- échouerait s'il s'y trouvait déjà un tag `otras` — à regarder AVANT d'appliquer en préprod, pas
-- pendant.
alter table public.catalog_tags
  add constraint catalog_tags_slug_reservado check (slug <> 'otras');
