-- Spec 31 (Tranche 4), migration 20260910130000 — le job pg_cron de purge des identités
-- anonymes sans commande après 30 jours. Couvre les 5 cas de la spec (§0 cas limites) : purgeable,
-- protégée par une commande, trop jeune, bloquée par une FK (le piège central — ne doit JAMAIS
-- arrêter le lot), et un compte réel jamais touché quel que soit son âge.
begin;
select plan(7);

-- Cas 1 : purgeable — anonyme, 31 jours, aucune commande.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());

-- Cas 2 : protégée — anonyme, 31 jours, AVEC une commande (invariant 9 : jamais purgée, quel que
-- soit le statut/âge de la commande — celle-ci n'a même pas de order_lines, ça n'a pas d'importance).
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into orders (id, account_id, holder_name, holder_email) values
  ('99995000-0000-4000-8000-000000000012', '99995000-0000-4000-8000-000000000002',
   'Purge Test Avec Commande', 'purge-avec-commande@test.local');

-- Cas 3 : trop jeune — anonyme, 5 jours, aucune commande.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '5 days', now());

-- Cas 4 : LE piège — purgeable en apparence (31 jours, aucune commande), mais bloquée par une FK
-- NO ACTION vers partner_accounts (ici audit_log.actor_id). Doit être SKIPPED, jamais faire
-- échouer le lot entier (ce qu'un simple `delete ... where ...` set-based ferait).
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into audit_log (actor_id, action, entity_table, entity_id, before, after, note) values
  ('99995000-0000-4000-8000-000000000004', 'test.action', 'orders', gen_random_uuid(), null, null,
   'fixture purge_expired_anonymous_identities.test.sql');

-- Cas 5 : compte RÉEL, 31 jours, aucune commande — jamais touché (is_anonymous=false).
insert into auth.users (id, instance_id, aud, role, is_anonymous, email, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', false, 'purge-compte-reel@test.local',
   now() - interval '31 days', now());

select is(
  (select (purge_expired_anonymous_identities() ->> 'purged')::int),
  1,
  'un seul candidat réellement purgé sur ce lot (cas 1)'
);
select is(
  (select purge_expired_anonymous_identities() ->> 'skipped'),
  '["99995000-0000-4000-8000-000000000004"]',
  -- Second appel : le cas 1 a déjà été purgé au premier appel, donc 0 candidat cette fois-ci —
  -- seule la ligne bloquée (cas 4) réapparaît comme skipped, preuve qu'elle n'a jamais été
  -- réessayée en silence ni oubliée.
  'la ligne bloquée par audit_log reste nommée dans skipped, jamais silencieusement perdue'
);

select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000001'),
  0,
  'cas 1 : identité purgeable réellement supprimée'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000002'),
  1,
  'cas 2 : identité avec une commande JAMAIS purgée (invariant 9)'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000003'),
  1,
  'cas 3 : identité trop jeune (5 jours) jamais purgée'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000004'),
  1,
  'cas 4 : identité bloquée par une FK reste en place (skip, jamais un delete forcé)'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000005'),
  1,
  'cas 5 : compte réel (is_anonymous=false) jamais candidat, quel que soit son âge'
);

select * from finish();
rollback;
