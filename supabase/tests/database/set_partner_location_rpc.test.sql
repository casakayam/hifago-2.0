-- Revue admin partenaires (Jérôme, 2026-08-19) — RPC set_partner_location (seule écriture sur
-- partner_crm_profile hors création). Couvre : appel non-admin refusé, partenaire inexistant
-- refusé, bornes lat/lon invalides refusées, upsert (insert la 1re fois, update ensuite sans
-- doublon), trace dans audit_log.
begin;
select plan(10);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('ef000000-0000-4000-8000-000000000001', 'Partner QASETLOC Fixture');

insert into auth.users (id, email) values
  ('ef000000-0000-4000-8000-000000000001', 'setloc-admin@test.local'),
  ('ef900000-0000-4000-8000-000000000001', 'setloc-stranger@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('ef000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

set local role authenticated;

-- appel non-admin → exception -------------------------------------------------------------------
select test_login('ef900000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select set_partner_location('ef000000-0000-4000-8000-000000000001', 'x', 0, 0) $$,
  '42501'::char(5), null, 'set_partner_location refuse un appelant non-admin'
);

select test_login('ef000000-0000-4000-8000-000000000001');

-- partenaire inexistant ---------------------------------------------------------------------
select throws_ok(
  $$ select set_partner_location('00000000-0000-4000-8000-000000000000', 'x', 0, 0) $$,
  'P0001'::char(5), 'partner introuvable',
  'set_partner_location refuse un partenaire inexistant'
);

-- bornes lat/lon invalides ------------------------------------------------------------------
select throws_ok(
  $$ select set_partner_location('ef000000-0000-4000-8000-000000000001', 'x', 200, 0) $$,
  'P0001'::char(5), 'latitud fuera de rango (-90..90)',
  'set_partner_location refuse une latitude hors bornes'
);
select throws_ok(
  $$ select set_partner_location('ef000000-0000-4000-8000-000000000001', 'x', 0, 200) $$,
  'P0001'::char(5), 'longitud fuera de rango (-180..180)',
  'set_partner_location refuse une longitude hors bornes'
);

-- upsert : 1er appel insère -------------------------------------------------------------------
select set_partner_location('ef000000-0000-4000-8000-000000000001', 'Calle 1 QASETLOC', 6.2, -75.5);
select is(
  (select address from partner_crm_profile where partner_id = 'ef000000-0000-4000-8000-000000000001'),
  'Calle 1 QASETLOC',
  '1er appel insère address'
);
select is(
  (select lat from partner_crm_profile where partner_id = 'ef000000-0000-4000-8000-000000000001'),
  6.2::double precision,
  '1er appel insère lat'
);

-- upsert : 2e appel sur le MÊME partenaire met à jour, sans doublon --------------------------
select set_partner_location('ef000000-0000-4000-8000-000000000001', 'Calle 2 QASETLOC', 6.3, -75.6);
select is(
  (select count(*) from partner_crm_profile where partner_id = 'ef000000-0000-4000-8000-000000000001')::int,
  1,
  '2e appel ne crée pas de doublon (toujours 1 seule ligne pour ce partenaire)'
);
select is(
  (select address from partner_crm_profile where partner_id = 'ef000000-0000-4000-8000-000000000001'),
  'Calle 2 QASETLOC',
  '2e appel met à jour address vers la nouvelle valeur'
);
select is(
  (select lon from partner_crm_profile where partner_id = 'ef000000-0000-4000-8000-000000000001'),
  -75.6::double precision,
  '2e appel met à jour lon vers la nouvelle valeur'
);

-- trace dans audit_log -----------------------------------------------------------------------
select is(
  (select count(*) from audit_log
    where action = 'partner.set_location' and entity_id = 'ef000000-0000-4000-8000-000000000001')::int,
  2,
  'les 2 appels réussis sont bien tracés dans audit_log'
);

select * from finish();
rollback;
