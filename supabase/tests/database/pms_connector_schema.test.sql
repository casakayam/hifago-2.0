-- Spec 21 — Connecteur LobbyPMS, Phase 1 : schéma establishments/order_lines,
-- set_establishment_pms_connector, claim_pms_poll_batch.
-- Migrations 20260819110000_pms_connector_schema.sql, 20260819120000_claim_pms_poll_batch.sql.
begin;
select plan(14);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

insert into partners (id, display_name) values
  ('88920000-0000-4000-8000-000000000001', 'PMS Schema Test Partner');
insert into establishments (id, partner_id, name, lobby_api_token, lobby_connector_active) values
  ('88920000-0000-4000-8000-000000000011', '88920000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento PMS Schema'), 'seed-fake-token', true);

insert into auth.users (id, email) values
  ('88920000-0000-4000-8000-000000000031', 'pms-schema-admin@test.local'),
  ('88920000-0000-4000-8000-000000000032', 'pms-schema-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88920000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- Cas 1 : lobby_api_token illisible via PostgREST même pour l'admin (le REVOKE est au niveau
-- colonne, pas RLS ligne) — has_column_privilege reflète exactement ce que verrait une requête
-- PostgREST (grants), indépendamment de toute policy RLS.
select ok(
  not has_column_privilege('authenticated', 'establishments', 'lobby_api_token', 'select'),
  'authenticated (admin compris) ne peut jamais SELECT establishments.lobby_api_token'
);
select ok(
  has_column_privilege('authenticated', 'establishments', 'lobby_has_token', 'select'),
  'authenticated peut lire lobby_has_token (dérivée, non secrète)'
);

-- Cas 2 : lobby_has_token dérivée correctement.
select is(
  (select lobby_has_token from establishments where id = '88920000-0000-4000-8000-000000000011'),
  true,
  'lobby_has_token = true quand lobby_api_token est renseigné'
);

-- Cas 3 : claim_pms_poll_batch réservée à service_role.
select ok(
  not has_function_privilege('authenticated', 'claim_pms_poll_batch(int)', 'execute'),
  'authenticated ne peut jamais exécuter claim_pms_poll_batch'
);
select ok(
  not has_function_privilege('anon', 'claim_pms_poll_batch(int)', 'execute'),
  'anon ne peut jamais exécuter claim_pms_poll_batch'
);
select ok(
  has_function_privilege('service_role', 'claim_pms_poll_batch(int)', 'execute'),
  'service_role peut exécuter claim_pms_poll_batch'
);

-- Cas 4 : set_establishment_pms_connector — appel non-admin refusé.
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000032'); -- pas admin
select throws_ok(
  $$ select set_establishment_pms_connector(
       '88920000-0000-4000-8000-000000000011', 'new-token', true, 'tentative non admin'
     ) $$,
  '42501'::char(5),
  'set_establishment_pms_connector réservé au rôle admin',
  'appel non-admin → exception 42501'
);

select test_logout();
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031'); -- admin pour le reste

-- Cas 5 : motif vide → exception, rien modifié.
select throws_ok(
  $$ select set_establishment_pms_connector(
       '88920000-0000-4000-8000-000000000011', 'new-token', true, ''
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour modifier le connecteur PMS',
  'motif vide → exception'
);

-- Cas 6 : établissement inexistant → exception.
select throws_ok(
  $$ select set_establishment_pms_connector(
       '00000000-0000-4000-8000-000000000099', 'new-token', true, 'motivo válido'
     ) $$,
  'P0001'::char(5),
  'établissement introuvable',
  'établissement inexistant → exception'
);

-- Cas 7 : appel admin valide, p_lobby_api_token fourni → jeton remplacé, connecteur activé,
-- audit_log créée.
select is(
  (select set_establishment_pms_connector(
     '88920000-0000-4000-8000-000000000011', 'rotated-token', true, 'Rotation du jeton'
   )),
  jsonb_build_object('ok', true),
  'cas 7 : appel admin valide → succès'
);
reset role; -- lecture directe pour vérifier l'état réel (lobby_api_token illisible en authenticated)
select is(
  (select lobby_api_token from establishments where id = '88920000-0000-4000-8000-000000000011'),
  'rotated-token',
  'cas 7 : lobby_api_token remplacé'
);
select is(
  (select jsonb_build_object('action', action, 'entity_table', entity_table, 'entity_id', entity_id)
     from audit_log where entity_id = '88920000-0000-4000-8000-000000000011'
     and action = 'establishment.set_pms_connector'),
  jsonb_build_object(
    'action', 'establishment.set_pms_connector', 'entity_table', 'establishments',
    'entity_id', '88920000-0000-4000-8000-000000000011'
  ),
  'cas 7 : ligne audit_log correcte'
);

-- Cas 8 : p_lobby_api_token = null → jeton existant préservé (coalesce), connecteur désactivé.
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
select is(
  (select set_establishment_pms_connector(
     '88920000-0000-4000-8000-000000000011', null, false, 'Désactivation temporaire'
   )),
  jsonb_build_object('ok', true),
  'cas 8 : appel admin valide sans nouveau jeton → succès'
);
reset role;
select is(
  (select jsonb_build_object('token', lobby_api_token, 'active', lobby_connector_active)
     from establishments where id = '88920000-0000-4000-8000-000000000011'),
  jsonb_build_object('token', 'rotated-token', 'active', false),
  'cas 8 : jeton préservé (coalesce), connecteur désactivé'
);

select * from finish();
rollback;
