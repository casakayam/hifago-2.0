-- Feature 16 (Admin : modérer une proposition socio) — moderate_product_proposal : accès admin
-- seul, motif obligatoire au rejet, décision invalide refusée, approbation applique le payload
-- CORRIGÉ (pas silencieusement le payload proposé), rejet laisse products inchangé, verrou
-- optimiste (version) testé séquentiellement (pas de barrière, calibrage bas-risque déjà tranché).
begin;
select plan(22);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : un partenaire propriétaire (capacité operator active) qui soumet des propositions via
-- submit_product_proposal (feature 15, déjà gatée — dogfooding plutôt que des inserts bruts dans
-- product_proposals, RPC-only), un admin qui les modère, un non-admin pour le refus d'accès.
insert into partners (id, display_name) values
  ('77770000-0000-4000-8000-000000000001', 'Moderate Test Partner');

insert into establishments (id, partner_id, name) values
  ('77770000-0000-4000-8000-000000000011', '77770000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Moderate'));

insert into auth.users (id, email) values
  ('77770000-0000-4000-8000-000000000031', 'moderate-owner@test.local'),
  ('77770000-0000-4000-8000-000000000032', 'moderate-admin@test.local'),
  ('77770000-0000-4000-8000-000000000033', 'moderate-nonadmin@test.local');

update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000001'
 where id = '77770000-0000-4000-8000-000000000031';

insert into partner_capabilities (partner_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('77770000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000032', 'admin', 'migration', 'active');

insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug
) values
  ('77770000-0000-4000-8000-000000000021', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Producto P1 original'), 50000, false, 'moderate-test-p1'),
  ('77770000-0000-4000-8000-000000000022', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Producto P2 original'), 55000, false, 'moderate-test-p2');

set local role authenticated;

-- Accès refusé à un non-admin (avant même de chercher la proposition) --------------------------
select test_login('77770000-0000-4000-8000-000000000033');
select throws_ok(
  $$ select moderate_product_proposal('00000000-0000-4000-8000-000000000099'::uuid, 'approve', 1) $$,
  '42501'::char(5), null,
  'un compte non-admin ne peut pas modérer une proposition'
);

-- Proposition #1 sur P1 (soumise par le propriétaire) --------------------------------------------
select test_login('77770000-0000-4000-8000-000000000031');
create temp table tmp_p1 as
  select (submit_product_proposal(
    '77770000-0000-4000-8000-000000000021'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'P1 Propuesta'),
      'description', null,
      'price_cop', 70000,
      'category', 'arte'
    )
  )->>'proposal_id')::uuid as id;

select test_login('77770000-0000-4000-8000-000000000032');

-- Rejet sans motif → exception, rien ne change ----------------------------------------------
select throws_ok(
  $$ select moderate_product_proposal(
       (select id from tmp_p1), 'reject', 1
     ) $$,
  null, 'motif obligatoire pour un rejet',
  'rejeter sans motif est refusé'
);
select is(
  (select status from product_proposals where id = (select id from tmp_p1)),
  'pending',
  'la proposition reste pending après un rejet refusé (motif manquant)'
);

-- Décision invalide → exception --------------------------------------------------------------
select throws_ok(
  $$ select moderate_product_proposal((select id from tmp_p1), 'delete_everything', 1) $$,
  null, null,
  'une décision hors approve/reject est refusée'
);

-- Approbation SANS correction : products reflète le payload PROPOSÉ tel quel -------------------
select lives_ok(
  $$ select moderate_product_proposal((select id from tmp_p1), 'approve', 1) $$,
  'approbation sans correction réussit (version attendue correcte)'
);
select is(
  (select jsonb_build_object('name', name, 'price_cop', price_cop)
     from products where id = '77770000-0000-4000-8000-000000000021'),
  jsonb_build_object('name', jsonb_build_object('es', 'P1 Propuesta'), 'price_cop', 70000),
  'products reflète exactement les valeurs proposées (aucune correction fournie) — category (spec 15 bis, abandonné) plus jamais écrit'
);
select is(
  (select status from product_proposals where id = (select id from tmp_p1)),
  'approved',
  'la proposition passe à approved'
);
select is(
  (select version from product_proposals where id = (select id from tmp_p1)),
  2,
  'version incrémentée après approbation (1 → 2)'
);
select is(
  (select count(*) from audit_log
    where action = 'product_proposal.approve'
      and entity_table = 'products'
      and entity_id = '77770000-0000-4000-8000-000000000021')::int,
  1,
  'une entrée audit_log est créée pour l''approbation'
);

-- Proposition #2 sur P2, approuvée AVEC correction : preuve que la valeur CORRIGÉE prime --------
select test_login('77770000-0000-4000-8000-000000000031');
create temp table tmp_p2 as
  select (submit_product_proposal(
    '77770000-0000-4000-8000-000000000022'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'P2 Propuesta'),
      'description', jsonb_build_object('es', 'Descripción propuesta'),
      'price_cop', 80000,
      'category', 'nautica'
    )
  )->>'proposal_id')::uuid as id;

select test_login('77770000-0000-4000-8000-000000000032');
-- Correction = objet COMPLET (spec 15 bis, 20260817150000 — plus un coalesce champ par champ,
-- même patron que les branches kind='create'/'photos') : le formulaire de modération envoie
-- toujours tous les champs, jamais un diff partiel — un objet partiel comme {price_cop:...} seul
-- écraserait silencieusement name (NOT NULL) si ce n'était pas le cas.
select lives_ok(
  $$ select moderate_product_proposal(
       (select id from tmp_p2), 'approve', 1,
       jsonb_build_object(
         'name', jsonb_build_object('es', 'P2 Propuesta'),
         'description', jsonb_build_object('es', 'Descripción propuesta'),
         'price_cop', 99000,
         -- Cupo diario por defecto (spec 18) — objet corrigé complet, comme name/price_cop.
         'default_capacity', 3
       )
     ) $$,
  'approbation avec une correction de prix réussit (objet complet)'
);
select is(
  (select price_cop from products where id = '77770000-0000-4000-8000-000000000022'),
  99000::bigint,
  'products porte le PRIX CORRIGÉ par l''admin (99000), pas le prix proposé d''origine (80000)'
);
select is(
  (select name from products where id = '77770000-0000-4000-8000-000000000022'),
  jsonb_build_object('es', 'P2 Propuesta'),
  'le nom, non corrigé, retombe bien sur la valeur proposée (coalesce)'
);
select is(
  (select default_capacity from products where id = '77770000-0000-4000-8000-000000000022'),
  3,
  'default_capacity (cupo diario) corrigé par l''admin survit le merge de moderate_product_proposal (branche content)'
);

-- Proposition #3 sur P1, rejetée avec motif : products reste INCHANGÉ ---------------------------
select test_login('77770000-0000-4000-8000-000000000031');
create temp table tmp_p1_reject as
  select (submit_product_proposal(
    '77770000-0000-4000-8000-000000000021'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'P1 Propuesta Rejetée'), 'price_cop', 12345)
  )->>'proposal_id')::uuid as id;

select test_login('77770000-0000-4000-8000-000000000032');
select lives_ok(
  $$ select moderate_product_proposal(
       (select id from tmp_p1_reject), 'reject', 1, null, 'No cumple los estándares de calidad'
     ) $$,
  'rejet avec motif réussit'
);
select is(
  (select jsonb_build_object('name', name, 'price_cop', price_cop)
     from products where id = '77770000-0000-4000-8000-000000000021'),
  jsonb_build_object('name', jsonb_build_object('es', 'P1 Propuesta'), 'price_cop', 70000),
  'products reste inchangé après un rejet (toujours la valeur de l''approbation précédente)'
);
select is(
  (select jsonb_build_object('status', status, 'rejection_reason', rejection_reason)
     from product_proposals where id = (select id from tmp_p1_reject)),
  jsonb_build_object('status', 'rejected', 'rejection_reason', 'No cumple los estándares de calidad'),
  'la proposition passe à rejected avec le motif stocké tel quel'
);
select is(
  (select count(*) from audit_log
    where action = 'product_proposal.reject'
      and entity_table = 'product_proposals'
      and entity_id = (select id from tmp_p1_reject))::int,
  1,
  'une entrée audit_log est créée pour le rejet'
);

-- Verrou optimiste — test SÉQUENTIEL (pas de barrière) : version=1 réussit, la même version=1
-- rejouée après coup échoue -----------------------------------------------------------------
select test_login('77770000-0000-4000-8000-000000000031');
create temp table tmp_p1_lock as
  select (submit_product_proposal(
    '77770000-0000-4000-8000-000000000021'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'P1 Verrou'), 'price_cop', 40000)
  )->>'proposal_id')::uuid as id;

select test_login('77770000-0000-4000-8000-000000000032');
select is(
  (select moderate_product_proposal((select id from tmp_p1_lock), 'approve', 1)->>'ok'),
  'true',
  'première approbation avec version=1 réussit'
);
select is(
  (select version from product_proposals where id = (select id from tmp_p1_lock)),
  2,
  'version passe à 2 après cette approbation'
);
-- Rejoue le MÊME p_expected_version=1, désormais périmé. Constat empirique (pas un écart au
-- plan) : le statut passe à 'approved' EN MÊME TEMPS que version s'incrémente (les deux dans la
-- même transaction ci-dessus) — pour une proposition non-pending, le contrôle de statut
-- (`already_handled`) est donc TOUJOURS évalué avant celui de version dans ce code, jamais
-- `version_conflict` pour ce scénario précis. `version_conflict` reste testé séparément plus bas
-- (état artificiel : version modifiée sans changement de statut), le seul cas où il peut
-- réellement se déclencher avec ce code tel qu'écrit.
create temp table tmp_stale_result as
  select moderate_product_proposal((select id from tmp_p1_lock), 'approve', 1) as result;

select is(
  (select jsonb_build_object('reason', result->>'reason', 'reviewed_by_email', result->>'reviewed_by_email')
     from tmp_stale_result),
  jsonb_build_object('reason', 'already_handled', 'reviewed_by_email', 'moderate-admin@test.local'),
  'rejouer l''ancien version=1 après coup est refusé (already_handled), avec le bon reviewed_by_email'
);

drop table tmp_stale_result;

-- version_conflict isolé : version modifiée sans changement de statut (état hypothétique, pas
-- atteignable par le code actuel de cette RPC seule — prouve la branche telle qu'écrite) --------
select test_login('77770000-0000-4000-8000-000000000031');
create temp table tmp_p1_vc as
  select (submit_product_proposal(
    '77770000-0000-4000-8000-000000000021'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'P1 VC'), 'price_cop', 41000)
  )->>'proposal_id')::uuid as id;

reset role;
update product_proposals set version = 5 where id = (select id from tmp_p1_vc);
set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000032');

select is(
  (select moderate_product_proposal((select id from tmp_p1_vc), 'approve', 1)->>'reason'),
  'version_conflict',
  'une version attendue périmée sur une proposition toujours pending échoue en version_conflict'
);
select is(
  (select status from product_proposals where id = (select id from tmp_p1_vc)),
  'pending',
  'la proposition reste intacte (pending) après un échec version_conflict'
);

select * from finish();
rollback;
