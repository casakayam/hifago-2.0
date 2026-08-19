-- Spec 18 Tranche 1 — product_slot_availability (matérialisation réelle de product_slot_rules,
-- posée par la spec 11 mais jamais consommée jusqu'ici, cf. spec 17 §10 point 12). Couvre :
--   - RLS-only (écriture revoke, lecture publique) + contrainte unique(product_id, slot_date,
--     slot_start_time), même patron que product_availability/room_type_availability.
--   - set_product_slot_capacity : régime admin+socio unifié (décision Jérôme, 2026-08-18, même
--     arbitrage que set_product_availability/set_room_type_availability), garde below_booked,
--     refus slot_not_found pour un créneau qui ne correspond à aucune règle courante.
--   - expand_product_slots (expansion pure des règles) et get_product_slots (union virtuel/
--     matérialisé, une ligne matérialisée fait toujours foi, y compris orpheline d'une règle
--     supprimée/modifiée depuis).
-- La branche create_order/modify_order_line (anti-survente, non-coexistence avec la branche date
-- unique) est couverte séparément dans create_order.test.sql (cas 21) et modify_order_line.test.sql
-- (refus explicite, hors périmètre Tranche 1).
begin;
select plan(17);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Cas 1 : aucune identité (rôle anon, jamais loggé) → not_authenticated, avant toute fixture.
set local role anon;
select is(
  (select set_product_slot_capacity(
     '00000000-0000-4000-8000-000000000000'::uuid, '2029-04-02'::date, '09:00'::time, 3
   )->>'reason'),
  'not_authenticated',
  'cas 1 : aucune identité → not_authenticated'
);
reset role;

-- Fixtures : 2 partenaires (own/other, même patron que set_product_availability_socio.test.sql),
-- 1 admin, 1 produit à créneaux (own) avec une règle 09:00-10:00/30min/capacité 5 — weekdays
-- couvrant tous les jours pour ignorer le jour de semaine réel des dates de test.
insert into partners (id, display_name) values
  ('88940000-0000-4000-8000-000000000001', 'Slot Avail Test Own'),
  ('88940000-0000-4000-8000-000000000002', 'Slot Avail Test Other');

insert into establishments (id, partner_id, name) values
  ('88940000-0000-4000-8000-000000000011', '88940000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Slot Own')),
  ('88940000-0000-4000-8000-000000000012', '88940000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Slot Other'));

insert into auth.users (id, email) values
  ('88940000-0000-4000-8000-000000000021', 'slot-avail-own@test.local'),
  ('88940000-0000-4000-8000-000000000022', 'slot-avail-other@test.local'),
  ('88940000-0000-4000-8000-000000000023', 'slot-avail-admin@test.local');

update partner_accounts set partner_id = '88940000-0000-4000-8000-000000000001'
 where id = '88940000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '88940000-0000-4000-8000-000000000002'
 where id = '88940000-0000-4000-8000-000000000022';

insert into partner_capabilities (partner_id, role, source, status) values
  ('88940000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88940000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('88940000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '88940000-0000-4000-8000-000000000011'),
  ('88940000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '88940000-0000-4000-8000-000000000012');

insert into partner_capabilities (account_id, role, source, status) values
  ('88940000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88940000-0000-4000-8000-000000000031', '88940000-0000-4000-8000-000000000001',
  '88940000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Producto Créneaux'), 40000, true, 'slot-avail-test'
);
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values (
  '88940000-0000-4000-8000-000000000031', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '10:00', 30, 5
);

set local role authenticated;
select test_login('88940000-0000-4000-8000-000000000021');

-- Cas 2 : socio operator actif sur son propre établissement, créneau dérivé de la règle (09:00,
-- jamais matérialisé) → succès, crée la ligne avec la capacité demandée (PAS celle de la règle —
-- capacité explicite prime, même que set_product_availability).
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-02'::date, '09:00'::time, 3
   )->>'ok'),
  'true',
  'cas 2 : socio operator actif sur son propre établissement réussit'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_slot_availability
    where product_id = '88940000-0000-4000-8000-000000000031'
      and slot_date = '2029-04-02' and slot_start_time = '09:00'),
  jsonb_build_object('capacity', 3, 'booked', 0),
  'cas 2 : ligne créée avec la capacité demandée, booked=0'
);

-- Cas 3 : socio sur le produit d'un AUTRE partenaire → product_not_found (même créneau, même date,
-- rien écrit).
select test_login('88940000-0000-4000-8000-000000000022');
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-02'::date, '09:30'::time, 1
   )->>'reason'),
  'product_not_found',
  'cas 3 : socio sur le produit d''un autre partenaire → product_not_found'
);

-- Cas 4 : capacité operator suspendue pour l'établissement du socio own → capability_suspended.
reset role;
update partner_capabilities set status = 'suspended'
 where partner_id = '88940000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;
select test_login('88940000-0000-4000-8000-000000000021');
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-02'::date, '09:30'::time, 1
   )->>'reason'),
  'capability_suspended',
  'cas 4 : capacité operator suspendue → capability_suspended'
);
reset role;
update partner_capabilities set status = 'active'
 where partner_id = '88940000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;

-- Cas 5 : admin → comportement inchangé, AVEC une ligne audit_log (non-régression du patron
-- set_product_availability/set_room_type_availability).
select test_login('88940000-0000-4000-8000-000000000023');
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-02'::date, '09:30'::time, 4, 'admin-note-slot'
   )->>'ok'),
  'true',
  'cas 5 : admin réussit toujours (chemin admin inchangé)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_slot_availability
    where product_id = '88940000-0000-4000-8000-000000000031'
      and slot_date = '2029-04-02' and slot_start_time = '09:30'),
  jsonb_build_object('capacity', 4, 'booked', 0),
  'cas 5 : ligne créée par l''admin avec la bonne capacité'
);
select is(
  (select jsonb_build_object('action', action, 'after', after) from audit_log where note = 'admin-note-slot'),
  jsonb_build_object(
    'action', 'product.set_slot_capacity',
    -- jsonb_build_object sérialise un paramètre `time` avec les secondes ("09:30:00"), même
    -- comportement que n'importe quelle valeur time->jsonb en Postgres — pas un bug applicatif.
    'after', jsonb_build_object('date', '2029-04-02', 'slot_start_time', '09:30:00', 'capacity', 4)
  ),
  'cas 5 : audit_log enregistre action/after corrects pour l''appel admin'
);

-- Cas 6 : below_booked — créneau déjà réservé (capacity=5, booked=2, posé directement pour isoler
-- ce test), le socio ne peut jamais descendre la capacité sous le booked déjà vendu.
reset role;
insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
values ('88940000-0000-4000-8000-000000000031', '2029-04-03', '09:00', 30, 5, 2);
set local role authenticated;
select test_login('88940000-0000-4000-8000-000000000021');
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-03'::date, '09:00'::time, 1
   )->>'reason'),
  'below_booked',
  'cas 6 : capacité cible sous le booked déjà vendu → below_booked'
);
select is(
  (select (set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-03'::date, '09:00'::time, 1
   )->>'booked')::int),
  2,
  'cas 6 : le payload expose le booked réel (2)'
);

-- Cas 7 : invalid_capacity — capacité négative.
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-03'::date, '09:00'::time, -1
   )->>'reason'),
  'invalid_capacity',
  'cas 7 : capacité négative → invalid_capacity'
);

-- Cas 8 : slot_not_found — créneau hors plage de toute règle courante (14:00, plage 09:00-10:00) et
-- jamais matérialisé auparavant → refus explicite, jamais une durée inventée à 0.
select is(
  (select set_product_slot_capacity(
     '88940000-0000-4000-8000-000000000031'::uuid, '2029-04-04'::date, '14:00'::time, 2
   )->>'reason'),
  'slot_not_found',
  'cas 8 : créneau hors plage de toute règle courante → slot_not_found'
);

-- Cas 9 : contrainte unique(product_id, slot_date, slot_start_time) — un doublon direct (posé par
-- postgres, hors RLS) est rejeté par la base elle-même, pas seulement par la RPC.
reset role;
select throws_ok(
  $$ insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
     values ('88940000-0000-4000-8000-000000000031', '2029-04-02', '09:00', 30, 9, 0) $$,
  '23505'::char(5), null,
  'cas 9 : doublon (product_id, slot_date, slot_start_time) rejeté par la contrainte unique'
);

-- Cas 10 : RLS-only — authenticated ne peut jamais écrire directement (revoke insert/update/delete,
-- même critère que product_availability/room_type_availability), même sur un créneau libre.
set local role authenticated;
select throws_ok(
  $$ insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
     values ('88940000-0000-4000-8000-000000000031', '2029-04-02', '23:00', 30, 1, 0) $$,
  '42501'::char(5), null,
  'cas 10 : insert direct refusé pour authenticated (RPC-only)'
);

-- Cas 11 : lecture publique directe (anon) — un visiteur voit les cupos restants sans RPC dédiée,
-- même patron que product_availability_select_public.
set local role anon;
select is(
  (select capacity from product_slot_availability
    where product_id = '88940000-0000-4000-8000-000000000031'
      and slot_date = '2029-04-02' and slot_start_time = '09:00'),
  3,
  'cas 11 : lecture publique directe (anon) voit la capacité posée au cas 2'
);
reset role;

-- Cas 12 : expand_product_slots — expansion pure de la règle sur une date jamais touchée (2 créneaux
-- de 30 min entre 09:00 et 10:00, capacité 5 chacun, division exacte donc aucun reliquat tronqué).
select is(
  (select jsonb_agg(jsonb_build_object('start', slot_start_time, 'capacity', capacity) order by slot_start_time)
     from expand_product_slots('88940000-0000-4000-8000-000000000031'::uuid, '2029-04-05'::date)),
  jsonb_build_array(
    jsonb_build_object('start', '09:00:00', 'capacity', 5),
    jsonb_build_object('start', '09:30:00', 'capacity', 5)
  ),
  'cas 12 : expand_product_slots dérive 2 créneaux de 30 min depuis la règle 09:00-10:00'
);

-- Cas 13 : get_product_slots — union virtuel/matérialisé sur la même date (2029-04-05, vierge
-- jusqu'ici) : 09:00 matérialisé (override admin, capacity=2/booked=1, doit primer sur la règle) ;
-- 09:30 encore virtuel (jamais matérialisé, capacité de la règle inchangée) ; 12:00 matérialisé
-- SANS règle correspondante (orpheline — doit rester visible telle quelle, jamais masquée).
insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
values
  ('88940000-0000-4000-8000-000000000031', '2029-04-05', '09:00', 30, 2, 1),
  ('88940000-0000-4000-8000-000000000031', '2029-04-05', '12:00', 15, 3, 0);
select is(
  (select jsonb_agg(
     jsonb_build_object('start', slot_start_time, 'capacity', capacity, 'booked', booked) order by slot_start_time
   ) from get_product_slots('88940000-0000-4000-8000-000000000031'::uuid, '2029-04-05'::date, '2029-04-05'::date)),
  jsonb_build_array(
    jsonb_build_object('start', '09:00:00', 'capacity', 2, 'booked', 1),
    jsonb_build_object('start', '09:30:00', 'capacity', 5, 'booked', 0),
    jsonb_build_object('start', '12:00:00', 'capacity', 3, 'booked', 0)
  ),
  'cas 13 : get_product_slots — matérialisé prime (09:00), virtuel visible (09:30), orpheline visible (12:00)'
);

select * from finish();
rollback;
