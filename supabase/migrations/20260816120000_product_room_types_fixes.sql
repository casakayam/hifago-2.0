-- Spec 13 — deux correctifs trouvés par la revue adversariale de fin de tâche (workflow
-- multi-agents), avant tout commit :
--
-- 1. product_room_types.min_qty/max_qty n'avait aucun CHECK d'ordre, contrairement à
--    products_qty_bounds_order (20260815230000_product_price_tiers_and_qty_bounds.sql) que cette
--    même feature réutilise explicitement comme mécanisme de bornes. La validation app-side
--    (validateRoomTypes) bloque bien min_qty > max_qty sur les deux chemins d'écriture actuels,
--    mais la table elle-même l'acceptait silencieusement — incohérent avec le garde-fou déjà en
--    place sur products pour le même invariant.
-- 2. product_room_types.price_cop était `int` (32 bits) alors que price_cop est `bigint` partout
--    ailleurs dans le schéma (products.price_cop, order_lines.price_cop, et jusque dans le cast
--    jsonb_to_recordset de create_order_qty_bounds_and_tiers.sql que cette feature réutilise pour
--    ses propres price_tiers) — divergence de type gratuite, alignée ici.
alter table product_room_types
  add constraint product_room_types_qty_bounds_order
    check (min_qty is null or max_qty is null or min_qty <= max_qty),
  alter column price_cop type bigint;
