-- Spec 12 — active products.type='lodging' (« house »/alojamiento) côté écran admin.
--
-- type='lodging' et products.stay_rates (jsonb) existent déjà depuis la toute première migration
-- catalogue (20260813190232_catalog_core_tables.sql), copiés du schéma V1, jamais branchés à un
-- écran. create_order plafonne déjà ce type (lodging_cap_exceeded) sans changement nécessaire ici.
--
-- Cette migration n'ajoute que ce qui manque réellement : check-in/check-out en colonnes typées
-- (cohérence avec products.start_time déjà utilisé pour l'evento, plutôt que le texte libre V1) et
-- une capacité dédiée (« nombre de couchage »), distincte de min_qty/max_qty qui bornent une
-- commande — stay_rates reste réutilisé tel quel pour les extras (saison/weekend/inclusions/dépôt),
-- cf. docs/specs/12-admin-alojamiento-house.md §3.
alter table products
  add column check_in_time time,
  add column check_out_time time,
  add column capacity int,
  add constraint products_capacity_positive check (capacity is null or capacity > 0);
