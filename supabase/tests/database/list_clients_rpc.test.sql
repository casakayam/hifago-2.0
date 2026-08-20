-- Revue admin clientes (Jérôme, 2026-08-19) — RPC list_clients étendue (filtre p_status, tri,
-- client_stage). Couvre : appel non-admin refusé, dérivation du stade par client sur ses 4 valeurs
-- (proxima/en_casa/pasada/cancelada), la règle "le stade le plus actif l'emporte" sur un client à
-- statuts mixtes, l'exclusion des lignes superseded, le filtre p_status, la pagination.
--
-- Fixtures marquées 'QAETABCLI' pour scoper recherche/pagination indépendamment des données de
-- supabase/seed.sql déjà présentes sur cette instance locale partagée (même précaution que
-- list_establishments_admin_rpc.test.sql).
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('ec000000-0000-4000-8000-000000000001', 'Partner QAETABCLI Fixture');

insert into establishments (id, partner_id, name) values
  ('ec000000-0000-4000-8000-000000000003', 'ec000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento QAETABCLI Fixture'));

insert into products (id, partner_id, establishment_id, type, name, price_cop, slug) values
  ('ec000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000001',
   'ec000000-0000-4000-8000-000000000003', 'activity', jsonb_build_object('es', 'Actividad QAETABCLI'),
   100000, 'actividad-qaetabcli');

insert into auth.users (id, email) values
  ('ec000000-0000-4000-8000-000000000001', 'clients-list-admin@test.local'),
  ('ec900000-0000-4000-8000-000000000001', 'clients-list-stranger@test.local'),
  ('ec100000-0000-4000-8000-0000000000a1', 'clients-list-client-a-account@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('ec000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- order_lines porte un snapshot financier figé (commission_case + 6 colonnes numériques, NOT NULL
-- sans défaut depuis 20260814180000) — hors périmètre de ce test (list_clients ne lit ni ne
-- calcule aucun montant), valeurs neutres/nulles posées juste pour satisfaire les contraintes.
-- holder_name dupliqué depuis orders (NOT NULL depuis 20260817180000) — même valeur que la
-- commande, jamais lu séparément par list_clients (source de vérité = orders.holder_name).

-- Client A — compte enregistré (account_id), une seule ligne réservée dans le futur → proxima.
insert into orders (id, account_id, holder_name, holder_email) values
  ('ecA00000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-0000000000a1',
   'Cliente Proxima QAETABCLI', 'cliente.proxima.qaetabcli@test.local');
insert into order_lines (
  order_id, product_id, date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values (
  'ecA00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
  current_date + 10, 'reserved', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
  'Cliente Proxima QAETABCLI'
);

-- Client B — pas de compte (clé = email), ligne réservée à cheval sur aujourd'hui → en_casa.
insert into orders (id, holder_name, holder_email) values
  ('ecB00000-0000-4000-8000-000000000001', 'Cliente Encasa QAETABCLI',
   'cliente.encasa.qaetabcli@test.local');
insert into order_lines (
  order_id, product_id, date, end_date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values (
  'ecB00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
  current_date - 1, current_date + 1, 'reserved', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
  'Cliente Encasa QAETABCLI'
);

-- Client C — ligne réalisée dans le passé → pasada.
insert into orders (id, holder_name, holder_email) values
  ('ecC00000-0000-4000-8000-000000000001', 'Cliente Pasada QAETABCLI',
   'cliente.pasada.qaetabcli@test.local');
insert into order_lines (
  order_id, product_id, date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values (
  'ecC00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
  current_date - 10, 'fulfilled', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
  'Cliente Pasada QAETABCLI'
);

-- Client D — toutes ses lignes annulées → cancelada.
insert into orders (id, holder_name, holder_email) values
  ('ecD00000-0000-4000-8000-000000000001', 'Cliente Cancelada QAETABCLI',
   'cliente.cancelada.qaetabcli@test.local');
insert into order_lines (
  order_id, product_id, date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values (
  'ecD00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
  current_date - 5, 'cancelled_by_client', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
  'Cliente Cancelada QAETABCLI'
);

-- Client E — statuts mixtes sur 2 commandes distinctes (une annulée passée, une réservée future)
-- → le stade le plus "actif" (proxima) l'emporte, jamais cancelada.
insert into orders (id, holder_name, holder_email) values
  ('ecE00000-0000-4000-8000-000000000001', 'Cliente Mixto QAETABCLI',
   'cliente.mixto.qaetabcli@test.local'),
  ('ecE00000-0000-4000-8000-000000000002', 'Cliente Mixto QAETABCLI',
   'cliente.mixto.qaetabcli@test.local');
insert into order_lines (
  order_id, product_id, date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values
  ('ecE00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
   current_date - 5, 'cancelled_by_client', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
   'Cliente Mixto QAETABCLI'),
  ('ecE00000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000002',
   current_date + 5, 'reserved', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
   'Cliente Mixto QAETABCLI');

-- Client F — une ligne superseded qui SERAIT proxima si elle comptait, mais sa seule ligne
-- "vivante" est fulfilled dans le passé → doit rester pasada (preuve que superseded est bien
-- exclu du calcul, pas juste accessoirement absent).
insert into orders (id, holder_name, holder_email) values
  ('ecF00000-0000-4000-8000-000000000001', 'Cliente Superseded QAETABCLI',
   'cliente.superseded.qaetabcli@test.local');
insert into order_lines (
  order_id, product_id, date, status, qty, price_cop, total_cop, commission_case,
  acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop,
  holder_name
) values
  ('ecF00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
   current_date + 100, 'superseded', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
   'Cliente Superseded QAETABCLI'),
  ('ecF00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002',
   current_date - 20, 'fulfilled', 1, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0,
   'Cliente Superseded QAETABCLI');

set local role authenticated;

-- appel non-admin → exception -------------------------------------------------------------------
select test_login('ec900000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from list_clients() $$,
  '42501'::char(5), null, 'list_clients refuse un appelant non-admin'
);

select test_login('ec000000-0000-4000-8000-000000000001');

-- dérivation du stade par client -----------------------------------------------------------------
select is(
  (select client_stage from list_clients(p_search => 'Proxima QAETABCLI')),
  'proxima',
  'ligne réservée future → client_stage = proxima'
);
select is(
  (select client_stage from list_clients(p_search => 'Encasa QAETABCLI')),
  'en_casa',
  'ligne réservée à cheval sur aujourd''hui → client_stage = en_casa'
);
select is(
  (select client_stage from list_clients(p_search => 'Pasada QAETABCLI')),
  'pasada',
  'ligne réalisée passée → client_stage = pasada'
);
select is(
  (select client_stage from list_clients(p_search => 'Cancelada QAETABCLI')),
  'cancelada',
  'toutes les lignes annulées → client_stage = cancelada'
);
select is(
  (select client_stage from list_clients(p_search => 'Mixto QAETABCLI')),
  'proxima',
  'client à statuts mixtes (annulé + futur réservé) → le stade le plus actif (proxima) l''emporte, jamais cancelada'
);
select is(
  (select orders_count from list_clients(p_search => 'Mixto QAETABCLI'))::int,
  2,
  'client Mixto agrège bien ses 2 commandes distinctes'
);
select is(
  (select client_stage from list_clients(p_search => 'Superseded QAETABCLI')),
  'pasada',
  'ligne superseded exclue du calcul — le stade retombe sur la ligne fulfilled passée, jamais proxima'
);

-- filtre p_status ---------------------------------------------------------------------------------
select is(
  (select count(*) from list_clients(p_search => 'QAETABCLI', p_status => 'cancelada'))::int,
  1,
  'filtre status=cancelada ne retient QUE le client réellement tout-annulé (pas le client Mixto)'
);
select is(
  (select count(*) from list_clients(p_search => 'QAETABCLI', p_status => 'proxima'))::int,
  2,
  'filtre status=proxima retient Proxima ET Mixto'
);

-- résolution de la clé composite -------------------------------------------------------------------
select is(
  (select client_key from list_clients(p_search => 'Proxima QAETABCLI')),
  'ec100000-0000-4000-8000-0000000000a1',
  'client avec compte → client_key = account_id'
);
select is(
  (select client_key from list_clients(p_search => 'Encasa QAETABCLI')),
  'cliente.encasa.qaetabcli@test.local',
  'client sans compte → client_key = email en minuscule'
);

-- pagination ------------------------------------------------------------------------------------
select is(
  (select count(*) from list_clients(p_search => 'QAETABCLI', p_limit => 3, p_offset => 0))::int,
  3,
  'pagination — limit=3 offset=0 renvoie 3 lignes'
);
select is(
  (select total_count from list_clients(p_search => 'QAETABCLI', p_limit => 3, p_offset => 0) limit 1),
  6::bigint,
  'pagination — total_count reflète les 6 clients QAETABCLI, indépendamment de limit'
);
select is(
  (select count(*) from list_clients(p_search => 'QAETABCLI', p_limit => 3, p_offset => 5))::int,
  1,
  'pagination — offset=5 (dernière page) renvoie la ligne restante (6 - 5 = 1)'
);

select * from finish();
rollback;
