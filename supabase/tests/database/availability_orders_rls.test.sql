-- Tranche 3 (disponibilité + anti-survente) — RLS : écriture directe refusée sur
-- product_availability/orders/order_lines (RPC-only), lecture publique de la disponibilité,
-- lecture des commandes limitée au propriétaire + admin.
--
-- Spec 17 §0 Tranche 1 (20260817170000_order_lines_operator_visibility.sql) : policy additive
-- order_lines_select_operator — un prestataire avec une capacité operator ACTIVE scopée à
-- l'établissement du produit voit la ligne, même s'il n'est ni l'acheteur ni le référent.
begin;
select plan(13);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('66666666-6666-6666-6666-666666666666', 'Availability Test Partner');

-- Feature 2 (products.establishment_id not null) : fixture ajoutée pour satisfaire la FK — sans
-- rapport avec ce qui est testé ici (RLS product_availability/orders/order_lines, inchangée).
insert into establishments (id, partner_id, name) values
  ('66660000-0000-4000-8000-000000000001', '66666666-6666-6666-6666-666666666666',
   jsonb_build_object('es', 'Availability Test Establishment'));

insert into auth.users (id, email) values
  ('11110000-0000-4000-8000-000000000001', 'avail-admin@test.local'),
  ('11110000-0000-4000-8000-000000000002', 'avail-buyer-a@test.local'),
  ('11110000-0000-4000-8000-000000000003', 'avail-buyer-b@test.local');

insert into partner_capabilities (account_id, role, source, status)
  values ('11110000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('11110000-0000-4000-8000-000000000009', '66666666-6666-6666-6666-666666666666',
   '66660000-0000-4000-8000-000000000001',
   'activity', jsonb_build_object('es', 'Actividad disponibilidad'), 50000, true, 'actividad-disponibilidad');

insert into product_availability (product_id, date, capacity, booked) values
  ('11110000-0000-4000-8000-000000000009', '2026-12-24', 5, 1);

insert into orders (id, account_id, holder_name, holder_email) values
  ('11110000-0000-4000-8000-000000000010', '11110000-0000-4000-8000-000000000002', 'Buyer A',
   'buyer-a@test.local');
-- Feature 11 (snapshot prix+commission) : colonnes not null ajoutées à order_lines, sans rapport
-- avec ce qui est testé ici (RLS, inchangée) — valeurs de fixture neutres, produit à 50000/qty=1.
insert into order_lines (
  order_id, account_id, product_id, date, qty, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '11110000-0000-4000-8000-000000000010', '11110000-0000-4000-8000-000000000002',
  '11110000-0000-4000-8000-000000000009', '2026-12-24', 1, 'Buyer A',
  50000, 50000, 'direct', 0.17, 0, 0.17, 8500, 0, 8500
);

-- lecture publique de la disponibilité (anon) ---------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
select is(
  (select booked from product_availability where product_id = '11110000-0000-4000-8000-000000000009'),
  1,
  'anon lit la disponibilité (capacité/réservé publics)'
);

-- écriture directe refusée (RPC-only), acheteur A -----------------------------
reset role;
set local role authenticated;
select test_login('11110000-0000-4000-8000-000000000002');

select throws_ok(
  $$ update product_availability set booked = 5
     where product_id = '11110000-0000-4000-8000-000000000009' $$,
  '42501'::char(5), null, 'un compte authentifié ne peut pas modifier product_availability en direct'
);
select throws_ok(
  $$ insert into orders (account_id, holder_name)
     values ('11110000-0000-4000-8000-000000000002', 'Triche') $$,
  '42501'::char(5), null, 'un compte authentifié ne peut pas créer une commande en direct'
);
select throws_ok(
  $$ insert into order_lines (order_id, account_id, product_id, date, qty)
     values ('11110000-0000-4000-8000-000000000010', '11110000-0000-4000-8000-000000000002',
             '11110000-0000-4000-8000-000000000009', '2026-12-24', 1) $$,
  '42501'::char(5), null, 'un compte authentifié ne peut pas créer une ligne de commande en direct (contournerait le verrou FOR UPDATE de la RPC)'
);

-- portée de lecture : propriétaire vs miroir admin -----------------------------
select is(
  (select count(*) from orders where id = '11110000-0000-4000-8000-000000000010')::int, 1,
  'l''acheteur A voit sa propre commande'
);
select is(
  (select count(*) from order_lines where order_id = '11110000-0000-4000-8000-000000000010')::int, 1,
  'l''acheteur A voit sa propre ligne de commande'
);

select test_login('11110000-0000-4000-8000-000000000003');
select is(
  (select count(*) from orders where id = '11110000-0000-4000-8000-000000000010')::int, 0,
  'l''acheteur B ne voit pas la commande de l''acheteur A'
);
select is(
  (select count(*) from order_lines where order_id = '11110000-0000-4000-8000-000000000010')::int, 0,
  'l''acheteur B ne voit pas la ligne de commande de l''acheteur A'
);

select test_login('11110000-0000-4000-8000-000000000001');
select is(
  (select count(*) from orders where id = '11110000-0000-4000-8000-000000000010')::int, 1,
  'l''admin voit la commande de l''acheteur A (miroir)'
);
select is(
  (select count(*) from order_lines where order_id = '11110000-0000-4000-8000-000000000010')::int, 1,
  'l''admin voit la ligne de commande de l''acheteur A (miroir)'
);

-- Spec 17 §0 Tranche 1 : visibilité operator (« Mis Reservas »), 3 partenaires distincts pour
-- éviter tout conflit avec partner_capabilities_operator_establishment_idx (unique par
-- partner_id+establishment_id) — actif sur l'établissement du produit, suspendu sur ce même
-- établissement, actif mais sur un AUTRE établissement. reset role : le rôle actif est
-- authenticated depuis le test_login admin ci-dessus, insuffisant pour ces inserts RLS admin-only.
reset role;
insert into partners (id, display_name) values
  ('66666666-6666-6666-6666-666666666667', 'Availability Test Operator Active'),
  ('66666666-6666-6666-6666-666666666668', 'Availability Test Operator Suspended'),
  ('66666666-6666-6666-6666-666666666669', 'Availability Test Operator Other Establishment');

insert into establishments (id, partner_id, name) values
  ('66660000-0000-4000-8000-000000000002', '66666666-6666-6666-6666-666666666669',
   jsonb_build_object('es', 'Availability Test Other Establishment'));

insert into auth.users (id, email) values
  ('11110000-0000-4000-8000-000000000004', 'avail-operator-active@test.local'),
  ('11110000-0000-4000-8000-000000000005', 'avail-operator-suspended@test.local'),
  ('11110000-0000-4000-8000-000000000006', 'avail-operator-other-establishment@test.local');

update partner_accounts set partner_id = '66666666-6666-6666-6666-666666666667'
 where id = '11110000-0000-4000-8000-000000000004';
update partner_accounts set partner_id = '66666666-6666-6666-6666-666666666668'
 where id = '11110000-0000-4000-8000-000000000005';
update partner_accounts set partner_id = '66666666-6666-6666-6666-666666666669'
 where id = '11110000-0000-4000-8000-000000000006';

-- enforce_operator_implies_referrer : une capacité operator exige une capacité referrer
-- préexistante pour le même partner_id (même patron de fixture que
-- set_product_availability_socio.test.sql).
insert into partner_capabilities (partner_id, role, source, status) values
  ('66666666-6666-6666-6666-666666666667', 'referrer', 'migration', 'active'),
  ('66666666-6666-6666-6666-666666666668', 'referrer', 'migration', 'active'),
  ('66666666-6666-6666-6666-666666666669', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('66666666-6666-6666-6666-666666666667', 'operator', 'migration', 'active',
   '66660000-0000-4000-8000-000000000001'),
  ('66666666-6666-6666-6666-666666666668', 'operator', 'migration', 'suspended',
   '66660000-0000-4000-8000-000000000001'),
  ('66666666-6666-6666-6666-666666666669', 'operator', 'migration', 'active',
   '66660000-0000-4000-8000-000000000002');

set local role authenticated;
select test_login('11110000-0000-4000-8000-000000000004');
select is(
  (select count(*) from order_lines where order_id = '11110000-0000-4000-8000-000000000010')::int, 1,
  'operator ACTIF sur l''établissement du produit voit la ligne (Mis Reservas)'
);

select test_login('11110000-0000-4000-8000-000000000005');
select is(
  (select count(*) from order_lines where order_id = '11110000-0000-4000-8000-000000000010')::int, 0,
  'operator SUSPENDU sur le même établissement ne voit pas la ligne'
);

select test_login('11110000-0000-4000-8000-000000000006');
select is(
  (select count(*) from order_lines where order_id = '11110000-0000-4000-8000-000000000010')::int, 0,
  'operator actif mais sur un AUTRE établissement ne voit pas la ligne'
);

select * from finish();
rollback;
