-- Lot fuseau (2026-08-28) — le côté base. `list_clients` dérivait l'état d'un client en comparant
-- ses dates à `current_date`, c'est-à-dire à la date du fuseau de la SESSION (UTC sur Supabase).
-- De 19 h à minuit à Guatapé, un client qui dort dans la maison ce soir-là passait `pasada`.
--
-- ⚠️ COMMENT CE TEST PEUT ÊTRE DÉTERMINISTE SANS FIGER L'HORLOGE. On ne peut pas simuler
-- `current_timestamp` en pgTAP. On n'en a pas besoin : il suffit de poser la MÊME question sous
-- deux fuseaux extrêmes et d'exiger la même réponse.
--
--   Pacific/Kiritimati = UTC+14, Pacific/Midway = UTC−11 → 25 heures d'écart. À TOUT instant, leurs
--   `current_date` diffèrent (d'un jour, de deux à l'heure UTC 10 — jamais de zéro). Et comme
--   America/Bogota (UTC−5) est ENTRE les deux, il ne peut jamais être égal aux deux à la fois :
--   il diffère donc TOUJOURS d'au moins l'un d'eux.
--
-- ⚠️ Ne PAS renforcer en « Bogota coïncide avec exactement l'un des deux » : c'est faux entre
-- 10 h et 10 h 59 UTC (Kiritimati est alors à J+1, Midway à J−1, et Bogota au milieu, égal à
-- aucun des deux). Cette assertion-là aurait fait rougir la CI une heure par jour, et le rouge
-- aurait été mis sur le compte d'un test instable. Le bon invariant est « au moins un », et il
-- suffit — c'est lui qui rend le témoin déterministe.
--
-- Conséquence, et c'est ce qui fait de ce fichier un TÉMOIN et pas seulement un test : sur une
-- fixture calée exactement sur la journée en cours à Guatapé, l'ANCIENNE fonction se trompait
-- forcément sous AU MOINS L'UN des deux fuseaux — 'pasada' sous Kiritimati quand il est déjà
-- passé à J+1, 'proxima' sous Midway quand il est encore à J−1, les deux à 10 h UTC — quelle que
-- soit l'heure à laquelle la CI tourne. La nouvelle rend 'en_casa' sous les trois.
-- Vérifié en rejouant ce fichier contre la définition d'avant la migration 20260828150000.
--
-- Fixtures marquées 'QATZBOG' pour scoper la recherche indépendamment des données déjà présentes
-- sur cette instance locale partagée (même précaution que list_clients_rpc.test.sql, et même
-- raison : aucune assertion ici ne compte de lignes en absolu).

begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- 1 ── today_in_bogota() ne dépend pas du fuseau de la session -----------------------------------
set time zone 'Pacific/Kiritimati';
create temporary table tz_probe as
  select public.today_in_bogota() as bogota, current_date as session_date, 'kiritimati' as label;
set time zone 'Pacific/Midway';
insert into tz_probe
  select public.today_in_bogota(), current_date, 'midway';

select is(
  (select count(distinct bogota)::int from tz_probe),
  1,
  'today_in_bogota() rend la même date sous UTC+14 et UTC-11 — elle ne lit pas le fuseau de la session'
);

-- TÉMOIN, dans le même fichier : si cette assertion tombait, le test ci-dessus ne prouverait rien
-- (il resterait vert avec `current_date` à la place). Elle atteste que les deux sessions sont bien
-- sur des jours différents, donc que la question posée est réellement discriminante.
select is(
  (select count(distinct session_date)::int from tz_probe),
  2,
  'TÉMOIN — current_date, lui, diffère entre ces deux fuseaux : le dispositif discrimine bien'
);

-- L'invariant qui tient 24 h sur 24 (vérifié heure UTC par heure UTC) : Bogota est ENTRE les deux
-- extrêmes, donc il ne peut pas être égal aux deux — il en diffère toujours d'au moins un. C'est
-- exactement ce qu'il faut, et pas plus : c'est ce qui garantit que l'ancienne fonction se trompait
-- sous au moins l'une des deux sessions, à n'importe quelle heure.
select cmp_ok(
  (select count(*)::int from tz_probe where bogota <> session_date),
  '>=',
  1,
  'TÉMOIN — Bogota diffère toujours d''au moins un des deux extrêmes (jamais égal aux deux)'
);

-- 1bis ── today_in_bogota() n'est pas sur la Data API -------------------------------------------
-- Elle n'a aucun appelant client : son seul appelant en base est list_clients, SECURITY DEFINER,
-- qui s'exécute avec les droits de son propriétaire. La révoquer ne casse donc rien (prouvé par les
-- assertions 4-6 ci-dessous, qui l'appellent à travers list_clients), et l'exposer serait de
-- l'inventaire à réauditer pour zéro bénéfice. Ces deux assertions rendent le revoke de la
-- migration 20260828150000 permanent : un re-grant, même accidentel, les fait tomber.
select ok(
  not has_function_privilege('anon', 'public.today_in_bogota()', 'EXECUTE'),
  'today_in_bogota() n''est pas exécutable par anon (revoke de 20260828150000)'
);
select ok(
  not has_function_privilege('authenticated', 'public.today_in_bogota()', 'EXECUTE'),
  'today_in_bogota() n''est pas exécutable par authenticated'
);

-- 2 ── list_clients : l'état d'un client calé sur la journée en cours à Guatapé -------------------
insert into partners (id, display_name) values
  ('ed000000-0000-4000-8000-000000000001', 'Partner QATZBOG Fixture');

insert into establishments (id, partner_id, name) values
  ('ed000000-0000-4000-8000-000000000003', 'ed000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento QATZBOG Fixture'));

insert into products (id, partner_id, establishment_id, type, name, price_cop, slug) values
  ('ed000000-0000-4000-8000-000000000002', 'ed000000-0000-4000-8000-000000000001',
   'ed000000-0000-4000-8000-000000000003', 'activity', jsonb_build_object('es', 'Actividad QATZBOG'),
   100000, 'actividad-qatzbog');

insert into auth.users (id, email) values
  ('ed000000-0000-4000-8000-000000000001', 'clients-tz-admin@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('ed000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- LA fixture du lot : une nuit réservée qui commence ET finit aujourd'hui À GUATAPÉ. C'est le cas
-- que l'admin voit tous les soirs et que la fonction classait faux. (Colonnes financières :
-- valeurs neutres, list_clients ne lit aucun montant — même remarque que list_clients_rpc.test.sql.)
insert into orders (id, holder_name, holder_email) values
  ('edA00000-0000-4000-8000-000000000001', 'Cliente Hoy QATZBOG', 'cliente.hoy.qatzbog@test.local');
insert into order_lines (
  order_id, product_id, date, end_date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values (
  'edA00000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-000000000002',
  public.today_in_bogota(), public.today_in_bogota(), 'reserved', 1, 100000, 100000, 'direct',
  0, 0, 0, 0, 0, 0, 'Cliente Hoy QATZBOG'
);

select test_login('ed000000-0000-4000-8000-000000000001');

set time zone 'Pacific/Kiritimati';
select is(
  (select client_stage from list_clients(p_search => 'QATZBOG')),
  'en_casa',
  'sous UTC+14, le client de ce soir est en_casa (l''ancienne disait pasada 20 h sur 24)'
);

set time zone 'Pacific/Midway';
select is(
  (select client_stage from list_clients(p_search => 'QATZBOG')),
  'en_casa',
  'sous UTC-11, le même client est en_casa (l''ancienne disait proxima 6 h sur 24)'
);

-- L'invariant, énoncé pour lui-même : le verdict ne dépend plus d'où part la requête.
set time zone 'UTC';
select is(
  (select client_stage from list_clients(p_search => 'QATZBOG')),
  'en_casa',
  'sous UTC (le réglage réel de Supabase), le verdict est le même que sous les deux extrêmes'
);

select * from finish();
rollback;
