-- Spec 11 (Admin : parcours unifié création/édition d'une activité) — lieu propre à une activité,
-- distinct de celui de l'établissement associé (une activité nautique peut partir d'un ponton
-- différent de l'hôtel qui la vend). Gap déjà noté hifago/docs/00-modele-de-donnees.md §3
-- ("Coordonnées géographiques propres | ❌ absent en base"). Comparé à l'app legacy (règle "refaire
-- pas réinventer") : aucune activité n'a jamais eu de lieu propre côté V1 (seul `experiences.place`
-- existe, texte libre, réservé à evento/camp) — extension nouvelle, pas une reprise.
--
-- Mirror exact d'establishments.address/lat/lon (20260814234500_establishment_presentation_fields.sql) :
-- mêmes types, même widget de saisie (mountAddressAutocomplete). Nullable et générique sur
-- products (tout type), même si le formulaire ne les expose qu'à type='activity' en Tranche 1
-- (scope Jérôme : "on va rester encore sur une activité") — ne ferme pas la porte à evento/camp
-- plus tard sans nouvelle migration.
--
-- RLS directe, aucune policy nouvelle nécessaire : products_write_admin (existante) couvre déjà la
-- ligne entière, même raisonnement que price_tiers/min_qty/max_qty (20260815230000).
alter table products
  add column address text,
  add column lat double precision,
  add column lon double precision;
