-- Revue admin clientes (Jérôme, 2026-08-19) — RPC list_client_orders (fiche détail client).
-- Couvre : appel non-admin refusé, résolution correcte de client_key → commandes (compte ET
-- email), référent résolu/absent, payment_status renvoyé, isolation entre deux clients distincts
-- (aucune fuite d'une commande d'un client dans le résultat d'un autre).
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('ed000000-0000-4000-8000-000000000001', 'Referente QAETABCLIDET');

insert into auth.users (id, email) values
  ('ed000000-0000-4000-8000-000000000001', 'client-orders-admin@test.local'),
  ('ed900000-0000-4000-8000-000000000001', 'client-orders-stranger@test.local'),
  ('ed100000-0000-4000-8000-0000000000a1', 'client-orders-g-account@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('ed000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- Client G — compte enregistré, 2 commandes : une avec référent + payment_status par défaut
-- (unpaid), une sans référent + payment_status='paid'.
insert into orders (id, account_id, holder_name, holder_email, referrer_partner_id) values
  ('ed600000-0000-4000-8000-000000000001', 'ed100000-0000-4000-8000-0000000000a1',
   'Cliente G QAETABCLIDET', 'cliente.g.qaetabclidet@test.local',
   'ed000000-0000-4000-8000-000000000001');
insert into orders (id, account_id, holder_name, holder_email, payment_status) values
  ('ed600000-0000-4000-8000-000000000002', 'ed100000-0000-4000-8000-0000000000a1',
   'Cliente G QAETABCLIDET', 'cliente.g.qaetabclidet@test.local', 'paid');

-- Client H — pas de compte (clé = email), 1 commande isolée.
insert into orders (id, holder_name, holder_email) values
  ('ed700000-0000-4000-8000-000000000001', 'Cliente H QAETABCLIDET',
   'cliente.h.qaetabclidet@test.local');

set local role authenticated;

-- appel non-admin → exception -------------------------------------------------------------------
select test_login('ed900000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from list_client_orders('ed100000-0000-4000-8000-0000000000a1') $$,
  '42501'::char(5), null, 'list_client_orders refuse un appelant non-admin'
);

select test_login('ed000000-0000-4000-8000-000000000001');

-- résolution par account_id ------------------------------------------------------------------
select is(
  (select count(*) from list_client_orders('ed100000-0000-4000-8000-0000000000a1'))::int,
  2,
  'client_key = account_id résout bien les 2 commandes de Cliente G'
);
select is(
  (select referrer_display_name from list_client_orders('ed100000-0000-4000-8000-0000000000a1')
    where order_id = 'ed600000-0000-4000-8000-000000000001'),
  'Referente QAETABCLIDET',
  'référent résolu par nom sur la commande qui en porte un'
);
select is(
  (select referrer_display_name from list_client_orders('ed100000-0000-4000-8000-0000000000a1')
    where order_id = 'ed600000-0000-4000-8000-000000000002'),
  null::text,
  'référent absent (commande directe) → referrer_display_name null'
);
select is(
  (select payment_status from list_client_orders('ed100000-0000-4000-8000-0000000000a1')
    where order_id = 'ed600000-0000-4000-8000-000000000002'),
  'paid',
  'payment_status renvoyé fidèlement'
);

-- résolution par email + isolation entre clients ---------------------------------------------
select is(
  (select order_id from list_client_orders('cliente.h.qaetabclidet@test.local')),
  'ed700000-0000-4000-8000-000000000001'::uuid,
  'client_key = email résout la commande de Cliente H'
);
select is(
  (select count(*) from list_client_orders('cliente.h.qaetabclidet@test.local')
    where order_id in ('ed600000-0000-4000-8000-000000000001', 'ed600000-0000-4000-8000-000000000002'))::int,
  0,
  'la clé de Cliente H ne renvoie jamais les commandes de Cliente G (isolation)'
);
select is(
  (select count(*) from list_client_orders('ed100000-0000-4000-8000-0000000000a1')
    where order_id = 'ed700000-0000-4000-8000-000000000001')::int,
  0,
  'la clé de Cliente G ne renvoie jamais la commande de Cliente H (isolation réciproque)'
);

select * from finish();
rollback;
