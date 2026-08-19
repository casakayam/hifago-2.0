-- Spec 17 (Calendrier/disponibilité, Tranche 1 — vue opérationnelle des réservations), docs/specs/
-- 17-calendrier-disponibilite-refonte.md §0 Tranche 1. Restaure côté socio la visibilité « Mis
-- Reservas » que la v1 legacy avait déjà (docs/2-reference/02-app-partner.md, module Prestador,
-- 100 dernières order_lines hors hold) et que v2 n'a jamais eue — confirmé par grep, aucune policy
-- SELECT existante sur order_lines ne couvre le prestataire opérateur d'un produit (seules
-- is_admin(), account_id = acheteur, et referrer_partner_id = référent, cf.
-- 20260813194515_availability_orders_core_tables.sql et 20260814200000_order_lines_referrer_
-- visibility.sql). Policy ADDITIVE (Postgres combine plusieurs policies SELECT permissives par OR),
-- même patron que order_lines_select_referrer — order_lines reste RPC-only en écriture, cette
-- migration ne touche que la lecture.
--
-- has_capability(uid, 'operator', establishment_id) encapsule déjà les 3 gardes habituelles
-- (identité, capacité active non suspendue, établissement précis) — stable + security definer +
-- search_path='' (20260813211500_partner_capabilities_establishment_scope.sql), utilisable tel
-- quel dans une policy RLS sans re-déclencher de policy sur les tables qu'elle lit elle-même
-- (partner_capabilities/partner_accounts, jamais order_lines/products).
create policy order_lines_select_operator on order_lines
  for select
  using (
    exists (
      select 1 from public.products p
       where p.id = order_lines.product_id
         and public.has_capability((select auth.uid()), 'operator', p.establishment_id)
    )
  );
