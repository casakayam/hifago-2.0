-- Feature 3 (Admin : éditer une activité) — contrainte manquante depuis la Tranche 2, fermée au
-- passage puisqu'on touche price_cop pour la première fois depuis sa création. Sans risque à poser
-- maintenant : products est vide à chaque `db reset`, comme pour toute contrainte ajoutée en dev.
-- RLS/RPC-only inchangé : products_write_admin (Tranche 2) couvre déjà l'UPDATE, rien à modifier.
alter table products add constraint products_price_cop_positive check (price_cop > 0);
