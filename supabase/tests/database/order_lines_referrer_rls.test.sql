-- Feature 14 (Socio : dashboard de commissions) — preuve que Phase 4 de create_order écrit bien
-- referrer_partner_id sur order_lines, sur le même chemin qu'un vrai parcours d'achat (commandes
-- créées via la vraie RPC create_order, pas un insert brut).
--
-- RÉVISÉ 2026-09-22 (fermeture de la fuite des colonnes de commission, docs/backlog.md) : ce
-- fichier vérifiait aussi `order_lines_select_referrer` (policy RLS additive à
-- order_lines_select) — un référent A voyait la ligne qu'il a référée, pas celle de B. Cette
-- policy est supprimée (20260922210000, order_lines n'a plus aucun accès SELECT direct pour
-- authenticated/anon) : la partie RLS de ce fichier n'a plus d'objet, elle est retirée plutôt que
-- laissée à tester un mécanisme qui n'existe plus. Seule la preuve d'écriture survit ci-dessous.
begin;
select plan(2);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 2 partenaires référents (A/B), 1 partenaire propriétaire du produit (sans rapport avec
-- l'attribution — referrer_partner_id ne dépend jamais de qui possède le produit), 2 acheteurs.
insert into partners (id, display_name) values
  ('aa110000-0000-4000-8000-000000000001', 'Referrer RLS Test A'),
  ('aa110000-0000-4000-8000-000000000002', 'Referrer RLS Test B'),
  ('aa110000-0000-4000-8000-000000000003', 'Referrer RLS Test Owner');

insert into establishments (id, partner_id, name) values
  ('aa110000-0000-4000-8000-000000000011', 'aa110000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Establecimiento Referrer RLS'));

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  'aa110000-0000-4000-8000-000000000021', 'aa110000-0000-4000-8000-000000000003',
  'aa110000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Referrer RLS'), 40000, true, 'referrer-rls-test'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('aa110000-0000-4000-8000-000000000021', '2028-12-01', 10, 0),
  ('aa110000-0000-4000-8000-000000000021', '2028-12-02', 10, 0);

insert into partner_codes (code, partner_id, active) values
  ('RLS-TEST-A', 'aa110000-0000-4000-8000-000000000001', true),
  ('RLS-TEST-B', 'aa110000-0000-4000-8000-000000000002', true);

insert into auth.users (id, email) values
  ('aa110000-0000-4000-8000-000000000033', 'rls-buyer-only@test.local'),
  ('aa110000-0000-4000-8000-000000000034', 'rls-other-buyer@test.local');

set local role authenticated;

-- Commande 1 : achetée par un acheteur, référée par A (code RLS-TEST-A). Panier et attribution
-- posés en base (spec 32) : create_order lit désormais ses propres cart_items/carts pour
-- auth.uid(), plus des paramètres.
select test_login('aa110000-0000-4000-8000-000000000033');
insert into carts (account_id, attribution_code, attribution_source) values
  ('aa110000-0000-4000-8000-000000000033', 'RLS-TEST-A', 'link');
insert into cart_items (account_id, product_id, date, qty) values
  ('aa110000-0000-4000-8000-000000000033', 'aa110000-0000-4000-8000-000000000021', '2028-12-01', 1);
select create_order(
  'Holder Referrer RLS 1', 'buyer-fixture@hifago.test', null, false
);

-- Commande 2 : achetée par un AUTRE acheteur, référée par B (code RLS-TEST-B).
select test_login('aa110000-0000-4000-8000-000000000034');
insert into carts (account_id, attribution_code, attribution_source) values
  ('aa110000-0000-4000-8000-000000000034', 'RLS-TEST-B', 'link');
insert into cart_items (account_id, product_id, date, qty) values
  ('aa110000-0000-4000-8000-000000000034', 'aa110000-0000-4000-8000-000000000021', '2028-12-02', 1);
select create_order(
  'Holder Referrer RLS 2', 'buyer-fixture@hifago.test', null, false
);

reset role;

-- Preuve que Phase 4 écrit bien referrer_partner_id (au-delà de toute policy) — lecture privilégiée,
-- order_lines n'ayant plus aucun accès SELECT direct pour authenticated/anon depuis 20260922210000.
select is(
  (select referrer_partner_id from order_lines where date = '2028-12-01'),
  'aa110000-0000-4000-8000-000000000001'::uuid,
  'create_order écrit referrer_partner_id = A sur la ligne de la commande 1'
);
select is(
  (select referrer_partner_id from order_lines where date = '2028-12-02'),
  'aa110000-0000-4000-8000-000000000002'::uuid,
  'create_order écrit referrer_partner_id = B sur la ligne de la commande 2'
);

select * from finish();
rollback;
