-- Réordonnancement PMS (migration 20260829100000) — LobbyPMS est réservé AVANT confirmation, et
-- `release_order_after_pms_refusal` est ce qui défait la commande quand il refuse.
--
-- CE QUE CE FICHIER DOIT PROUVER, et pourquoi chaque cas existe :
--   - les places NON-PMS que create_order a consommées repartent (c'est « dates libérées ») ;
--   - une ligne PMS-backed n'en rend AUCUNE, parce que create_order ne lui en a jamais pris ;
--   - les bookings Lobby déjà créés dans la même commande partent en file d'annulation, via le
--     trigger existant — la chaîne de compensation ne doit pas avoir été cassée ;
--   - un second appel ne rend pas les places une seconde fois ;
--   - la fonction n'est PAS exécutable par un client (elle rend des places : monnayable).
--
-- ⚠️ Ce fichier ne teste PAS la concurrence (pgTAP tourne dans une transaction annulée, cf.
-- hifago/CLAUDE.md §6.3) : le verrou `for update` sur orders, partagé avec
-- expire_stale_payment_orders, relève de tests/concurrency/.
begin;
select plan(11);

-- Fixtures dédiées, jamais un enregistrement seedé partagé (AGENTS-PARALLELES point 5).
insert into partners (id, display_name) values
  ('9a930000-0000-4000-8000-000000000001', 'Release Test Partner');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('9a930000-0000-4000-8000-000000000011', '9a930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Release'), true, 'fake-token');

insert into auth.users (id, email) values
  ('9a930000-0000-4000-8000-000000000021', 'release-buyer@test.local');

-- Un logement NON PMS-backed (donc décrémenté par create_order) et un PMS-backed (jamais
-- décrémenté) : c'est le couple qui rend l'asymétrie visible.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('9a930000-0000-4000-8000-000000000031', '9a930000-0000-4000-8000-000000000001',
   '9a930000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento no PMS'), 100000, true, 'release-not-backed', null),
  ('9a930000-0000-4000-8000-000000000032', '9a930000-0000-4000-8000-000000000001',
   '9a930000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento PMS'), 100000, true, 'release-pms-backed', 36572),
  ('9a930000-0000-4000-8000-000000000033', '9a930000-0000-4000-8000-000000000001',
   '9a930000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad'), 50000, true, 'release-activity', null);

insert into product_availability (product_id, date, capacity, booked) values
  ('9a930000-0000-4000-8000-000000000031', '2028-09-01', 5, 0),
  ('9a930000-0000-4000-8000-000000000031', '2028-09-02', 5, 0),
  ('9a930000-0000-4000-8000-000000000033', '2028-09-01', 8, 0);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '9a930000-0000-4000-8000-000000000021', 'role', 'authenticated')::text, true);

-- Une commande MIXTE : deux nuits non-PMS, deux nuits PMS-backed, une activité à date unique.
-- C'est le cas que le piège 2 du dossier vise (logement + activités dans la même commande).
select is(
  (select (create_order(
     jsonb_build_array(
       jsonb_build_object('product_id', '9a930000-0000-4000-8000-000000000031',
                          'date', '2028-09-01', 'end_date', '2028-09-03', 'qty', 2),
       jsonb_build_object('product_id', '9a930000-0000-4000-8000-000000000032',
                          'date', '2028-09-01', 'end_date', '2028-09-03', 'qty', 1),
       jsonb_build_object('product_id', '9a930000-0000-4000-8000-000000000033',
                          'date', '2028-09-01', 'qty', 3)
     ),
     'Holder Release', 'release@test.local'
   ))->>'ok')::boolean,
  true,
  'préalable : la commande mixte est créée'
);

-- Pas de table temporaire pour retenir l'id : elle serait créée sous `authenticated` et illisible
-- après le `set local role service_role` plus bas. On relit la commande par son e-mail, qui est
-- propre à cette fixture.
-- État APRÈS create_order : c'est le point de comparaison de tout le fichier.
select is(
  (select booked::int from product_availability
    where product_id = '9a930000-0000-4000-8000-000000000031' and date = '2028-09-01'),
  2,
  'préalable : la nuit NON-PMS a bien été décrémentée par create_order'
);
select is(
  (select booked::int from product_availability
    where product_id = '9a930000-0000-4000-8000-000000000033' and date = '2028-09-01'),
  3,
  'préalable : l''activité à date unique a bien été décrémentée'
);
select is(
  (select count(*)::int from product_availability
    where product_id = '9a930000-0000-4000-8000-000000000032'),
  0,
  'préalable (témoin) : la ligne PMS-backed n''a créé AUCUNE product_availability'
);

set local role service_role;

-- Simule ce que reserve-nights a fait avant le refus : une des nuits avait déjà obtenu son booking
-- Lobby (autre établissement, ou première nuit acceptée) — il doit partir en file d'annulation.
-- Écrit sous service_role : `authenticated` n'a aucun grant UPDATE sur order_lines, et c'est bien
-- ainsi (la route reserve-nights tourne en service_role).
update order_lines set pms_booking_id = '90000001'
 where product_id = '9a930000-0000-4000-8000-000000000032'
   and order_id = (select id from orders where holder_email = 'release@test.local');

select is(
  (select (public.release_order_after_pms_refusal((select id from orders where holder_email = 'release@test.local'), 'test 422'))->>'released_lines')::int,
  3,
  'les trois lignes vivantes sont relâchées'
);

-- ── Ce que le relâchement doit avoir rendu ──────────────────────────────────────────────────
select is(
  (select booked::int from product_availability
    where product_id = '9a930000-0000-4000-8000-000000000031' and date = '2028-09-01'),
  0,
  'la nuit NON-PMS est rendue (première nuit de la plage)'
);
select is(
  (select booked::int from product_availability
    where product_id = '9a930000-0000-4000-8000-000000000031' and date = '2028-09-02'),
  0,
  'la nuit NON-PMS est rendue AUSSI sur la seconde nuit de la plage'
);
select is(
  (select booked::int from product_availability
    where product_id = '9a930000-0000-4000-8000-000000000033' and date = '2028-09-01'),
  0,
  'l''activité à date unique est rendue'
);

select is(
  (select count(*)::int from order_lines
    where order_id = (select id from orders where holder_email = 'release@test.local') and status = 'cancelled_by_provider'),
  3,
  'toutes les lignes passent en cancelled_by_provider'
);

-- La chaîne de compensation existante ne doit pas avoir été cassée : le trigger
-- order_lines_enqueue_pms_cancellation met en file le booking qui ne porte plus aucune ligne vivante.
select is(
  (select count(*)::int from pms_cancellation_queue where pms_booking_id = '90000001'),
  1,
  'le booking Lobby déjà créé part en file d''annulation (trigger existant, non modifié)'
);

-- Idempotence : un rejeu ne rend pas les places une seconde fois.
select is(
  (select (public.release_order_after_pms_refusal((select id from orders where holder_email = 'release@test.local'), 'rejeu'))->>'released_lines')::int,
  0,
  'un second appel ne relâche rien et ne rend donc rien deux fois'
);

select * from finish();
rollback;
