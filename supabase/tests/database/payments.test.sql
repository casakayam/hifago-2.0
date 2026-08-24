-- Spec 19 §0 Tranche 1 — create_payment_intent, apply_payment_webhook (grant service_role
-- uniquement), payment_reconciliation_entries/resolve_payment_reconciliation_entry,
-- expire_stale_payment_orders (job pg_cron). Migrations 20260818200000/210000/220000/230000,
-- seules sources de vérité pour les messages/logique. apply_payment_webhook n'a AUCUN check
-- interne d'identité (cf. commentaire de la migration) : sa sécurité repose entièrement sur le
-- GRANT — vérifié ici via has_function_privilege (métadonnée ACL) ET un appel réel sous
-- `set local role authenticated` (le vrai rôle Postgres change, contrairement à test_login qui ne
-- simule qu'un claim JWT), pas seulement l'un ou l'autre.
begin;
select plan(42);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Fixtures : 1 partenaire propriétaire/établissement/produit, 1 partenaire référent, 1 admin, 2
-- comptes acheteurs distincts (buyer = propriétaire des commandes de test, other = identité
-- différente pour le cas "commande d'un autre compte"), 1 compte référent.
insert into partners (id, display_name) values
  ('88970000-0000-4000-8000-000000000001', 'Payments Test Owner Partner'),
  ('88970000-0000-4000-8000-000000000002', 'Payments Test Referrer');
insert into establishments (id, partner_id, name) values
  ('88970000-0000-4000-8000-000000000011', '88970000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Payments'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88970000-0000-4000-8000-000000000021', '88970000-0000-4000-8000-000000000001',
  '88970000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Payments'), 100000, true, 'payments-test'
);

insert into auth.users (id, email) values
  ('88970000-0000-4000-8000-000000000031', 'payments-admin@test.local'),
  ('88970000-0000-4000-8000-000000000032', 'payments-buyer@test.local'),
  ('88970000-0000-4000-8000-000000000033', 'payments-other@test.local'),
  ('88970000-0000-4000-8000-000000000034', 'payments-referrer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88970000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status)
values ('88970000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
update partner_accounts set partner_id = '88970000-0000-4000-8000-000000000002'
 where id = '88970000-0000-4000-8000-000000000034';

-- Order A : invité (account_id null) — cas create_payment_intent principal (chemin invité, le plus
-- fréquent en usage réel : redirection Checkout Pro immédiatement après create_order).
insert into orders (id, account_id, holder_name, holder_email)
values ('88970000-0000-4000-8000-000000000041', null, 'Holder Payments Guest', 'guest-payments@test.local');
insert into order_lines (
  id, order_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000051', '88970000-0000-4000-8000-000000000041',
  '88970000-0000-4000-8000-000000000021', '2028-12-01', 1, 'reserved', 'Holder Payments Guest',
  100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);

-- Order B : compte authentifié (buyer), 3 lignes — 2 reserved (acompte 20000+20000=40000, seules
-- comptées) + 1 cancelled_by_client (exclue) + 1 superseded (exclue) : preuve que le montant somme
-- UNIQUEMENT les lignes encore actives, même discipline que cancel_order.
insert into orders (id, account_id, holder_name, holder_email)
values ('88970000-0000-4000-8000-000000000042', '88970000-0000-4000-8000-000000000032',
        'Holder Payments Buyer', 'buyer-payments@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88970000-0000-4000-8000-000000000052', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-02', 1, 'reserved', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000),
  ('88970000-0000-4000-8000-000000000053', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-03', 1, 'reserved', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000),
  ('88970000-0000-4000-8000-000000000054', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-04', 1, 'cancelled_by_client', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000),
  ('88970000-0000-4000-8000-000000000055', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-05', 1, 'superseded', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000);

-- Order C : toutes les lignes déjà annulées → rien à payer.
insert into orders (id, account_id, holder_name, holder_email)
values ('88970000-0000-4000-8000-000000000043', '88970000-0000-4000-8000-000000000032',
        'Holder Payments Nothing', 'nothing-payments@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000056', '88970000-0000-4000-8000-000000000043',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-06', 1, 'cancelled_by_client', 'Holder Payments Nothing', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000
);

------------------------------------------------------------------------------------------------
-- create_payment_intent
------------------------------------------------------------------------------------------------

-- Cas 1 : invité (rôle anon réel, sans claim JWT) crée un intent sur sa propre commande. UN SEUL
-- appel RPC (un second appel immédiat retomberait sur payment_already_pending, cf. cas 2) — les
-- autres assertions lisent l'état persisté (payments/orders), jamais un second appel à la RPC.
set local role anon;
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000041') ->> 'ok'),
  'true',
  'cas 1a : invité crée un intent sur sa propre commande → ok:true'
);
-- Lecture directe de payments : jamais sous anon/authenticated (RLS admin-only, payments_select_admin)
-- — reset role AVANT toute lecture de cette table dans ce fichier, même discipline que le reste des
-- RPC RLS-only déjà en place (ledger_entries.test.sql, set_order_line_status.test.sql).
reset role;
select is(
  (select amount_cop from payments where order_id = '88970000-0000-4000-8000-000000000041'),
  17000::bigint,
  'cas 1b : amount_cop = somme des acompte_cop des lignes reserved (17000)'
);
select is(
  (select status::text from payments where order_id = '88970000-0000-4000-8000-000000000041'),
  'pending',
  'cas 1c : une ligne payments pending créée'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000041'),
  'pending',
  'cas 1d : orders.payment_status passe à pending'
);

-- Cas 2 : second appel sur la même commande, intent encore pending → refusé (idempotence métier).
set local role anon;
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000041') ->> 'reason'),
  'payment_already_pending',
  'cas 2 : second intent alors qu''un pending existe déjà → payment_already_pending'
);

-- Cas 3 : commande inconnue → order_not_found.
select is(
  (select create_payment_intent('00000000-0000-4000-8000-000000000099') ->> 'reason'),
  'order_not_found',
  'cas 3 : commande inexistante → order_not_found'
);
reset role;

-- Cas 4 : buyer authentifié crée un intent sur SA commande à lignes mixtes (Order B).
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032'); -- buyer
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'ok'),
  'true',
  'cas 4a : buyer authentifié crée un intent sur sa propre commande → ok:true'
);
select test_logout();
reset role; -- lecture payments : admin-only RLS, jamais sous authenticated (cf. cas 1b)
select is(
  (select amount_cop from payments where order_id = '88970000-0000-4000-8000-000000000042'),
  40000::bigint,
  'cas 4b : amount_cop ignore les lignes cancelled_by_client/superseded (40000, pas 80000)'
);

-- Cas 5 : un AUTRE compte authentifié tente de payer la commande du buyer → order_not_found (même
-- réponse qu'une commande inexistante, jamais un refus distinct qui la confirmerait).
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000033'); -- other
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'reason'),
  'order_not_found',
  'cas 5 : un autre compte authentifié ne peut pas payer la commande du buyer'
);

-- Cas 6 : commande dont toutes les lignes sont déjà annulées → nothing_to_pay.
select test_logout();
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000043') ->> 'reason'),
  'nothing_to_pay',
  'cas 6 : commande sans ligne reserved → nothing_to_pay'
);

-- Cas 7 : paiement déjà approuvé → already_paid (nouvel intent refusé même après expiration du
-- pending précédent). Simule directement l'état post-webhook (pas besoin de rejouer webhook ici).
reset role;
update payments set status = 'approved' where order_id = '88970000-0000-4000-8000-000000000042';
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'reason'),
  'already_paid',
  'cas 7 : paiement déjà approuvé → already_paid'
);
select test_logout();
reset role;

------------------------------------------------------------------------------------------------
-- apply_payment_webhook — grant service_role uniquement (aucun check interne d'identité).
------------------------------------------------------------------------------------------------

-- Order D/E dédiées (payments insérés directement, RPC-only mais postgres/superuser passe outre —
-- même patron que les fixtures ledger_entries direct-insert).
insert into orders (id, account_id, holder_name, holder_email)
values
  ('88970000-0000-4000-8000-000000000044', '88970000-0000-4000-8000-000000000032',
   'Holder Payments Webhook OK', 'webhook-ok@test.local'),
  ('88970000-0000-4000-8000-000000000045', '88970000-0000-4000-8000-000000000032',
   'Holder Payments Webhook Rejected', 'webhook-rejected@test.local');
insert into payments (id, order_id, status, amount_cop)
values
  ('88970000-0000-4000-8000-000000000071', '88970000-0000-4000-8000-000000000044', 'pending', 25000),
  ('88970000-0000-4000-8000-000000000072', '88970000-0000-4000-8000-000000000045', 'pending', 30000);

-- Cas 8 : métadonnées ACL — jamais authenticated/anon, service_role uniquement.
select is(
  has_function_privilege('authenticated', 'apply_payment_webhook(text,uuid,text,jsonb)', 'execute'),
  false,
  'cas 8a : authenticated n''a jamais EXECUTE sur apply_payment_webhook'
);
select is(
  has_function_privilege('anon', 'apply_payment_webhook(text,uuid,text,jsonb)', 'execute'),
  false,
  'cas 8b : anon n''a jamais EXECUTE sur apply_payment_webhook'
);
select is(
  has_function_privilege('service_role', 'apply_payment_webhook(text,uuid,text,jsonb)', 'execute'),
  true,
  'cas 8c : service_role a EXECUTE sur apply_payment_webhook'
);

-- Cas 9 : appel réel sous le VRAI rôle Postgres authenticated (pas seulement un claim JWT) →
-- rejeté par le GRANT lui-même, avant même d'entrer dans le corps de la fonction.
set local role authenticated;
select throws_ok(
  $$ select apply_payment_webhook(
       'mp-1', '88970000-0000-4000-8000-000000000071'::uuid, 'approved', '{}'::jsonb
     ) $$,
  '42501'::char(5),
  null,
  'cas 9 : appel sous le rôle authenticated → permission denied (grant, pas un check interne)'
);
reset role;

-- Cas 10 : appel réel sous service_role → approbation effective.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-1', '88970000-0000-4000-8000-000000000071'::uuid, 'approved',
     jsonb_build_object('id', 'mp-1', 'status', 'approved')
   ) ->> 'ok'),
  'true',
  'cas 10a : webhook approved sous service_role → ok:true'
);
reset role;
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-000000000071'),
  'approved',
  'cas 10b : payments.status passe à approved'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000044'),
  'paid',
  'cas 10c : orders.payment_status passe à paid'
);
select is(
  (select mp_payment_id from payments where id = '88970000-0000-4000-8000-000000000071'),
  'mp-1',
  'cas 10d : mp_payment_id enregistré'
);

-- Cas 11 : webhook dupliqué (même paiement déjà approved) → no-op idempotent, ok:true (jamais une
-- erreur — Mercado Pago retenterait indéfiniment un webhook qui ne renvoie pas 2xx).
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-1', '88970000-0000-4000-8000-000000000071'::uuid, 'approved', '{}'::jsonb
   )),
  jsonb_build_object('ok', true, 'reason', 'already_applied'),
  'cas 11 : webhook dupliqué sur un paiement déjà approved → no-op idempotent'
);

-- Cas 12 : external_reference inconnue → payment_not_found.
select is(
  (select apply_payment_webhook(
     'mp-x', '00000000-0000-4000-8000-000000000099'::uuid, 'approved', '{}'::jsonb
   ) ->> 'reason'),
  'payment_not_found',
  'cas 12 : external_reference inconnue → payment_not_found'
);

-- Cas 13 : webhook rejected sur un paiement encore pending → orders.payment_status repasse unpaid.
select is(
  (select apply_payment_webhook(
     'mp-2', '88970000-0000-4000-8000-000000000072'::uuid, 'rejected', '{}'::jsonb
   ) ->> 'ok'),
  'true',
  'cas 13a : webhook rejected → ok:true'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000045'),
  'unpaid',
  'cas 13b : orders.payment_status repasse à unpaid après rejet'
);

-- Cas 14 : statut Mercado Pago inconnu → exception.
select throws_ok(
  $$ select apply_payment_webhook(
       'mp-3', '88970000-0000-4000-8000-000000000072'::uuid, 'bogus_status', '{}'::jsonb
     ) $$,
  'P0001'::char(5),
  null,
  'cas 14 : statut Mercado Pago inconnu → exception'
);
reset role;

------------------------------------------------------------------------------------------------
-- expire_stale_payment_orders — job pg_cron (30 minutes, §10 point 14).
------------------------------------------------------------------------------------------------

-- Order F : pending, 31 minutes, 1 ligne external_referrer + créance ledger estimated → doit
-- expirer ET voider la créance référent (même effet que set_order_line_status(...,'expired',...)).
insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
values ('88970000-0000-4000-8000-000000000046', '88970000-0000-4000-8000-000000000032',
        'Holder Expire Referrer', 'expire-referrer@test.local', 'pending', now() - interval '31 minutes');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, referrer_partner_id
) values (
  '88970000-0000-4000-8000-000000000081', '88970000-0000-4000-8000-000000000046',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-10', 1, 'reserved', 'Holder Expire Referrer', 100000, 100000, 'external_referrer',
  0.17, 0.10, 0.07, 17000, 10000, 7000, '88970000-0000-4000-8000-000000000002'
);
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
values (
  '88970000-0000-4000-8000-000000000091', '88970000-0000-4000-8000-000000000081',
  'referrer', '88970000-0000-4000-8000-000000000002', 'referral_earned', 10000, 'estimated'
);
insert into payments (id, order_id, status, amount_cop)
values ('88970000-0000-4000-8000-000000000073', '88970000-0000-4000-8000-000000000046', 'pending', 17000);

-- Order G : unpaid (jamais d'intent créé), 31 minutes → doit aussi expirer (condition élargie,
-- cf. commentaire de la migration : couvre le cas où create_payment_intent n'a jamais été appelé).
insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
values ('88970000-0000-4000-8000-000000000047', '88970000-0000-4000-8000-000000000032',
        'Holder Expire Unpaid', 'expire-unpaid@test.local', 'unpaid', now() - interval '31 minutes');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000082', '88970000-0000-4000-8000-000000000047',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-11', 1, 'reserved', 'Holder Expire Unpaid', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);

-- Order H : pending mais SEULEMENT 5 minutes → dans la fenêtre de grâce, ne doit jamais expirer.
insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
values ('88970000-0000-4000-8000-000000000048', '88970000-0000-4000-8000-000000000032',
        'Holder Fresh Pending', 'fresh-pending@test.local', 'pending', now() - interval '5 minutes');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000083', '88970000-0000-4000-8000-000000000048',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-12', 1, 'reserved', 'Holder Fresh Pending', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);

-- Order I : déjà paid, 31 minutes → jamais touché même si vieux (le paiement a bien abouti, une
-- ligne reserved qui attend juste sa date de prestation n'est jamais une expiration de paiement).
insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
values ('88970000-0000-4000-8000-000000000049', '88970000-0000-4000-8000-000000000032',
        'Holder Already Paid', 'already-paid@test.local', 'paid', now() - interval '31 minutes');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000084', '88970000-0000-4000-8000-000000000049',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-13', 1, 'reserved', 'Holder Already Paid', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);

-- Order J (régression 2026-08-18, corrigée 2026-08-24, cf. migration
-- 20260824010000_expire_stale_payment_orders_exempt_manual) : réservation walk-in
-- (commission_case='operator_manual', payment_status resté à son défaut 'unpaid' — create_manual_
-- order_line ne le touche jamais), 31 minutes → ne doit JAMAIS expirer, un walk-in n'attend
-- structurellement aucun paiement en ligne.
insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
values ('88970000-0000-4000-8000-000000000050', null,
        'Holder Walk-in Manual', 'reserva-manual@hifago.local', 'unpaid', now() - interval '31 minutes');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000085', '88970000-0000-4000-8000-000000000050',
  null, '88970000-0000-4000-8000-000000000021',
  '2028-12-14', 1, 'reserved', 'Holder Walk-in Manual', 100000, 100000, 'operator_manual', 0, 0, 0, 0, 0, 0
);

select expire_stale_payment_orders();

select is(
  (select status from order_lines where id = '88970000-0000-4000-8000-000000000081'),
  'expired',
  'cas 15a : Order F (pending, 31 min, external_referrer) → ligne expirée'
);
select is(
  (select status from ledger_entries where id = '88970000-0000-4000-8000-000000000091'),
  'void',
  'cas 15b : créance référent estimated → void (même effet que set_order_line_status expired)'
);
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-000000000073'),
  'cancelled',
  'cas 15c : payments pending → cancelled'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000046'),
  'unpaid',
  'cas 15d : orders.payment_status repasse à unpaid'
);
select is(
  (select status from order_lines where id = '88970000-0000-4000-8000-000000000082'),
  'expired',
  'cas 16 : Order G (unpaid, jamais d''intent, 31 min) → expire aussi (condition élargie)'
);
select is(
  (select status from order_lines where id = '88970000-0000-4000-8000-000000000083'),
  'reserved',
  'cas 17 : Order H (pending, 5 min, dans la fenêtre de grâce) → jamais touché'
);
select is(
  (select status from order_lines where id = '88970000-0000-4000-8000-000000000084'),
  'reserved',
  'cas 18 : Order I (déjà paid, 31 min) → jamais touché même vieux'
);
select is(
  (select status from order_lines where id = '88970000-0000-4000-8000-000000000085'),
  'reserved',
  'cas 19 : Order J (walk-in operator_manual, unpaid, 31 min) → jamais touché (régression 2026-08-18)'
);

------------------------------------------------------------------------------------------------
-- payment_reconciliation_entries / resolve_payment_reconciliation_entry
------------------------------------------------------------------------------------------------

insert into payment_reconciliation_entries (id, payment_id, mp_payment_id, external_reference, raw_event, failure_reason, status)
values
  ('88970000-0000-4000-8000-000000000101', '88970000-0000-4000-8000-000000000072', 'mp-2',
   '88970000-0000-4000-8000-000000000072', '{}'::jsonb, 'signature HMAC invalide', 'open'),
  ('88970000-0000-4000-8000-000000000102', null, 'mp-9', null, '{}'::jsonb,
   'external_reference introuvable', 'resolved');

-- Cas 19 : non-admin → 42501.
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032'); -- buyer
select throws_ok(
  $$ select resolve_payment_reconciliation_entry(
       '88970000-0000-4000-8000-000000000101', 'Tentativa no admin'
     ) $$,
  '42501'::char(5),
  'resolve_payment_reconciliation_entry réservé au rôle admin',
  'cas 19 : appel non-admin → exception 42501'
);

select test_logout();
select test_login('88970000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 20 : motif vide → exception.
select throws_ok(
  $$ select resolve_payment_reconciliation_entry('88970000-0000-4000-8000-000000000101', '') $$,
  'P0001'::char(5),
  'motif obligatoire pour résoudre une entrée',
  'cas 20 : motif vide → exception'
);

-- Cas 21 : entrée introuvable → exception.
select throws_ok(
  $$ select resolve_payment_reconciliation_entry('00000000-0000-4000-8000-000000000099', 'Motivo válido') $$,
  'P0001'::char(5),
  'entrée introuvable',
  'cas 21 : entrée inexistante → exception'
);

-- Cas 22 : admin résout l'entrée open.
select is(
  (select resolve_payment_reconciliation_entry(
     '88970000-0000-4000-8000-000000000101', 'Webhook rejoué manuellement, signature corrigée côté MP'
   ) ->> 'ok'),
  'true',
  'cas 22a : admin résout l''entrée open → ok:true'
);
select is(
  (select status from payment_reconciliation_entries where id = '88970000-0000-4000-8000-000000000101'),
  'resolved',
  'cas 22b : statut passe à resolved'
);

-- Cas 23 : entrée déjà résolue → exception.
select throws_ok(
  $$ select resolve_payment_reconciliation_entry('88970000-0000-4000-8000-000000000102', 'Motivo válido') $$,
  'P0001'::char(5),
  'entrée déjà traitée (statut resolved)',
  'cas 23 : entrée déjà résolue → exception'
);

-- Cas 24 : RLS — admin voit les 2 entrées de ce fichier.
select is(
  (select count(*)::int from payment_reconciliation_entries
    where id in ('88970000-0000-4000-8000-000000000101', '88970000-0000-4000-8000-000000000102')),
  2,
  'cas 24 : admin voit les 2 entrées de réconciliation'
);

-- Cas 25 : RLS — buyer (non-admin) ne voit aucune entrée.
select test_logout();
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select count(*)::int from payment_reconciliation_entries),
  0,
  'cas 25 : buyer (non-admin) → aucune entrée de réconciliation visible'
);

------------------------------------------------------------------------------------------------
-- payments — RLS admin-only
------------------------------------------------------------------------------------------------

-- Cas 26 : RLS — buyer (propriétaire des commandes elles-mêmes) ne voit AUCUN payments en direct
-- (le statut de paiement passe par le Route Handler service_role, jamais une lecture RLS directe).
select is(
  (select count(*)::int from payments),
  0,
  'cas 26 : buyer ne voit aucun payments en lecture directe, même sur ses propres commandes'
);

select test_logout();
select test_login('88970000-0000-4000-8000-000000000031'); -- admin
select is(
  (select count(*)::int from payments) >= 4,
  true,
  'cas 27 : admin voit les payments (au moins les 4 de ce fichier)'
);
select test_logout();

select * from finish();
rollback;
