-- Tranche 1 (identité composable) — invariant operator ⇒ referrer + helpers is_admin()/
-- partner_id_for_account(). Séquentiel, pas de concurrence réelle ici (cf. hifago/CLAUDE.md §6) —
-- normal pour ce type de test, la concurrence réelle est couverte par le test de barrière de la
-- RPC consume_partner_invitation (0004).
--
-- Correctif Tranche 1 (granularité par établissement de la capacité operator) : tests des 3
-- nouveaux index partiels sur partner_capabilities, en fin de fichier.
begin;
select plan(11);

insert into partners (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Partner A'),
  ('22222222-2222-2222-2222-222222222222', 'Partner B');

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@test.local'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin@test.local');

update partner_accounts set partner_id = '11111111-1111-1111-1111-111111111111'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

insert into partner_capabilities (account_id, role, source, status)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin', 'migration', 'active');

-- operator sans referrer préalable : refusé
select throws_ok(
  $$ insert into partner_capabilities (partner_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'operator', 'admin') $$,
  'P0001',
  null,
  'operator capability sans referrer préalable échoue'
);

-- referrer d'abord : accepté
select lives_ok(
  $$ insert into partner_capabilities (partner_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'referrer', 'admin') $$,
  'referrer capability seule réussit'
);

-- operator après referrer : accepté
select lives_ok(
  $$ insert into partner_capabilities (partner_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'operator', 'admin') $$,
  'operator capability réussit une fois referrer présent'
);

-- capacité admin avec partner_id renseigné : refusé par la contrainte de forme
select throws_ok(
  $$ insert into partner_capabilities (partner_id, account_id, role, source)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin', 'admin') $$,
  '23514',
  null,
  'capacité admin avec partner_id non nul viole partner_capabilities_scope'
);

-- helpers
select ok(is_admin('cccccccc-cccc-cccc-cccc-cccccccccccc'), 'is_admin() vrai pour le compte admin');
select ok(not is_admin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'is_admin() faux pour un compte non-admin');
select is(
  partner_id_for_account('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'partner_id_for_account() résout le bon partenaire'
);

-- Correctif Tranche 1 — granularité par établissement de la capacité operator ------------------
-- Partner B a déjà, à ce stade, une ligne referrer et une ligne operator "en attente"
-- (establishment_id null, insérées ci-dessus) — les nouveaux index partiels portent uniquement
-- sur les lignes operator RATTACHÉES (establishment_id non nul), sans conflit avec cette ligne en
-- attente.
insert into establishments (id, partner_id, name) values
  ('e1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   jsonb_build_object('es', 'Establecimiento Uno')),
  ('e2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   jsonb_build_object('es', 'Establecimiento Dos'));

select lives_ok(
  $$ insert into partner_capabilities (partner_id, establishment_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'e1111111-1111-1111-1111-111111111111',
             'operator', 'admin') $$,
  'operator rattaché à un premier établissement réussit'
);

-- Preuve directe du bug corrigé : sans le drop + recréation restreinte de
-- partner_capabilities_partner_role_idx, ce deuxième insert operator pour le même partenaire
-- aurait violé l'ancien index unique (partner_id, role), quel que soit l'établissement.
select lives_ok(
  $$ insert into partner_capabilities (partner_id, establishment_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'e2222222-2222-2222-2222-222222222222',
             'operator', 'admin') $$,
  'operator rattaché à un DEUXIÈME établissement différent réussit aussi'
);

select throws_ok(
  $$ insert into partner_capabilities (partner_id, establishment_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'e1111111-1111-1111-1111-111111111111',
             'operator', 'admin') $$,
  '23505'::char(5), null,
  'une deuxième ligne operator pour le MÊME établissement est rejetée (index unique partiel)'
);

select throws_ok(
  $$ insert into partner_capabilities (partner_id, role, source)
     values ('22222222-2222-2222-2222-222222222222', 'referrer', 'admin') $$,
  '23505'::char(5), null,
  'une deuxième ligne referrer pour le même partenaire reste rejetée (index restreint role <> operator toujours actif)'
);

select * from finish();
rollback;
