-- Spec 31 (Tranche 3), migration 20260910120000 — les deux premières RPC de la liste blanche
-- étendue au-delà de consume_partner_invitation (20260909200000). Ni l'une ni l'autre n'avait de
-- test dédié jusqu'ici (0 fichier les mentionnant avant ce lot) : ce fichier comble ce trou, pas
-- seulement le contrôle mécanique de security_definer_exposure.test.sql (qui vérifie la PRÉSENCE
-- d'un garde reconnu dans le source, jamais que ce garde REFUSE vraiment en pratique).
begin;
select plan(4);

-- Fixture : une identité anonyme (aucun partner_id, comme toute session anonyme — décision ④) et
-- un vrai operator existant du seed (a0000000-0000-4000-8000-000000000003), pour prouver le refus
-- ET l'absence de régression avec le MÊME compte que /partner/account utilise en réel.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99993000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now(), now());

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"99993000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true
);

select throws_ok(
  $$ select update_my_account_profile('Nombre Anónimo') $$,
  '42501'::char(5), null,
  'update_my_account_profile refuse une session anonyme (invariant 5 — hors liste blanche)'
);
select throws_ok(
  $$ select set_my_payout_account('CBU-ANONIMO') $$,
  'P0002'::char(5), null,
  'set_my_payout_account refuse une session anonyme (aucun partner_id, comme tout non-partenaire)'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true
);

select is(
  (select update_my_account_profile('Operador Actualizado') ->> 'ok'),
  'true',
  'update_my_account_profile réussit toujours pour un vrai operator — aucune régression'
);
select is(
  (select set_my_payout_account('CBU-REAL-789') ->> 'ok'),
  'true',
  'set_my_payout_account réussit toujours pour un vrai operator (refactor partner_id_for_account) — aucune régression'
);

reset role;
select * from finish();
rollback;
