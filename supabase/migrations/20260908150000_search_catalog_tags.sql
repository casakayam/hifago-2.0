-- Spec 29 (Tranche 2) — `search_catalog_tags` : les catégories à montrer sur `/es/actividades`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ELLE APPELLE `search_catalog` PLUTÔT QUE DE RECOPIER SES FILTRES
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Décision arbitrée par Jérôme le 2026-09-08, en cours d'implémentation (spec 29 §6b — elle
-- RENVERSE le texte validé le matin, qui faisait extraire les six prédicats dans une fonction
-- partagée).
--
-- Le problème réel : trois écrans doivent filtrer le catalogue avec EXACTEMENT les mêmes règles —
-- les sections de l'accueil, une liste d'offres, et cet index. Deux copies des six prédicats
-- divergeraient un jour, et l'index proposerait une catégorie que sa propre page ne montre pas,
-- **sans qu'aucun test des deux fonctions ne devienne rouge** : chacun vérifierait sa propre copie.
--
-- Deux voies l'atteignaient. L'extraction a été écartée sur deux faits constatés en l'écrivant :
-- `security invoker` impose `grant execute … to anon` sur la fonction extraite (sinon
-- `search_catalog`, qui s'exécute avec les droits du visiteur, ne peut pas l'appeler), ce qui en
-- ferait une RPC PostgREST publique née d'un détail d'implémentation ; et il aurait fallu découper
-- 300 lignes couvertes par 16 assertions pour un seul consommateur nouveau.
--
-- ⚠️ CE QUE CETTE VOIE COÛTE, dit franchement :
--   • cette fonction dépend de la FORME DE SORTIE de `search_catalog`, pas seulement de son
--     comportement — si `es_establecimiento` change de sens, elle suit ;
--   • `p_limite => 1000000` est obligatoire : le défaut est 24, et l'index doit voir TOUT le
--     catalogue candidat. Même motif que les 16 assertions pgTAP (`p_limite => 100000`, posé après
--     un faux rouge en septembre) — jamais un appel nu ;
--   • `search_catalog` agrège les photos et les prix de chaque ligne, dont l'index ne fait rien.
--     Mesuré le 2026-09-08 : 10 offres vendables, 0 média. Gratuit à cette échelle, et c'est le
--     raisonnement qui a déjà écarté l'index trigramme.
--
-- ⚠️ LIMITE STRUCTURELLE, à connaître avant de l'étendre : sur un type qui GROUPE (`lodging`),
-- `search_catalog` rend des cartes d'établissement, et une assignation de tag porte sur un PRODUIT.
-- Le `where not es_establecimiento` écarte donc ces cartes : l'index ne verrait que les produits
-- non groupés. Sans effet aujourd'hui — le cahier §2a ne prévoit un index de catégories que pour
-- les activités — mais c'est là qu'il faudra revenir le jour où un autre type en veut un.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LA LIGNE « SANS TAG »
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Une offre publiée qu'aucune catégorie ne classe serait INVISIBLE depuis la navigation par
-- catégorie. La tuile « Otras actividades » la rattrape (décision 1), et cette fonction la signale
-- par une ligne `es_sin_tag = true` dont `slug`, `label`, `description` et `image_path` sont nuls —
-- son nom et son texte viennent de next-intl, pas de la base : ce n'est pas une ligne de
-- `catalog_tags`.
--
-- Mélanger deux natures dans un même retour n'est pas une entorse : c'est exactement ce que fait
-- déjà `search_catalog` avec `es_establecimiento`, et pour la même raison — un seul aller-retour,
-- et le TypeScript décide quoi en faire.
--
-- ⚠️ `total` n'est PAS affiché (décision 4 : les tuiles portent un texte, pas un chiffre). Il est
-- rendu parce qu'il est le CRITÈRE D'EXISTENCE de la ligne — un tag à zéro offre n'apparaît jamais
-- (cahier §2a : « un tag vide produirait une page vide que Google indexerait ») — et parce qu'un
-- test doit pouvoir l'affirmer.
--
-- ⚠️ AUCUN TRI ICI. L'ordre alphabétique porte sur le libellé RÉSOLU DANS LA LOCALE, avec son repli
-- JSONB — que la base ne connaît pas. Un `order by label->>'es'` classerait la version anglaise par
-- ses libellés espagnols et ignorerait la collation (« ñ », les accents). Le tri se fait en
-- TypeScript, avec `Intl.Collator(locale)`.

create function public.search_catalog_tags(
  p_tipo     text default 'activity',
  p_query    text default null,
  p_personas int  default null,
  p_desde    date default null,
  p_hasta    date default null
)
returns table (
  slug        text,
  label       jsonb,
  description jsonb,
  image_path  text,
  total       bigint,
  es_sin_tag  boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
with candidatos as (
  select sc.id
  from public.search_catalog(
    p_query    => p_query,
    p_tipos    => array[p_tipo],
    p_personas => p_personas,
    p_desde    => p_desde,
    p_hasta    => p_hasta,
    p_limite   => 1000000
  ) sc
  -- cf. « limite structurelle » en tête : un tag s'assigne à un produit, jamais à un établissement.
  where not sc.es_establecimiento
)
select
  ct.slug,
  ct.label,
  ct.description,
  ct.image_path,
  count(*)::bigint as total,
  false            as es_sin_tag
from candidatos c
join public.product_tag_assignments pta on pta.product_id = c.id
join public.catalog_tags ct on ct.id = pta.tag_id
group by ct.slug, ct.label, ct.description, ct.image_path

union all

-- La tuile « Otras actividades », et seulement s'il y a quelque chose à y montrer : `having`
-- supprime la ligne quand le compte est nul, sinon un agrégat sans `group by` en rendrait toujours
-- une — et l'index afficherait une tuile menant à une page vide, exactement ce que le cahier §2a
-- interdit pour les tags.
select
  null::text, null::jsonb, null::jsonb, null::text,
  count(*)::bigint as total,
  true             as es_sin_tag
from candidatos c
where not exists (
  select 1 from public.product_tag_assignments pta where pta.product_id = c.id
)
having count(*) > 0;
$$;

comment on function public.search_catalog_tags is
  'Index des catégories d''un type d''offre (spec 29). Appelle search_catalog plutôt que de '
  'recopier ses filtres : les six prédicats n''existent qu''une fois. Rend une ligne par catégorie '
  'portant au moins une offre candidate, plus une ligne es_sin_tag pour celles qu''aucune ne classe. '
  'Ne trie pas : l''ordre alphabétique dépend de la locale, que la base ne connaît pas.';

-- Un anonyme doit pouvoir naviguer par catégorie : c'est tout l'objet de la vitrine.
grant execute on function public.search_catalog_tags(text, text, int, date, date)
  to anon, authenticated;
