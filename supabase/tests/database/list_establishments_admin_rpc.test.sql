-- Revue admin établissements (Jérôme, 2026-08-19) — RPC list_establishments_admin.
-- Couvre : appel non-admin refusé, recherche unifiée nom établissement / nom partenaire,
-- indicateur "proposition en attente" (kind edit/photos), alerte "partenaire non opérationnel"
-- (établissement actif sans capacité operator active scopée — jamais sur un établissement
-- archivé), pagination (total_count/limit/offset).
--
-- Fixtures marquées 'QAETABLIST' pour scoper la recherche paginée indépendamment des données de
-- supabase/seed.sql déjà présentes sur cette instance locale partagée (même précaution que les
-- autres fichiers pgTAP du projet : des libellés distinctifs plutôt qu'un count(*) global).
begin;
select plan(12);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('ea100000-0000-4000-8000-000000000001', 'Partner QAETABLIST Uno'),
  ('ea200000-0000-4000-8000-000000000001', 'Partner Búsqueda Especial XYZ'),
  ('ea300000-0000-4000-8000-000000000001', 'Partner QAETABLIST Tres'),
  ('ea400000-0000-4000-8000-000000000001', 'Partner QAETABLIST Cuatro'),
  ('ea500000-0000-4000-8000-000000000001', 'Partner QAETABLIST Cinco');

insert into auth.users (id, email) values
  ('ea000000-0000-4000-8000-000000000001', 'estab-list-admin@test.local'),
  ('ea900000-0000-4000-8000-000000000001', 'estab-list-stranger@test.local'),
  ('ea500000-0000-4000-8000-0000000000a1', 'estab-list-p5-account@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('ea000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

update partner_accounts set partner_id = 'ea500000-0000-4000-8000-000000000001'
  where id = 'ea500000-0000-4000-8000-0000000000a1';

insert into establishments (id, partner_id, name, status) values
  ('ea100000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Búsqueda Único QAETABLIST'), 'active'),
  ('ea200000-0000-4000-8000-000000000002', 'ea200000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Refugio Genérico QAETABLIST'), 'active'),
  ('ea300000-0000-4000-8000-000000000002', 'ea300000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Cabaña Sin Operador QAETABLIST'), 'active'),
  ('ea400000-0000-4000-8000-000000000002', 'ea400000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Posada Archivada QAETABLIST'), 'archived'),
  ('ea500000-0000-4000-8000-000000000002', 'ea500000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Finca Con Propuesta QAETABLIST'), 'active');

-- partner_capabilities (rôle operator) et establishment_proposals sont RPC-only (grants
-- insert/update/delete révoqués pour authenticated/anon) : fixtures posées sous le rôle par
-- défaut (postgres, bypass RLS/grants), avant tout `set local role authenticated` — même
-- précaution que establishments_rls.test.sql pour create_establishment.
--
-- Trigger enforce_operator_implies_referrer : une capacité operator exige une capacité referrer
-- existante pour le même partenaire — même précondition que consume_partner_invitation produit
-- en vrai (referrer d'abord, operator ensuite).
insert into partner_capabilities (partner_id, role, source, status) values
  ('ea100000-0000-4000-8000-000000000001', 'referrer', 'newp', 'active'),
  ('ea300000-0000-4000-8000-000000000001', 'referrer', 'newp', 'active'),
  ('ea400000-0000-4000-8000-000000000001', 'referrer', 'newp', 'active'),
  ('ea500000-0000-4000-8000-000000000001', 'referrer', 'newp', 'active');

-- ea300000 (Cabaña "Sin Operador") délibérément 'suspended' : c'est la fixture du test
-- operator_inactive=true plus bas — depuis le retrait de pending_review (2026-08-20), 'suspended'
-- est la seule valeur restante qui n'est pas 'active'.
insert into partner_capabilities (partner_id, establishment_id, role, source, status) values
  ('ea100000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000002',
   'operator', 'admin', 'active'),
  ('ea300000-0000-4000-8000-000000000001', 'ea300000-0000-4000-8000-000000000002',
   'operator', 'admin', 'suspended'),
  ('ea400000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000002',
   'operator', 'admin', 'active'),
  ('ea500000-0000-4000-8000-000000000001', 'ea500000-0000-4000-8000-000000000002',
   'operator', 'admin', 'active');

insert into establishment_proposals
  (id, establishment_id, partner_id, submitted_by, kind, status, payload) values
  ('ea500000-0000-4000-8000-000000000003', 'ea500000-0000-4000-8000-000000000002',
   'ea500000-0000-4000-8000-000000000001', 'ea500000-0000-4000-8000-0000000000a1',
   'edit', 'pending', jsonb_build_object('name', jsonb_build_object('es', 'Finca Renombrada')));

set local role authenticated;

-- appel non-admin → exception ---------------------------------------------------------------
select test_login('ea900000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from list_establishments_admin() $$,
  '42501'::char(5), null, 'list_establishments_admin refuse un appelant non-admin'
);

select test_login('ea000000-0000-4000-8000-000000000001');

-- recherche unifiée ---------------------------------------------------------------------------
select is(
  (select id from list_establishments_admin(p_search => 'Búsqueda Único')),
  'ea100000-0000-4000-8000-000000000002'::uuid,
  'recherche par nom d''établissement trouve la ligne attendue'
);
select is(
  (select id from list_establishments_admin(p_search => 'Búsqueda Especial XYZ')),
  'ea200000-0000-4000-8000-000000000002'::uuid,
  'recherche par nom de PARTENAIRE trouve l''établissement rattaché (le cas qui échouait en .or())'
);

-- indicateur proposition en attente --------------------------------------------------------
select is(
  (select pending_proposal_id from list_establishments_admin(p_search => 'Búsqueda Único')),
  null::uuid,
  'établissement sans proposition pending → pending_proposal_id null'
);
select is(
  (select pending_proposal_id from list_establishments_admin(p_search => 'Con Propuesta')),
  'ea500000-0000-4000-8000-000000000003'::uuid,
  'établissement avec édition pending → pending_proposal_id renvoyé'
);
select is(
  (select pending_proposal_kind from list_establishments_admin(p_search => 'Con Propuesta')),
  'edit',
  'établissement avec édition pending → pending_proposal_kind = ''edit'''
);

-- alerte partenaire non opérationnel -------------------------------------------------------
select is(
  (select operator_inactive from list_establishments_admin(p_search => 'Sin Operador')),
  true,
  'établissement actif sans capacité operator active scopée → operator_inactive = true'
);
select is(
  (select operator_inactive from list_establishments_admin(p_search => 'Búsqueda Único')),
  false,
  'établissement actif avec capacité operator active scopée → operator_inactive = false'
);
select is(
  (select operator_inactive from list_establishments_admin(p_search => 'Archivada')),
  false,
  'établissement archivé → operator_inactive = false même sans capacité operator active'
);

-- pagination ------------------------------------------------------------------------------
select is(
  (select count(*) from list_establishments_admin(p_search => 'QAETABLIST', p_limit => 2, p_offset => 0))::int,
  2,
  'pagination — limit=2 offset=0 renvoie 2 lignes'
);
select is(
  (select total_count from list_establishments_admin(p_search => 'QAETABLIST', p_limit => 2, p_offset => 0) limit 1),
  5::bigint,
  'pagination — total_count reflète les 5 lignes correspondant à la recherche, indépendamment de limit'
);
select is(
  (select count(*) from list_establishments_admin(p_search => 'QAETABLIST', p_limit => 2, p_offset => 4))::int,
  1,
  'pagination — offset=4 (dernière page) renvoie la ligne restante (5 - 4 = 1)'
);

select * from finish();
rollback;
