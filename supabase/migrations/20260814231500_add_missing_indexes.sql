-- Index manquants sur des colonnes filtrées en pratique — constat de revue de code (pas une
-- feature), aucune sémantique métier changée, aucune policy touchée : un index n'élargit ni ne
-- restreint jamais un accès, seulement le chemin pour y arriver.
--
-- products.establishment_id : filtré directement par les écrans admin établissement
-- (products_partner_id_idx existe déjà pour partner_id, jamais son équivalent establishment_id) et
-- évalué par la policy RLS establishments_select_public (exists (... where p.establishment_id =
-- establishments.id and p.sellable = true)) — sans index, correlated subquery en scan séquentiel.
create index if not exists products_establishment_id_idx on products (establishment_id);

-- order_lines n'a aucun index secondaire au-delà de sa clé primaire, alors que trois colonnes sont
-- filtrées en pratique : order_id (détail d'une commande, cancel_order), account_id (évalué par la
-- policy order_lines_select à chaque lecture non-admin), referrer_partner_id (policy
-- order_lines_select_referrer + dashboard socio /partner/commissions).
create index if not exists order_lines_order_id_idx on order_lines (order_id);
create index if not exists order_lines_account_id_idx on order_lines (account_id);
create index if not exists order_lines_referrer_partner_id_idx on order_lines (referrer_partner_id);
