-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — le garde-fou
-- mécanique de l'étape D (CLAUDE.md §11.20 : « une règle documentée que rien ne vérifie n'est pas
-- une règle »). Sans ce test, rien n'empêche un futur `grant select on order_lines to
-- authenticated` ponctuel (debug, script one-off) de rouvrir silencieusement la fuite — les 3
-- policies qui la refermeraient partiellement ont été supprimées (20260922210000), elles ne
-- protègent donc plus rien.
begin;
select plan(3);

select is(
  has_table_privilege('authenticated', 'order_lines', 'SELECT'),
  false,
  'authenticated n''a plus AUCUN accès SELECT direct à order_lines'
);
select is(
  has_table_privilege('anon', 'order_lines', 'SELECT'),
  false,
  'anon n''a jamais eu et n''a toujours pas d''accès SELECT direct à order_lines'
);

-- Preuve positive, pas seulement l'absence de privilège : un vrai SELECT sous authenticated
-- échoue en permission denied, AVANT même l'évaluation d'une éventuelle policy RLS.
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select throws_ok(
  $$ select app_commission_cop from order_lines limit 1 $$,
  '42501'::char(5), null,
  'un SELECT direct sous authenticated échoue en permission denied, même sur une base vide'
);

select * from finish();
rollback;
