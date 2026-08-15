-- Spec 08 (Admin : gestion CRUD d'une activité — paliers de prix et bornes de quantité).
-- Comparé à l'app legacy (règle "refaire pas réinventer", hifago/CLAUDE.md) : aucun des deux
-- mécanismes n'existe pour une activité côté legacy — seul un palier analogue existe pour un
-- hébergement loué en entier (stay_rates, 012_stay_rates.sql), jamais appliqué à une activité.
-- Structure de tranches reprise comme précédent technique (intervalles non chevauchants), adaptée
-- à la quantité/nombre de personnes d'une activité plutôt qu'à un séjour.
--
-- Contrairement à stay_rates (validé côté service Node legacy, pas en base), la validation de
-- non-chevauchement des paliers reste ici aussi côté app (formulaire admin, apps/admin/lib/
-- products/priceTiers.ts) — même choix que products.description/category : jamais un CHECK SQL
-- sur du JSON complexe. Chaque palier couvre un intervalle FERMÉ [min_qty, max_qty] (pas de borne
-- haute nulle/ouverte, pour une lecture SQL simple côté create_order — un admin qui veut "6 et
-- plus" met max_qty=999).
--
-- Pas de RPC pour ces 3 colonnes côté écriture admin (RLS directe products_write_admin, même
-- raisonnement que category aujourd'hui — ni compteur de capacité, ni verrou optimiste). C'est
-- leur LECTURE dans create_order (20260815240000_create_order_qty_bounds_and_tiers.sql) qui a
-- besoin de rigueur, pas leur écriture.
alter table products
  add column price_tiers jsonb,
  add column min_qty int,
  add column max_qty int,
  add constraint products_qty_bounds_order check (
    min_qty is null or max_qty is null or min_qty <= max_qty
  );
