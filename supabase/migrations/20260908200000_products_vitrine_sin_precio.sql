-- Spec 30 (Tranche 2) — une offre en VITRINE peut se passer de prix chiffré.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CE QU'EST UNE FICHE VITRINE, ET CE QU'ELLE N'EST PAS
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Une offre en vitrine renvoie vers un CONTACT DIRECT au lieu d'un calendrier de réservation
-- (cahier §2e, forme arrêtée le 2026-09-07). Son mécanisme est `external_booking_url`, posé par la
-- migration 20260814190000 et volontairement générique — « plus jamais figé WhatsApp seul ».
--
-- ⚠️ CE N'EST JAMAIS `sellable = false`, et ce n'est pas une préférence de style : `sellable=false`
-- rend le produit invisible au public (policy `products_select_public`), donc la fiche répondrait
-- 404 — et pire, son ÉTABLISSEMENT disparaîtrait aussi, `establishments_select_public` exigeant au
-- moins un produit vendable rattaché. Le produit reste donc PUBLIÉ (`sellable = true`) et porte son
-- URL externe.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE MIGRATION EXISTE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Le cahier §2e dit « ce n'est PAS réservé aux eventos » — un transport, une activité ou tout autre
-- type peut être en vitrine, « éventuellement avec `price_label` plutôt qu'un prix réel ». Or la
-- contrainte en place n'exempte QUE les eventos : une vitrine d'un autre type devait porter un
-- prix chiffré, c'est-à-dire en inventer un quand il se négocie.
--
-- Le cahier désignait ce point comme à soumettre à Jérôme (« à revoir si Jérôme veut une vitrine
-- sans prix sur un transport ») ; tranché le 2026-09-08, spec 30 §3.1.
--
-- ⚠️ LA CONTRAINTE NOUVELLE EST STRICTEMENT PLUS PERMISSIVE que l'ancienne : elle ajoute un `or`,
-- elle n'en retire aucun. AUCUNE ligne existante ne peut donc la violer, et la migration ne peut
-- pas échouer sur les données — c'est ce qui la rend sûre, et la raison de ne pas la poser
-- `not valid` puis valider en deux temps.
--
-- ⚠️ CE QUE CETTE MIGRATION NE SUFFIT PAS À FAIRE : le champ `external_booking_url` est verrouillé
-- sur `isEvento` dans l'écran admin (`product-type-fields.tsx`). Sans le déverrouiller, aucun admin
-- ne peut créer la vitrine que cette contrainte autorise désormais. C'est un geste de la même
-- tranche, pas un oubli à découvrir plus tard.

alter table public.products
  drop constraint products_price_cop_required_unless_evento;

alter table public.products
  add constraint products_price_cop_required_unless_vitrine
  check (
    type = 'evento'
    or external_booking_url is not null
    or price_cop is not null
  );

comment on constraint products_price_cop_required_unless_vitrine on public.products is
  'Un prix chiffré est requis, SAUF pour un evento ou une offre en vitrine (external_booking_url '
  'posé), qui peut n''afficher que price_label. Cahier §2e, spec 30 §3.1 (2026-09-08).';
