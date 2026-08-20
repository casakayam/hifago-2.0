-- Spec 21 — Connecteur LobbyPMS, Phase 2 : create_order, branche alojamiento PMS-backed.
-- Migration 20260819130000_create_order_pms_backed.sql. Ne rejoue PAS la couverture générale déjà
-- faite par create_order.test.sql (plafonds, atomicité, attribution, snapshot commission...) —
-- uniquement le delta introduit par isPmsBacked : zéro verrou/lecture/écriture sur
-- product_availability pour une ligne dont le produit porte lobby_category_id, comparé côte à côte
-- à une ligne non-PMS-backed identique par ailleurs (qui doit, elle, échouer sans
-- product_availability — non-régression explicite).
begin;
select plan(7);

insert into partners (id, display_name) values
  ('88930000-0000-4000-8000-000000000001', 'PMS Order Test Partner');
insert into establishments (id, partner_id, name) values
  ('88930000-0000-4000-8000-000000000011', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento PMS Order'));

insert into auth.users (id, email) values
  ('88930000-0000-4000-8000-000000000021', 'pms-order-buyer@test.local');

-- 031 : lodging PMS-backed (lobby_category_id renseigné) — Lobby fait foi, aucune ligne
-- product_availability ne sera jamais créée pour ce produit par create_order.
-- 032 : lodging NON PMS-backed (lobby_category_id null) — chemin inchangé, sert de témoin de
-- non-régression : mêmes dates, mais AUCUNE ligne product_availability posée non plus → doit
-- échouer en slot_not_found, exactement comme avant cette migration.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('88930000-0000-4000-8000-000000000031', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento PMS-backed'), 100000, true, 'pms-order-lodging-backed', 9631),
  ('88930000-0000-4000-8000-000000000032', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento no PMS'), 100000, true, 'pms-order-lodging-not-backed', null);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '88930000-0000-4000-8000-000000000021', 'role', 'authenticated')::text, true);

-- Cas 1 : ligne PMS-backed, AUCUNE ligne product_availability pour ces dates → succès quand même
-- (Lobby est seul juge, jamais consulté par create_order).
select is(
  (select (create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000031',
       'date', '2028-09-01', 'end_date', '2028-09-03', 'qty', 2
     )),
     'Holder PMS Backed', 'pms-backed@test.local'
   ))->>'ok')::boolean,
  true,
  'cas 1 : ligne lodging PMS-backed réussit sans aucune ligne product_availability'
);

-- Cas 2 : témoin — même scénario mais produit NON PMS-backed, mêmes conditions (aucune
-- product_availability) → doit échouer en slot_not_found, comportement inchangé.
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000032',
       'date', '2028-09-01', 'end_date', '2028-09-03', 'qty', 2
     )),
     'Holder Non PMS', 'non-pms@test.local'
   )),
  jsonb_build_object('ok', false, 'reason', 'slot_not_found',
    'line', jsonb_build_object('product_id', '88930000-0000-4000-8000-000000000032',
      'date', '2028-09-01', 'end_date', '2028-09-03', 'qty', 2),
    'date', '2028-09-01'),
  'cas 2 (témoin) : ligne lodging NON PMS-backed échoue toujours en slot_not_found sans product_availability'
);

-- Cas 3 : après le succès du cas 1, aucune ligne product_availability n'a été créée pour le produit
-- PMS-backed (ni par la matérialisation Phase 2 — qui ne concerne que les dates uniques — ni par
-- un quelconque effet de bord de Phase 4).
select is(
  (select count(*)::int from product_availability where product_id = '88930000-0000-4000-8000-000000000031'),
  0,
  'cas 3 : aucune ligne product_availability créée pour le produit PMS-backed'
);

-- Cas 4 : la ligne order_lines a bien été écrite, avec un prix cohérent (2 nuits à 100000 = 200000,
-- 1 seule unité facturable — alojamiento, pas de multiplication par qty=2 personnes).
select is(
  (select jsonb_build_object('price_cop', price_cop, 'total_cop', total_cop, 'pms_booking_id', pms_booking_id)
     from order_lines where product_id = '88930000-0000-4000-8000-000000000031'),
  jsonb_build_object('price_cop', 200000, 'total_cop', 200000, 'pms_booking_id', null),
  'cas 4 : order_lines écrite avec le bon total, pms_booking_id encore null (rempli hors create_order)'
);

-- Cas 5 : reset — même produit PMS-backed, mais cette fois avec une ligne product_availability
-- déjà présente pour ces dates (ex. reliquat d'avant l'activation du connecteur) → reste ignorée,
-- ni verrouillée ni décrémentée, la réservation réussit toujours et booked ne bouge pas.
-- product_availability est RPC-only (INSERT non accordé à authenticated) : reset le rôle pour
-- poser le reliquat, comme les fixtures amont, puis revenir sur l'identité acheteuse pour l'appel.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88930000-0000-4000-8000-000000000031', '2028-10-01', 5, 2),
  ('88930000-0000-4000-8000-000000000031', '2028-10-02', 5, 2);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '88930000-0000-4000-8000-000000000021', 'role', 'authenticated')::text, true);
select is(
  (select (create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000031',
       'date', '2028-10-01', 'end_date', '2028-10-03', 'qty', 1
     )),
     'Holder PMS Backed Residual', 'pms-backed-residual@test.local'
   ))->>'ok')::boolean,
  true,
  'cas 5 : ligne PMS-backed réussit même avec une ligne product_availability résiduelle préexistante'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000031' and date = '2028-10-01'),
  2,
  'cas 5 : booked résiduel jamais décrémenté pour une ligne PMS-backed'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000031' and date = '2028-10-02'),
  2,
  'cas 5 : booked résiduel jamais décrémenté (2e nuit)'
);

select * from finish();
rollback;
