-- Feature 17 (Socio : gérer directement son propre calendrier de cupos) — extension de
-- set_product_availability (correctif Tranche 2/3 + feature 5) : garde-fous identité/propriété/
-- capacité (mêmes que submit_product_proposal, feature 15) pour un appelant non-admin,
-- log_admin_action conditionnée à un appelant admin. Verrouillage FOR UPDATE et logique de
-- capacité inchangés — déjà couverts par le test de concurrence du correctif, rien à ajouter ici.
begin;
select plan(10);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 2 partenaires (own : point de vue principal, capacité operator active scopée à son
-- établissement ; other : tiers, cible "produit d'un autre partenaire") + 1 admin.
insert into partners (id, display_name) values
  ('77770000-0000-4000-8000-000000000001', 'Avail Socio Test Own'),
  ('77770000-0000-4000-8000-000000000002', 'Avail Socio Test Other');

insert into establishments (id, partner_id, name) values
  ('77770000-0000-4000-8000-000000000011', '77770000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Own')),
  ('77770000-0000-4000-8000-000000000012', '77770000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Other'));

insert into auth.users (id, email) values
  ('77770000-0000-4000-8000-000000000021', 'avail-socio-own@test.local'),
  ('77770000-0000-4000-8000-000000000022', 'avail-socio-other@test.local'),
  ('77770000-0000-4000-8000-000000000023', 'avail-socio-admin@test.local');

update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000001'
 where id = '77770000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000002'
 where id = '77770000-0000-4000-8000-000000000022';

insert into partner_capabilities (partner_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('77770000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('77770000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000011'),
  ('77770000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000012');

insert into partner_capabilities (account_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '77770000-0000-4000-8000-000000000031', '77770000-0000-4000-8000-000000000001',
  '77770000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Producto Own'), 50000, true, 'avail-socio-own'
);

set local role authenticated;

-- Socio operator actif sur son propre établissement → succès, écrit product_availability +
-- product_calendar dans la même transaction --------------------------------------------------
select test_login('77770000-0000-4000-8000-000000000021');

select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-01'::date, 6, true
   )->>'ok'),
  'true',
  'socio operator actif sur son propre établissement réussit'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = '77770000-0000-4000-8000-000000000031' and date = '2027-05-01'),
  jsonb_build_object('capacity', 6, 'booked', 0),
  'product_availability créée avec la bonne capacité'
);
select is(
  (select open from product_calendar
    where product_id = '77770000-0000-4000-8000-000000000031' and date = '2027-05-01'),
  true,
  'product_calendar créée dans la même transaction'
);

-- Preuve du conditionnement : AUCUNE ligne audit_log créée par l'appel socio ci-dessus (vérifié
-- sous l'admin, seul rôle qui peut lire audit_log) --------------------------------------------
select test_login('77770000-0000-4000-8000-000000000023');
select is(
  (select count(*) from audit_log)::int, 0,
  'aucune ligne audit_log créée par l''appel socio (preuve du conditionnement à v_is_admin)'
);

-- Socio sur le produit d'un AUTRE partenaire → product_not_found --------------------------------
select test_login('77770000-0000-4000-8000-000000000022');
select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-02'::date, 4
   )->>'reason'),
  'product_not_found',
  'socio sur le produit d''un autre partenaire → product_not_found'
);

-- Capacité suspendue → capability_suspended (own, temporairement, cf. product_proposals.test.sql
-- pour le même patron) --------------------------------------------------------------------------
reset role;
update partner_capabilities set status = 'suspended'
 where partner_id = '77770000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000021');

select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-03'::date, 4
   )->>'reason'),
  'capability_suspended',
  'capacité operator suspendue pour cet établissement → capability_suspended'
);

reset role;
update partner_capabilities set status = 'active'
 where partner_id = '77770000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;

-- Admin → comportement inchangé, AVEC une ligne audit_log cette fois (non-régression) -----------
select test_login('77770000-0000-4000-8000-000000000023');

select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-04'::date, 9, true, 'admin-note'
   )->>'ok'),
  'true',
  'admin réussit toujours (chemin admin inchangé)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = '77770000-0000-4000-8000-000000000031' and date = '2027-05-04'),
  jsonb_build_object('capacity', 9, 'booked', 0),
  'product_availability écrite par l''admin'
);
select is(
  (select count(*) from audit_log where note = 'admin-note')::int, 1,
  'une ligne audit_log créée par l''appel admin (non-régression)'
);
select is(
  (select jsonb_build_object('action', action, 'after', after) from audit_log where note = 'admin-note'),
  jsonb_build_object(
    'action', 'product.set_availability',
    'after', jsonb_build_object('date', '2027-05-04', 'capacity', 9, 'open', true)
  ),
  'audit_log enregistre action/after corrects pour l''appel admin'
);

select * from finish();
rollback;
