-- Revue admin clientes (Jérôme, 2026-08-19) — RPC list_client_orders (fiche détail client).
-- Couvre : appel non-admin refusé, résolution correcte de client_key → commandes, référent
-- résolu/absent, payment_status renvoyé, isolation entre deux clients distincts (aucune fuite
-- d'une commande d'un client dans le résultat d'un autre).
--
-- ⚠️ RÉVISÉ 2026-09-10 (spec 31, Tranche 2) : orders.account_id est NOT NULL — « Client H, pas de
-- compte » (résolution par email) ne peut PLUS être construit comme une vraie ligne `orders`. Ce
-- n'est pas une régression fonctionnelle : les deux SEULS appelants de client_key_for_order
-- (list_clients, list_client_orders, vérifié — `select proname from pg_proc where prosrc ilike
-- '%client_key_for_order%'`) lui passent toujours `o.account_id`, donc les branches
-- email/téléphone/order_id de son coalesce() sont désormais INATTEIGNABLES par ces deux RPC en
-- usage réel — l'écran admin construit toujours son URL depuis le client_key que list_clients a
-- lui-même renvoyé (toujours un account_id désormais), jamais en tapant un email à la main. Fait
-- consigné dans docs/backlog.md, pas corrigé ici (client_key_for_order n'est pas dans le périmètre
-- de cette tranche) : sa fonction elle-même est INCHANGÉE, encore appelable avec account_id=null
-- si un jour un autre appelant en a besoin. Les 3 dernières assertions ci-dessous testent donc la
-- fonction DIRECTEMENT (aucune ligne `orders` requise) plutôt que via un fixture devenu impossible
-- — seule façon de garder cette logique couverte plutôt que de la laisser orpheline.
begin;
select plan(11);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('ed000000-0000-4000-8000-000000000001', 'Referente QAETABCLIDET');

insert into auth.users (id, email) values
  ('ed000000-0000-4000-8000-000000000001', 'client-orders-admin@test.local'),
  ('ed900000-0000-4000-8000-000000000001', 'client-orders-stranger@test.local'),
  ('ed100000-0000-4000-8000-0000000000a1', 'client-orders-g-account@test.local'),
  -- Remplace l'ancien "Client H sans compte" : un second client, DISTINCT de G, pour l'isolation.
  ('ed100000-0000-4000-8000-0000000000b1', 'client-orders-h-account@test.local');

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

-- Client H — compte enregistré DISTINCT de G, 1 commande isolée.
insert into orders (id, account_id, holder_name, holder_email) values
  ('ed700000-0000-4000-8000-000000000001', 'ed100000-0000-4000-8000-0000000000b1',
   'Cliente H QAETABCLIDET', 'cliente.h.qaetabclidet@test.local');

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

-- isolation entre deux clients à compte distinct ----------------------------------------------
select is(
  (select order_id from list_client_orders('ed100000-0000-4000-8000-0000000000b1')),
  'ed700000-0000-4000-8000-000000000001'::uuid,
  'client_key = account_id de Cliente H résout sa commande'
);
select is(
  (select count(*) from list_client_orders('ed100000-0000-4000-8000-0000000000b1')
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

-- client_key_for_order elle-même : la fonction pure, testée directement (cf. entête) -----------
select is(
  public.client_key_for_order(null, 'quelqu''un@test.local', '+57 300 000 0000', 'ed700000-0000-4000-8000-000000000001'::uuid),
  'quelqu''un@test.local',
  'client_key_for_order : account_id null, email présent → email (coalesce, 2e rang)'
);
select is(
  public.client_key_for_order(null, null, '+57 300 000 0000', 'ed700000-0000-4000-8000-000000000001'::uuid),
  '+57 300 000 0000',
  'client_key_for_order : account_id et email null, téléphone présent → téléphone (3e rang)'
);
select is(
  public.client_key_for_order(null, null, null, 'ed700000-0000-4000-8000-000000000001'::uuid),
  'ed700000-0000-4000-8000-000000000001',
  'client_key_for_order : les 3 premiers null → repli sur order_id (4e rang, jamais indéterminé)'
);

select * from finish();
rollback;
