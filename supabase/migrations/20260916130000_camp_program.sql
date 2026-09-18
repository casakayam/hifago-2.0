-- Programme d'un camp (demande Jérôme du 2026-09-16, cadrée par AskUserQuestion dans la même
-- session avant tout code) : le déroulé jour par jour d'un camp, aujourd'hui noyé dans la
-- description en texte libre.
--
-- « Refaire pas réinventer » — l'ancrage legacy est direct : la V1 en production porte déjà
-- experiences.program (src/services/migrations/006_experiences_media.sql), saisi dans un textarea
-- « Programa (una línea por punto) » (public/index.html:733) et rendu sur /reservar en liste à
-- puces sous « El plan, día a día » (public/reservar.js:199). La date y était noyée dans le texte
-- de chaque ligne (« Día 1 · Recogida en Medellín… ») ; CE lot la structure. Le modèle cible le
-- prévoyait déjà : docs/00-modele-de-donnees.md §4a, « programme » marqué 🌐 multilingue et
-- « base existante à généraliser ».
--
-- Décisions produit actées avec Jérôme (mêmes AskUserQuestion) :
--   - Jour RELATIF (día 1..n), un seul programme par camp, valable pour TOUS ses départs — et non
--     une date calendaire, qui obligerait à ressaisir le programme à chaque nouveau départ
--     (product_availability porte plusieurs départs pour un même camp). La vitrine calcule la date
--     réelle à l'affichage, depuis le départ choisi.
--   - Éditable par l'admin ET par le socio propriétaire (via proposition/modération) — d'où la
--     migration de parité 20260916140000 qui suit immédiatement celle-ci.
--   - Chaque ligne est multilingue {es, en} (es obligatoire, en facultatif → repli), comme
--     products.name/description : c'est du contenu partenaire, pas un libellé d'interface
--     (CLAUDE.md §5.1).
--   - Ni heure, ni titre de journée : une ligne = un texte libre, l'ordre de saisie fait foi.
--   - Camp uniquement (products_program_camp_only ci-dessous) : l'evento portait aussi un
--     programme en V1 et docs/00-modele-de-donnees.md §4b le prévoit, mais Jérôme a explicitement
--     scopé ce lot au camp. Ouvrir à l'evento plus tard = relever ce seul CHECK.
--
-- Pourquoi une COLONNE et pas une table fille (product_program_items) : le chemin d'ÉDITION des
-- propositions socio n'accepte que des colonnes de products. submit_product_proposal le dit
-- textuellement — « jamais tags/photos/slot_rules, délégués à des blocs séparés à sauvegarde
-- immédiate côté admin, jamais couverts par ce même submit ». Une table fille sait passer la
-- CRÉATION (create_product_from_proposal boucle bien sur p_payload -> 'slot_rules'), mais pas
-- l'édition — or l'édition par le socio est la moitié de la demande. Il faudrait inventer un diff
-- de lignes filles dans moderate_product_proposal, sans précédent dans ce dépôt. La colonne suit
-- en outre le patron déjà posé pour les collections éditoriales d'un produit (price_tiers, et
-- stay_rates.includes qui est littéralement une liste de chaînes libres), et évite une requête
-- supplémentaire sur la fiche vitrine (program rejoint COLUMNAS_PRODUCTO, déjà émis).
--
-- Forme stockée — liste PLATE, une entrée par ligne de programme :
--   [{"day": 1, "text": {"es": "Recogida en Medellín", "en": "Pickup in Medellín"}},
--    {"day": 1, "text": {"es": "Fogata al llegar"}},
--    {"day": 2, "text": {"es": "Lancha por el embalse"}}]
-- Plusieurs entrées portant le MÊME day sont le cas normal (précision de Jérôme à la revue du
-- plan) : c'est ainsi qu'une journée porte plusieurs lignes. D'où la liste plate plutôt qu'un
-- tableau de journées à items[] — ce second format aurait fait du jour répété une donnée
-- contradictoire à arbitrer (fusionner ? refuser ?) là où la question ne se pose pas. L'ordre du
-- tableau fait foi ; les jours absents sont simplement absents (un « día libre » se saisit comme
-- une ligne de texte, rien à modéliser en plus).
--
-- Régime RLS : écriture DIRECTE (products_write_admin), aucune RPC dédiée — aucun des 4 critères
-- RPC-only de CLAUDE.md §3.1 ne s'applique (ni compteur de capacité, ni audit nominatif, ni
-- lecture cross-identité, ni verrou optimiste multi-admin). Exactement le précédent price_tiers /
-- group_discount_* (spec 36 §0). Aucun grant à écrire : products n'a pas de grant colonne par
-- colonne (contrairement à establishments, cf. .claude/rules/supabase.md) et les tables du schéma
-- public sont couvertes par l'ALTER DEFAULT PRIVILEGES de 20260813163456_identity_rls.sql.
alter table products
  add column program jsonb,
  add constraint products_program_camp_only
    check (type = 'camp' or program is null),
  -- ⚠️ Ce CHECK n'est POSABLE que parce que la migration 20260916140000 qui suit normalise program
  -- à chaque site d'écriture SQL. Sans elle il casserait toute création de camp sans programme :
  -- les RPC lisent `p_payload -> 'program'` (flèche simple), donc un payload {"program": null}
  -- produit le littéral JSON `null` ('null'::jsonb) et NON un NULL SQL — et
  -- jsonb_typeof('null'::jsonb) vaut 'null', pas 'array'. Ce n'est pas une hypothèse : le dépôt a
  -- déjà payé ce bug sur price_tiers (20260818240000_fix_price_tiers_json_null.sql — « 11 produits
  -- dans la base locale » portaient ce littéral), où il se manifestait en erreur d'exécution plutôt
  -- qu'en rejet. Couplé à cette normalisation, le CHECK devient la garantie que price_tiers n'a
  -- jamais eue : aucun littéral JSON `null` ne peut plus entrer dans cette colonne.
  add constraint products_program_is_array
    check (program is null or jsonb_typeof(program) = 'array');

comment on column products.program is
  'Programme jour par jour d''un camp : liste plate [{day:int, text:{es,en}}], plusieurs entrées '
  'pouvant porter le même day. Jour RELATIF au départ (día 1..n), jamais une date calendaire. '
  'Camp uniquement (products_program_camp_only). Écriture RLS directe, cf. spec 37.';

-- Pas de CHECK croisé « day <= duration_days » : il ferait échouer en erreur SQL brute toute
-- réduction ultérieure de la durée d'un camp déjà programmé. Même arbitrage que le seuil de remise
-- de groupe (« Pas de CHECK threshold <= default_capacity […] validation souple côté formulaire »,
-- spec 36 §0). La borne, les plafonds et l'obligation d'un texte espagnol vivent dans
-- apps/admin/lib/products/program.ts et sont tenus par program.test.ts — donc vérifiés
-- mécaniquement, pas seulement documentés (CLAUDE.md §11.20).
