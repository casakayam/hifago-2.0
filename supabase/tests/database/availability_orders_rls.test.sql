-- Tranche 3 (disponibilité + anti-survente) — RLS : écriture directe refusée sur
-- product_availability/orders/order_lines (RPC-only), lecture publique de la disponibilité.
--
-- RÉVISÉ 2026-09-22 (fermeture de la fuite des colonnes de commission, docs/backlog.md) : ce
-- fichier vérifiait aussi la portée de lecture sur orders/order_lines (propriétaire vs miroir
-- admin, visibilité operator par établissement, spec 17 §0 Tranche 1) via order_lines_select/
-- order_lines_select_operator. Ces policies sont supprimées (20260922210000, order_lines n'a plus
-- aucun accès SELECT direct pour authenticated/anon) — la portée équivalente est désormais prouvée
-- au niveau RPC (has_capability recalculé en SQL dans chaque fonction), voir
-- partner_reservation_detail.test.sql/partner_agenda_order_lines.test.sql/
-- partner_reservations_list.test.sql. Seules les preuves encore vraies (écriture directe refusée,
-- lecture publique de la disponibilité) survivent ci-dessous.
begin;
select plan(4);

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
  ('11110000-0000-4000-8000-000000000002', 'avail-buyer-a@test.local');

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
-- avec ce qui est testé ici (écriture directe refusée) — valeurs de fixture neutres.
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

select * from finish();
rollback;
