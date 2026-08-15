-- Feature 23 (Admin : registre d'identité partenaire) — grant_capability, set_capability_status,
-- transfer_establishment, set_partner_code_active.
begin;
select plan(21);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : partenaire A (déjà referrer+operator actifs, pour la symétrie set_capability_status
-- et le cas doublon) ; partenaire B (aucune capacité, pour "operator sans referrer existant") ;
-- un établissement par partenaire (B sert au cas "déjà rattaché à un autre partenaire").
insert into partners (id, display_name) values
  ('a2000000-0000-4000-8000-000000000001', 'Registry Test A'),
  ('a2000000-0000-4000-8000-000000000002', 'Registry Test B');

insert into establishments (id, partner_id, name) values
  ('a2000000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento A')),
  ('a2000000-0000-4000-8000-000000000012', 'a2000000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento B'));

insert into auth.users (id, email) values
  ('a2000000-0000-4000-8000-000000000021', 'registry-admin@test.local'),
  ('a2000000-0000-4000-8000-000000000022', 'registry-nonadmin@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('a2000000-0000-4000-8000-000000000021', 'admin', 'migration', 'active');

insert into partner_capabilities (id, partner_id, role, source, status) values
  ('a2000000-0000-4000-8000-000000000031', 'a2000000-0000-4000-8000-000000000001',
   'referrer', 'migration', 'active');
insert into partner_capabilities (id, partner_id, establishment_id, role, source, status) values
  ('a2000000-0000-4000-8000-000000000032', 'a2000000-0000-4000-8000-000000000001',
   'a2000000-0000-4000-8000-000000000011', 'operator', 'migration', 'active');

insert into partner_codes (code, partner_id, active) values
  ('REGTEST-A', 'a2000000-0000-4000-8000-000000000001', true);

set local role authenticated;
select test_login('a2000000-0000-4000-8000-000000000022');

-- Chaque RPC refusée pour un non-admin ------------------------------------------------------------
select throws_ok(
  $$ select grant_capability('a2000000-0000-4000-8000-000000000002'::uuid, 'referrer') $$,
  '42501'::char(5), 'grant_capability réservé au rôle admin',
  'grant_capability refuse un appelant non-admin'
);
select throws_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000031'::uuid, 'active') $$,
  '42501'::char(5), 'set_capability_status réservé au rôle admin',
  'set_capability_status refuse un appelant non-admin'
);
-- security invoker : le refus vient de la RLS (establishments_write_admin), pas d'un contrôle
-- is_admin() explicite — même message générique "introuvable" qu'un id inexistant (cf. plan).
select throws_ok(
  $$ select transfer_establishment('a2000000-0000-4000-8000-000000000011'::uuid,
       'a2000000-0000-4000-8000-000000000002'::uuid) $$,
  'P0001'::char(5), 'établissement introuvable ou non autorisé',
  'transfer_establishment refuse un appelant non-admin (RLS, message "introuvable")'
);
select throws_ok(
  $$ select set_partner_code_active('REGTEST-A', false) $$,
  '42501'::char(5), 'set_partner_code_active réservé au rôle admin',
  'set_partner_code_active refuse un appelant non-admin'
);

select test_login('a2000000-0000-4000-8000-000000000021');

-- grant_capability : operator sans referrer existant → les deux lignes créées, dans cet ordre ----
select lives_ok(
  $$ select grant_capability('a2000000-0000-4000-8000-000000000002'::uuid, 'operator',
       'a2000000-0000-4000-8000-000000000012'::uuid) $$,
  'grant_capability (operator, partenaire sans aucune capacité) réussit'
);
select is(
  (select array_agg(role order by created_at) from partner_capabilities
    where partner_id = 'a2000000-0000-4000-8000-000000000002')::text[],
  array['referrer', 'operator'],
  'la ligne referrer est créée avant la ligne operator (invariant operator ⇒ referrer)'
);

-- grant_capability : doublon exact (même partenaire/rôle/établissement) → exception -------------
select throws_ok(
  $$ select grant_capability('a2000000-0000-4000-8000-000000000001'::uuid, 'referrer') $$,
  'P0001'::char(5), null,
  'grant_capability refuse un doublon exact partenaire/rôle/établissement'
);

-- set_capability_status : statut invalide / capacité inexistante → exception chacun -------------
select throws_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000031'::uuid, 'bogus') $$,
  'P0001'::char(5), null,
  'set_capability_status refuse un statut invalide'
);
select throws_ok(
  $$ select set_capability_status('00000000-0000-4000-8000-000000000099'::uuid, 'active') $$,
  'P0001'::char(5), 'capacité introuvable',
  'set_capability_status refuse un capability_id inexistant'
);

-- set_capability_status : admin valide, testé sur les DEUX rôles (preuve de la symétrie) --------
select lives_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000031'::uuid, 'suspended', 'note-referrer') $$,
  'set_capability_status réussit sur une capacité referrer'
);
select is(
  (select status from partner_capabilities where id = 'a2000000-0000-4000-8000-000000000031'),
  'suspended',
  'statut referrer mis à jour'
);
select is(
  (select count(*) from audit_log where note = 'note-referrer')::int, 1,
  'une ligne audit_log créée pour la transition referrer'
);

select lives_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000032'::uuid, 'suspended', 'note-operator') $$,
  'set_capability_status réussit sur une capacité operator (même fonction, symétrie)'
);
select is(
  (select status from partner_capabilities where id = 'a2000000-0000-4000-8000-000000000032'),
  'suspended',
  'statut operator mis à jour'
);
select is(
  (select count(*) from audit_log where note = 'note-operator')::int, 1,
  'une ligne audit_log créée pour la transition operator'
);

-- transfer_establishment : établissement déjà rattaché à un AUTRE partenaire → transfert, pas
-- un doublon --------------------------------------------------------------------------------
select lives_ok(
  $$ select transfer_establishment('a2000000-0000-4000-8000-000000000012'::uuid,
       'a2000000-0000-4000-8000-000000000001'::uuid, 'note-transfer') $$,
  'transfer_establishment réussit sur un établissement déjà rattaché à un autre partenaire'
);
select is(
  (select partner_id from establishments where id = 'a2000000-0000-4000-8000-000000000012'),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'partner_id transféré vers le nouveau partenaire (pas de doublon)'
);
select is(
  (select jsonb_build_object('action', action, 'before', before, 'after', after)
     from audit_log where note = 'note-transfer'),
  jsonb_build_object(
    'action', 'establishment.transfer',
    'before', jsonb_build_object('partner_id', 'a2000000-0000-4000-8000-000000000002'),
    'after', jsonb_build_object('partner_id', 'a2000000-0000-4000-8000-000000000001')
  ),
  'audit_log enregistre before/after corrects pour le transfert'
);

-- set_partner_code_active : admin bascule → actif mis à jour + audit_log ------------------------
select lives_ok(
  $$ select set_partner_code_active('REGTEST-A', false, 'note-code') $$,
  'set_partner_code_active réussit pour l''admin'
);
select is(
  (select active from partner_codes where code = 'REGTEST-A'),
  false,
  'active basculé à false'
);
select is(
  (select jsonb_build_object('entity_id', entity_id, 'before', before, 'after', after)
     from audit_log where note = 'note-code'),
  jsonb_build_object(
    'entity_id', null,
    'before', jsonb_build_object('code', 'REGTEST-A', 'active', true),
    'after', jsonb_build_object('code', 'REGTEST-A', 'active', false)
  ),
  'audit_log enregistre entity_id=null (clé texte) et le code dans before/after'
);

select * from finish();
rollback;
