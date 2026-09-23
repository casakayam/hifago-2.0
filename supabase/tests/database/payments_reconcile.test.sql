-- Lot B — réconciliation Mercado Pago qui pilote l'expiration (spec 39, migration 20260921100000).
-- Chaque cas correspond à une situation observée ou reproductible en préprod. Les points du lot
-- (libération des places, gardes d'expiration, refunded, double paiement même référence) sont
-- vérifiés par MUTATION le 2026-09-21 (journal). Jamais de concurrence ici (CLAUDE.md §6.3) :
-- tests/concurrency/*.mjs s'en charge.
begin;
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;
select plan(129);

-- Fixtures ------------------------------------------------------------------------------------
insert into partners (id, display_name) values
  ('88980000-0000-4000-8000-000000000001', 'Reconcile Test Partner'),
  ('88980000-0000-4000-8000-000000000002', 'Reconcile Test Referrer');
insert into establishments (id, partner_id, name) values
  ('88980000-0000-4000-8000-000000000011', '88980000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Reconcile'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88980000-0000-4000-8000-000000000021', '88980000-0000-4000-8000-000000000001',
   '88980000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Reconcile'), 100000, true, 'reconcile-activity'),
  ('88980000-0000-4000-8000-000000000022', '88980000-0000-4000-8000-000000000001',
   '88980000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Casa Reconcile'), 100000, true, 'reconcile-lodging');
insert into auth.users (id, email) values
  ('88980000-0000-4000-8000-000000000031', 'reconcile-admin@test.local'),
  ('88980000-0000-4000-8000-000000000032', 'reconcile-buyer@test.local'),
  ('e0000000-0000-4000-8000-000000000001', 'reserva-manual@hifago.local')
on conflict (id) do nothing;
insert into partner_capabilities (account_id, role, source, status)
values ('88980000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status)
values ('88980000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');

-- Capacités : une activité (date simple), un créneau, une plage de nuits, une ressource partagée.
insert into product_availability (product_id, date, capacity, booked) values
  ('88980000-0000-4000-8000-000000000021', '2028-11-01', 5, 3),
  ('88980000-0000-4000-8000-000000000021', '2028-11-02', 5, 1),
  ('88980000-0000-4000-8000-000000000021', '2028-11-03', 5, 1),
  ('88980000-0000-4000-8000-000000000022', '2028-11-10', 2, 1),
  ('88980000-0000-4000-8000-000000000022', '2028-11-11', 2, 1),
  ('88980000-0000-4000-8000-000000000022', '2028-11-12', 2, 0);
insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
values ('88980000-0000-4000-8000-000000000021', '2028-11-05', '09:00', 60, 4, 2);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88980000-0000-4000-8000-000000000011', '2028-11-01', 1, 1),
  ('88980000-0000-4000-8000-000000000011', '2028-11-02', 1, 1);

-- Gabarit de commande : une ligne réservée à acompte dû (17 000) sur l'activité du 2028-11-01,
-- sauf mention contraire. `make_order(id, suffix_ligne, payment_status, age, line_status, date)`.
create function test_make_order(
  p_order uuid, p_line uuid, p_payment_status text, p_age interval, p_line_status text default 'reserved',
  p_date date default '2028-11-01', p_product uuid default '88980000-0000-4000-8000-000000000021',
  p_end_date date default null, p_slot time default null, p_commission text default 'direct',
  p_acompte bigint default 17000
) returns void language plpgsql as $$
begin
  insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
  values (p_order, (case when p_commission = 'operator_manual' then 'e0000000-0000-4000-8000-000000000001' else '88980000-0000-4000-8000-000000000032' end)::uuid,
          'Holder ' || p_order, 'holder-' || left(p_order::text, 8) || '@test.local', p_payment_status, now() - p_age);
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, slot_start_time, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, referrer_partner_id
  ) values (
    p_line, p_order, (case when p_commission = 'operator_manual' then 'e0000000-0000-4000-8000-000000000001' else '88980000-0000-4000-8000-000000000032' end)::uuid,
    p_product, p_date, p_end_date, p_slot, 1, p_line_status, 'Holder',
    100000, 100000, p_commission, case when p_acompte > 0 then 0.17 else 0 end, 0, case when p_acompte > 0 then 0.17 else 0 end,
    p_acompte, 0, p_acompte, (case when p_commission = 'external_referrer' then '88980000-0000-4000-8000-000000000002' end)::uuid
  );
end; $$;

-- Un paiement MP tel que l'Edge Function l'aplatit depuis GET /v1/payments/search.
create function test_mp(p_payment uuid, p_mp_id text, p_status text, p_amount numeric, p_created text default '2026-09-21T10:00:00Z')
returns jsonb language sql as $$
  select jsonb_build_object('payment_id', p_payment, 'mp_payment_id', p_mp_id, 'status', p_status,
    'status_detail', case when p_status = 'approved' then 'accredited' else p_status end,
    'transaction_amount', p_amount, 'date_created', p_created, 'date_approved', case when p_status = 'approved' then p_created end,
    'collector_id', 'coll-1');
$$;

-- Commandes ----------------------------------------------------------------------------------
-- A1 payée et vieille · A2 impayée sans intent 10 min · A3 impayée sans intent 31 min ·
-- A4 pending 3 min · A5 sans ligne vivante + paiement pending · A6 walk-in 31 min.
select test_make_order('88980000-0000-4000-8000-0000000000a1', '88980000-0000-4000-8000-0000000000b1', 'paid', interval '40 minutes');
select test_make_order('88980000-0000-4000-8000-0000000000a2', '88980000-0000-4000-8000-0000000000b2', 'unpaid', interval '10 minutes');
select test_make_order('88980000-0000-4000-8000-0000000000a3', '88980000-0000-4000-8000-0000000000b3', 'unpaid', interval '35 minutes');
select test_make_order('88980000-0000-4000-8000-0000000000a4', '88980000-0000-4000-8000-0000000000b4', 'pending', interval '3 minutes');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000c4', '88980000-0000-4000-8000-0000000000a4', 'pending', 17000);
select test_make_order('88980000-0000-4000-8000-0000000000a5', '88980000-0000-4000-8000-0000000000b5', 'pending', interval '5 minutes', 'cancelled_by_client');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000c5', '88980000-0000-4000-8000-0000000000a5', 'pending', 17000);
select test_make_order('88980000-0000-4000-8000-0000000000a6', '88980000-0000-4000-8000-0000000000b6', 'unpaid', interval '31 minutes', 'reserved', '2028-11-01', '88980000-0000-4000-8000-000000000021', null, null, 'operator_manual', 0);

------------------------------------------------------------------------------------------------
-- A. claim_orders_to_reconcile
------------------------------------------------------------------------------------------------
create temp table claimed as select * from claim_orders_to_reconcile(50);

select is((select count(*)::int from claimed where order_id = '88980000-0000-4000-8000-0000000000a1'), 0,
  'A1 : une commande payée n''est jamais réclamée');
select is((select count(*)::int from claimed where order_id = '88980000-0000-4000-8000-0000000000a2'), 0,
  'A2 : impayée sans aucun payments, 10 min → pas encore (aucune préférence, rien à demander à MP)');
select is((select count(*)::int from claimed where order_id = '88980000-0000-4000-8000-0000000000a3'), 1,
  'A3 : impayée sans payments, 35 min → réclamée (expiration directe à suivre)');
select is((select count(*)::int from claimed where order_id = '88980000-0000-4000-8000-0000000000a4'), 1,
  'A4 : pending depuis 3 min → réclamée dès 2 min (confirmation sans retour client)');
select is((select count(*)::int from claimed where order_id = '88980000-0000-4000-8000-0000000000a5'), 1,
  'A5 : aucune ligne vivante mais un paiement pending → réclamée (attaque retenue de la revue)');
select is((select count(*)::int from claimed where order_id = '88980000-0000-4000-8000-0000000000a6'), 0,
  'A6 : walk-in (operator_manual, acompte 0, sans payments) → jamais réclamé');
select is((select claimed_at from claimed where order_id = '88980000-0000-4000-8000-0000000000a4'),
  (select reconcile_claimed_at from orders where id = '88980000-0000-4000-8000-0000000000a4'),
  'A7 : claimed_at renvoyé = reconcile_claimed_at posé (horodatage de contrôle venu de la base)');
select is((select count(*)::int from claim_orders_to_reconcile(50) where order_id = '88980000-0000-4000-8000-0000000000a4'), 0,
  'A8 : pas de re-claim sous 2 minutes');
select is((select payments -> 0 ->> 'id' from claimed where order_id = '88980000-0000-4000-8000-0000000000a4'),
  '88980000-0000-4000-8000-0000000000c4',
  'A9 : le claim porte les payments de la commande (id, statut, montant…)');

------------------------------------------------------------------------------------------------
-- B. reconcile_order — la décision
------------------------------------------------------------------------------------------------
-- B1 : approuvé au bon montant → appliqué, commande payée, e-mail client.
select test_make_order('88980000-0000-4000-8000-0000000000a7', '88980000-0000-4000-8000-0000000000b7', 'pending', interval '5 minutes');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000c7', '88980000-0000-4000-8000-0000000000a7', 'pending', 17000);
select is((select reconcile_order('88980000-0000-4000-8000-0000000000a7',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000c7', 'mp-b1', 'approved', 17000)), now(), 'coll-1') ->> 'action'),
  'applied', 'B1a : approved au bon montant → applied');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000a7'), 'paid', 'B1b : commande paid sans aucun retour client');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000c7'), 'approved', 'B1c : paiement approved, mp_last_status écrit');
select is((select mp_last_status from payments where id = '88980000-0000-4000-8000-0000000000c7'), 'approved', 'B1d : mp_last_status = approved');
select is((select count(*)::int from notification_emails where event_type = 'client_order_confirmed' and related_id = '88980000-0000-4000-8000-0000000000a7'), 1,
  'B1e : un e-mail « reserva confirmada »');

-- B2 : approuvé au MAUVAIS montant, 31 min → entrée amount_mismatch + expiration + place rendue.
select test_make_order('88980000-0000-4000-8000-0000000000a8', '88980000-0000-4000-8000-0000000000b8', 'pending', interval '33 minutes', 'reserved', '2028-11-02');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000c8', '88980000-0000-4000-8000-0000000000a8', 'pending', 17000);
select is((select reconcile_order('88980000-0000-4000-8000-0000000000a8',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000c8', 'mp-b2', 'approved', 9999)), now(), 'coll-1') ->> 'action'),
  'expired', 'B2a : mauvais montant → jamais appliqué, commande expirée (rien d''honorable)');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-b2'), 'amount_mismatch', 'B2b : entrée refund_required / amount_mismatch');
select is((select mp_payment_id from payments where id = '88980000-0000-4000-8000-0000000000c8'), 'mp-b2', 'B2c : mp_payment_id conservé (de quoi rembourser)');
select is((select booked from product_availability where product_id = '88980000-0000-4000-8000-000000000021' and date = '2028-11-02'), 0,
  'B2d : D1-bis — la place est rendue à l''expiration (booked 1 → 0)');
select is((select status from order_lines where id = '88980000-0000-4000-8000-0000000000b8'), 'expired', 'B2e : ligne expired');

-- B3 : deux approved sur la MÊME external_reference → un paid, un double_payment.
select test_make_order('88980000-0000-4000-8000-0000000000a9', '88980000-0000-4000-8000-0000000000b9', 'pending', interval '5 minutes');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000c9', '88980000-0000-4000-8000-0000000000a9', 'pending', 17000);
select is((select reconcile_order('88980000-0000-4000-8000-0000000000a9',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000c9', 'mp-b3-1', 'approved', 17000, '2026-09-21T10:00:00Z'),
                    test_mp('88980000-0000-4000-8000-0000000000c9', 'mp-b3-2', 'approved', 17000, '2026-09-21T10:05:00Z')), now(), 'coll-1') ->> 'action'),
  'applied', 'B3a : deux approved → applied');
select is((select mp_payment_id from payments where id = '88980000-0000-4000-8000-0000000000c9'), 'mp-b3-1', 'B3b : le plus ancien paie la commande');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-b3-2'), 'double_payment', 'B3c : le second → double_payment (même external_reference)');
select is((select count(*)::int from notification_emails where event_type = 'client_order_confirmed' and related_id = '88980000-0000-4000-8000-0000000000a9'), 1,
  'B3d : un seul e-mail de confirmation');

-- B4/B5 : pending chez MP — sous 2 h on attend, au-delà on annule chez MP puis on expire.
select test_make_order('88980000-0000-4000-8000-0000000000aa', '88980000-0000-4000-8000-0000000000ba', 'pending', interval '10 minutes');
insert into payments (id, order_id, status, amount_cop, created_at) values ('88980000-0000-4000-8000-0000000000ca', '88980000-0000-4000-8000-0000000000aa', 'pending', 17000, now() - interval '10 minutes');
select is((select reconcile_order('88980000-0000-4000-8000-0000000000aa',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000ca', 'mp-b4', 'pending', 17000)), now(), 'coll-1') ->> 'action'),
  'kept_pending', 'B4 : PSE en attente depuis 10 min → on attend (plafond 2 h)');
-- 2 h 10 : au-delà du plafond D2 (2 h) mais sous la borne d'expiration forcée (2 h 30) — c'est la
-- fenêtre où l'annulation MP est tentée et où l'expiration attend son résultat.
select test_make_order('88980000-0000-4000-8000-0000000000ab', '88980000-0000-4000-8000-0000000000bb', 'pending', interval '2 hours 10 minutes', 'reserved', '2028-11-03');
insert into payments (id, order_id, status, amount_cop, created_at) values ('88980000-0000-4000-8000-0000000000cb', '88980000-0000-4000-8000-0000000000ab', 'pending', 17000, now() - interval '2 hours 10 minutes');
select is((select reconcile_order('88980000-0000-4000-8000-0000000000ab',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000cb', 'mp-b5', 'pending', 17000, '2026-09-21T07:00:00Z')), now(), 'coll-1')),
  jsonb_build_object('action', 'cancel_at_mp', 'mp_cancel_ids', jsonb_build_array('mp-b5')),
  'B5a : PSE en attente depuis 2 h 10 → cancel_at_mp avec l''id MP');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000ab', now()) ->> 'reason'), 'mp_pending',
  'B5b : tant que MP dit pending et que l''annulation n''a pas été tentée 3 fois, on n''expire pas');
select mark_mp_cancel_attempt('88980000-0000-4000-8000-0000000000cb', 'cancelled');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000ab', now()) ->> 'ok'), 'true',
  'B5c : annulation MP confirmée par le re-GET → expiration');
select is((select booked from product_availability where product_id = '88980000-0000-4000-8000-000000000021' and date = '2028-11-03'), 0,
  'B5d : place rendue');

-- B6 : rien chez MP, 33 min, ligne référée + blocage de ressource partagée (FAIT, pas drapeau).
select test_make_order('88980000-0000-4000-8000-0000000000ac', '88980000-0000-4000-8000-0000000000bc', 'pending', interval '33 minutes', 'reserved', '2028-11-01', '88980000-0000-4000-8000-000000000021', null, null, 'external_referrer');
update order_lines set referrer_commission_cop = 10000 where id = '88980000-0000-4000-8000-0000000000bc';
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
values ('88980000-0000-4000-8000-0000000000d1', '88980000-0000-4000-8000-0000000000bc', 'referrer', '88980000-0000-4000-8000-000000000002', 'referral_earned', 10000, 'estimated');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000cc', '88980000-0000-4000-8000-0000000000ac', 'pending', 17000);
insert into availability_blocks (establishment_id, start_date, end_date, source_order_line_id)
values ('88980000-0000-4000-8000-000000000011', '2028-11-01', '2028-11-02', '88980000-0000-4000-8000-0000000000bc');
select is((select reconcile_order('88980000-0000-4000-8000-0000000000ac', '[]'::jsonb, now(), 'coll-1') ->> 'action'), 'expired',
  'B6a : rien chez MP après 30 min + marge → expirée');
select is((select mp_last_status from payments where id = '88980000-0000-4000-8000-0000000000cc'), 'none', 'B6b : mp_last_status = none (MP n''a rien renvoyé)');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000cc'), 'cancelled', 'B6c : paiement pending → cancelled');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000ac'), 'unpaid', 'B6d : commande unpaid');
select is((select status from ledger_entries where id = '88980000-0000-4000-8000-0000000000d1'), 'void', 'B6e : créance référent estimated → void');
select is((select booked from product_availability where product_id = '88980000-0000-4000-8000-000000000021' and date = '2028-11-01'), 2,
  'B6f : place rendue sur la date simple (3 → 2)');
select is((select count(*)::int from availability_blocks where source_order_line_id = '88980000-0000-4000-8000-0000000000bc'), 0,
  'B6g : le blocage d''agenda de la ligne est retiré (fait, pas drapeau produit : la ligne est une activité)');
select is((select booked from provider_resource_calendar where establishment_id = '88980000-0000-4000-8000-000000000011' and slot_date = '2028-11-02'), 0,
  'B6h : ressource partagée rendue sur toute la plage du blocage');

-- B7 : rien chez MP, 10 min → kept.
select test_make_order('88980000-0000-4000-8000-0000000000ad', '88980000-0000-4000-8000-0000000000bd', 'pending', interval '10 minutes');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000cd', '88980000-0000-4000-8000-0000000000ad', 'pending', 17000);
select is((select reconcile_order('88980000-0000-4000-8000-0000000000ad', '[]'::jsonb, now(), 'coll-1') ->> 'action'), 'kept',
  'B7 : rien chez MP à 10 min → on garde (le client est peut-être encore dans Checkout Pro)');

-- B8 : identité du token — un autre compte MP ne peut RIEN décider.
select test_make_order('88980000-0000-4000-8000-0000000000ae', '88980000-0000-4000-8000-0000000000be', 'pending', interval '40 minutes');
insert into payments (id, order_id, status, amount_cop, mp_collector_id) values ('88980000-0000-4000-8000-0000000000ce', '88980000-0000-4000-8000-0000000000ae', 'pending', 17000, 'coll-1');
select is((select reconcile_order('88980000-0000-4000-8000-0000000000ae', '[]'::jsonb, now(), 'coll-AUTRE') ->> 'action'), 'identity_mismatch',
  'B8a : token d''un autre compte → identity_mismatch, jamais une expiration sur une recherche vide');
select is((select status from order_lines where id = '88980000-0000-4000-8000-0000000000be'), 'reserved', 'B8b : rien n''a bougé');

-- B9/B10 : plus aucune ligne vivante (Order A5) — approuvé → refund_required ; pending → fermeture.
select is((select reconcile_order('88980000-0000-4000-8000-0000000000a5',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000c5', 'mp-b9', 'approved', 17000)), now(), 'coll-1') ->> 'action'),
  'closed', 'B9a : commande annulée par le client, paiement approuvé → closed');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-b9'), 'paid_after_expiry', 'B9b : entrée refund_required');
select is((select failure_reason from payment_reconciliation_entries where mp_payment_id = 'mp-b9'), 'paiement approuvé après annulation par le client', 'B9c : motif « annulation client »');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000c5'), 'cancelled', 'B9d : le paiement local est fermé (plus jamais réclamé)');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000a5'), 'unpaid', 'B9e : orders.payment_status unpaid — plus jamais « estamos confirmando »');
select test_make_order('88980000-0000-4000-8000-0000000000af', '88980000-0000-4000-8000-0000000000bf', 'pending', interval '5 minutes', 'cancelled_by_client');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000cf', '88980000-0000-4000-8000-0000000000af', 'pending', 17000);
select is((select reconcile_order('88980000-0000-4000-8000-0000000000af',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000cf', 'mp-b10', 'pending', 17000)), now(), 'coll-1')),
  jsonb_build_object('action', 'closed', 'refund_flagged', false, 'mp_cancel_ids', jsonb_build_array('mp-b10')),
  'B10 : plus rien à honorer + pending chez MP → fermée localement, annulation MP demandée sans délai');

-- B11 : aucun payments, 31 min → expiration directe (aucune préférence n'a jamais existé).
select is((select reconcile_order('88980000-0000-4000-8000-0000000000a3', '[]'::jsonb, now(), 'coll-1') ->> 'action'), 'expired',
  'B11 : sans aucun payments après 30 min + marge → expirée sans demander à MP');

------------------------------------------------------------------------------------------------
-- C. expire_payment_order — les gardes
------------------------------------------------------------------------------------------------
select test_make_order('88980000-0000-4000-8000-0000000000b0', '88980000-0000-4000-8000-0000000000e0', 'pending', interval '40 minutes');
insert into payments (id, order_id, status, amount_cop, created_at) values ('88980000-0000-4000-8000-0000000000f0', '88980000-0000-4000-8000-0000000000b0', 'pending', 17000, now() - interval '40 minutes');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000b0', now() - interval '3 minutes') ->> 'reason'), 'stale_check',
  'C1 : une réponse MP de plus de 2 min ne justifie jamais une expiration');
update payments set mp_last_status = 'approved' where id = '88980000-0000-4000-8000-0000000000f0';
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000b0', now(), true) ->> 'reason'), 'mp_approved',
  'C2 : un paiement que MP dit approuvé n''est JAMAIS expiré, même forcé');
update payments set mp_last_status = 'pending' where id = '88980000-0000-4000-8000-0000000000f0';
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000b0', now()) ->> 'reason'), 'mp_pending', 'C3a : pending sous borne → refusé');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000b0', now(), true) ->> 'ok'), 'true', 'C3b : p_force passe outre la borne pending');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000a1', now()) ->> 'reason'), 'not_candidate', 'C4a : commande payée → not_candidate');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000a2', now()) ->> 'reason'), 'not_candidate', 'C4b : 10 min → not_candidate (plancher 30 min)');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000a6', now()) ->> 'reason'), 'not_candidate', 'C5 : walk-in → not_candidate');

-- D/E : créneau et plage de nuits rendus.
select test_make_order('88980000-0000-4000-8000-0000000000b2', '88980000-0000-4000-8000-0000000000e2', 'unpaid', interval '40 minutes', 'reserved', '2028-11-05', '88980000-0000-4000-8000-000000000021', null, '09:00');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000b2', now()) ->> 'ok'), 'true', 'D1 : créneau expiré');
select is((select booked from product_slot_availability where product_id = '88980000-0000-4000-8000-000000000021' and slot_date = '2028-11-05'), 1, 'D2 : place de créneau rendue (2 → 1)');
select test_make_order('88980000-0000-4000-8000-0000000000b3', '88980000-0000-4000-8000-0000000000e3', 'unpaid', interval '40 minutes', 'reserved', '2028-11-10', '88980000-0000-4000-8000-000000000022', '2028-11-12');
select is((select expire_payment_order('88980000-0000-4000-8000-0000000000b3', now()) ->> 'ok'), 'true', 'E1 : plage expirée');
select is((select array_agg(booked order by date) from product_availability where product_id = '88980000-0000-4000-8000-000000000022'), array[0, 0, 0],
  'E2 : les deux nuits de la plage rendues, la nuit de sortie intacte');

------------------------------------------------------------------------------------------------
-- F. refunded / charged_back — jamais une rétrogradation à unpaid
------------------------------------------------------------------------------------------------
set local role service_role;
select is((select apply_payment_webhook('mp-b1', '88980000-0000-4000-8000-0000000000c7'::uuid, 'refunded', '{}'::jsonb) ->> 'reason'), 'refunded',
  'F1a : refunded externe sur le paiement qui a payé → appliqué');
reset role;
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000c7'), 'refunded', 'F1b : payments refunded');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000a7'), 'refunded', 'F1c : orders refunded — jamais unpaid');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-b1'), 'refunded_externally', 'F1d : entrée refunded_externally pour l''admin');
set local role service_role;
select is((select apply_payment_webhook('mp-b1', '88980000-0000-4000-8000-0000000000c7'::uuid, 'refunded', '{}'::jsonb) ->> 'reason'), 'already_refunded', 'F2a : rejeu → already_refunded');
reset role;
select is((select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'mp-b1'), 1, 'F2b : toujours une seule entrée');
set local role service_role;
select is((select apply_payment_webhook('mp-b3-1', '88980000-0000-4000-8000-0000000000c9'::uuid, 'charged_back', '{}'::jsonb) ->> 'reason'), 'charged_back', 'F3a : contracargo → appliqué');
reset role;
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000c9'), 'charged_back', 'F3b : payments charged_back (distinct d''un remboursement)');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-b3-1'), 'charged_back', 'F3c : entrée charged_back');
-- F6 : trouvé en relecture de la PR #2 (20260922170000) — un « refunded » vu directement par
-- reconcile_order (webhook jamais reçu, ni l'approbation ni le remboursement) devait jusqu'ici
-- rester invisible : la boucle ne routait vers apply_payment_webhook_checked que le statut
-- 'approved'. Le montant MP (17000) est identique à l'acompte attendu : si le statut réel n'était
-- PAS transmis (régression du passage à un statut dynamique), ce paiement serait pris pour un
-- 'approved' et la commande passerait payée à tort — F6b/F6c le détecteraient.
select test_make_order('88980000-0000-4000-8000-0000000000f1', '88980000-0000-4000-8000-0000000000f2', 'pending', interval '10 minutes');
insert into payments (id, order_id, status, amount_cop) values ('88980000-0000-4000-8000-0000000000f3', '88980000-0000-4000-8000-0000000000f1', 'pending', 17000);
select is((select reconcile_order('88980000-0000-4000-8000-0000000000f1',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000f3', 'mp-f6', 'refunded', 17000)), now(), 'coll-1') ->> 'action'),
  'kept', 'F6a : refunded jamais approuvé localement → aucune promotion à payée, on garde');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000f1'), 'pending', 'F6b : commande jamais passée payée sur un refunded');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000f3'), 'pending', 'F6c : paiement local inchangé (jamais approved)');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-f6'), 'refunded_externally',
  'F6d : entrée refunded_externally créée — invisible avant 20260922170000');
-- F7 : même trou côté surveillance 48h (record_mp_payment_status). Paiement local déjà cancelled
-- (jamais vu approved), MP répond directement charged_back.
select test_make_order('88980000-0000-4000-8000-0000000000f4', '88980000-0000-4000-8000-0000000000f5', 'unpaid', interval '50 hours', 'expired');
insert into payments (id, order_id, status, amount_cop, mp_collector_id) values ('88980000-0000-4000-8000-0000000000f6', '88980000-0000-4000-8000-0000000000f4', 'cancelled', 17000, 'coll-1');
select is((select record_mp_payment_status('88980000-0000-4000-8000-0000000000f6',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000f6', 'mp-f7', 'charged_back', 17000)), now(), 'coll-1') ->> 'reason'),
  'charged_back', 'F7a : contracargo vu en surveillance 48h → appliqué (jusqu''ici jamais atteint)');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000f6'), 'cancelled', 'F7b : paiement local inchangé (jamais approved)');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-f7'), 'charged_back', 'F7c : entrée charged_back créée par le chemin de surveillance');
select is((select mp_last_status from payments where id = '88980000-0000-4000-8000-0000000000f6'), 'charged_back', 'F7d : mp_last_status posé malgré le passage par la branche refunded/charged_back');
-- F8 : identité du token côté surveillance 48h — absente avant 20260922170000 (asymétrie avec B8).
select test_make_order('88980000-0000-4000-8000-0000000000f7', '88980000-0000-4000-8000-0000000000f8', 'unpaid', interval '50 hours', 'expired');
insert into payments (id, order_id, status, amount_cop, mp_collector_id) values ('88980000-0000-4000-8000-0000000000f9', '88980000-0000-4000-8000-0000000000f7', 'cancelled', 17000, 'coll-1');
select is((select record_mp_payment_status('88980000-0000-4000-8000-0000000000f9', '[]'::jsonb, now(), 'coll-AUTRE') ->> 'action'), 'identity_mismatch',
  'F8a : token d''un autre compte → identity_mismatch, symétrique à B8 pour ce chemin');
select is((select mp_last_status from payments where id = '88980000-0000-4000-8000-0000000000f9'), null, 'F8b : rien n''a bougé (aucun statut posé)');
-- F4 : NOTRE remboursement (payment_refunds vivant) ne produit ni entrée ni changement ici.
insert into payment_reconciliation_entries (id, payment_id, mp_payment_id, raw_event, failure_reason, kind, reason_code)
values ('88980000-0000-4000-8000-0000000000d2', '88980000-0000-4000-8000-0000000000c8', 'mp-f4', '{}'::jsonb, 'test', 'refund_required', 'paid_after_expiry');
insert into payment_refunds (entry_id, payment_id, mp_payment_id, amount_cop, status)
values ('88980000-0000-4000-8000-0000000000d2', '88980000-0000-4000-8000-0000000000c8', 'mp-f4', 17000, 'pending');
set local role service_role;
select is((select apply_payment_webhook('mp-f4', '88980000-0000-4000-8000-0000000000c8'::uuid, 'refunded', '{}'::jsonb) ->> 'reason'), 'own_refund', 'F4a : notre remboursement → own_refund');
reset role;
select is((select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'mp-f4' and kind = 'refunded_externally'), 0, 'F4b : aucune entrée « externe » pour notre propre remboursement');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000c8'), 'cancelled', 'F4c : le paiement (cancelled par l''expiration) ne bouge pas');
-- F5 : refunded sur un paiement qui n'a PAS payé la commande (double paiement mp-b3-2 remboursé dans le panel).
set local role service_role;
select is((select apply_payment_webhook('mp-b3-2', '88980000-0000-4000-8000-0000000000c9'::uuid, 'refunded', '{}'::jsonb) ->> 'reason'), 'already_refunded',
  'F5 : le paiement local est déjà charged_back → no-op (le doublon remboursé n''a jamais été le payeur)');
reset role;

------------------------------------------------------------------------------------------------
-- G. record_mp_payment_status / claim_payments_to_watch — surveillance après expiration
------------------------------------------------------------------------------------------------
-- Order B6 (ac) est expirée, son paiement cc est cancelled avec mp_last_status 'none' et une
-- commande de 33 min : encore surveillé (< 1 h) dès que 10 min ont passé depuis la dernière
-- vérification. Un virement approuvé arrive → refund_required.
update payments set mp_last_checked_at = now() - interval '11 minutes' where id = '88980000-0000-4000-8000-0000000000cc';
select is((select count(*)::int from claim_payments_to_watch(50) where payment_id = '88980000-0000-4000-8000-0000000000cc'), 1,
  'G1 : un paiement annulé dont MP n''a rien dit reste surveillé');
select is((select record_mp_payment_status('88980000-0000-4000-8000-0000000000cc',
  jsonb_build_array(test_mp('88980000-0000-4000-8000-0000000000cc', 'mp-g1', 'approved', 17000)), now(), 'coll-1') ->> 'reason'),
  'paid_after_expiry', 'G2a : approuvé après expiration → la garde du Lot A décide : paid_after_expiry');
select is((select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), 'paid_after_expiry', 'G2b : entrée refund_required');
select is((select status from order_lines where id = '88980000-0000-4000-8000-0000000000bc'), 'expired', 'G2c : la ligne reste expirée — jamais ressuscitée par un UPDATE direct');
select is((select mp_last_status from payments where id = '88980000-0000-4000-8000-0000000000cc'), 'approved', 'G2d : mp_last_status approved (terminal, plus surveillé)');
select is((select count(*)::int from claim_payments_to_watch(50) where payment_id = '88980000-0000-4000-8000-0000000000cc'), 0,
  'G3 : statut terminal → plus jamais réclamé');

------------------------------------------------------------------------------------------------
-- H. Drapeaux de capacité gelés tant qu'une ligne est réservée
------------------------------------------------------------------------------------------------
select throws_ok(
  $$ update products set evento_occupies_resource = not evento_occupies_resource where id = '88980000-0000-4000-8000-000000000021' $$,
  'P0001', 'capacity_flags_frozen_while_reserved',
  'H1 : un produit portant une ligne reserved ne change pas ses drapeaux de capacité');
select lives_ok(
  $$ update products set lobby_category_id = 4242 where id = '88980000-0000-4000-8000-000000000022' $$,
  'H2 : sans ligne reserved (toutes expirées), le drapeau se modifie');

------------------------------------------------------------------------------------------------
-- I. heartbeat + watchdog
------------------------------------------------------------------------------------------------
-- Isolé de l'environnement : seuls les admins de CE fichier reçoivent l'alerte (une base de dev
-- porte d'autres admins, et notify_all_admins joint auth.users) — suspension dans la transaction.
update partner_capabilities set status = 'suspended'
 where role = 'admin' and account_id <> '88980000-0000-4000-8000-000000000031';
-- Sur une base de dev, le VRAI cron payments-reconcile-watchdog a pu déjà alerter (alerted_at posé,
-- e-mails présents) : on repart d'un heartbeat vierge et on compte en delta.
update job_heartbeats set last_run_at = null, last_ok_at = null, last_error = null, alerted_at = null, created_at = now()
 where job_name = 'payments-reconcile';
create temp table stalled_before as
  select count(*)::int as n from notification_emails where event_type = 'admin_job_stalled';
select heartbeat_job('payments-reconcile', false, '{}'::jsonb, 'mp_unreachable');
select is((select last_ok_at from job_heartbeats where job_name = 'payments-reconcile'), null, 'I1 : un run en échec ne pose pas last_ok_at');
select is((select last_error from job_heartbeats where job_name = 'payments-reconcile'), 'mp_unreachable', 'I2 : last_error conservé');
update job_heartbeats set created_at = now() - interval '20 minutes' where job_name = 'payments-reconcile';
select payments_reconcile_watchdog();
select is((select count(*)::int from notification_emails where event_type = 'admin_job_stalled') - (select n from stalled_before),
  1,
  'I3 : job muet depuis 15 min → une alerte par admin');
select payments_reconcile_watchdog();
select is((select count(*)::int from notification_emails where event_type = 'admin_job_stalled') - (select n from stalled_before),
  1,
  'I4 : pas de seconde alerte tant que rien ne repart');
select heartbeat_job('payments-reconcile', true, '{"claimed": 3}'::jsonb);
select is((select last_error from job_heartbeats where job_name = 'payments-reconcile'), null, 'I5 : un run réussi efface last_error et pose last_ok_at');
-- Chronologie réelle : alerte il y a 30 min, run réussi il y a 20 min (réarmement), silence depuis.
update job_heartbeats set alerted_at = now() - interval '30 minutes', last_ok_at = now() - interval '20 minutes' where job_name = 'payments-reconcile';
select payments_reconcile_watchdog();
select is((select count(*)::int from notification_emails where event_type = 'admin_job_stalled') - (select n from stalled_before),
  2,
  'I6 : réarmé après un run réussi → nouvelle alerte quand le job se tait à nouveau');

------------------------------------------------------------------------------------------------
-- J. D3 — remboursement (20260922100000) : demande admin, exécution par le job, e-mails client,
--    contrat client. Entrées disponibles : mp-b2 (amount_mismatch, commande a8), mp-b3-2
--    (double_payment, commande a9 payée par mp-b3-1), mp-g1 (paid_after_expiry, commande ac).
------------------------------------------------------------------------------------------------
-- La fixture F4 (entrée + remboursement `pending` sur mp-f4) a servi à prouver own_refund ; elle
-- polluerait les claims et le refund_status de la commande a8 — on la retire ici.
delete from payment_refunds where mp_payment_id = 'mp-f4';
delete from payment_reconciliation_entries where mp_payment_id = 'mp-f4';

-- E-mails client : un par entrée refund_required, texte selon reason_code, jamais deux.
select is((select count(*)::int from notification_emails ne join payment_reconciliation_entries e on e.id = ne.related_id
            where ne.event_type = 'client_payment_received_not_honored' and e.mp_payment_id = 'mp-b2'), 1,
  'J1 : écart de montant → un e-mail « recibimos tu pago, no pudo confirmarse »');
select is((select count(*)::int from notification_emails ne join payment_reconciliation_entries e on e.id = ne.related_id
            where ne.event_type = 'client_duplicate_payment_refund' and e.mp_payment_id = 'mp-b3-2'), 1,
  'J2 : double paiement → un e-mail « pago duplicado » (la réservation EST confirmée)');
select is((select count(*)::int from notification_emails ne where ne.event_type = 'client_payment_received_not_honored'
            and ne.related_id = (select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1')), 1,
  'J3 : payé après expiration → un e-mail client');
select is((select subject from notification_emails ne where ne.event_type = 'client_payment_received_not_honored'
            and ne.related_id = (select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1')),
  'Recibimos tu pago — tu reserva ' || (select reference from orders where id = '88980000-0000-4000-8000-0000000000ac') || ' no pudo confirmarse',
  'J4 : objet avec le numéro de réservation');

-- Contrat client AVANT remboursement.
select is(((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000ac') ->> 'payment_received_not_honored')::boolean, true,
  'J5 : payment_received_not_honored = true tant que l''entrée est ouverte');
select is(((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000a9') ->> 'payment_received_not_honored')::boolean, false,
  'J6 : un double paiement ne marque PAS la commande (elle est honorée)');
select is((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000ac') ->> 'refund_status', null,
  'J7 : refund_status null avant toute demande');

-- Demande admin.
select throws_ok(
  $$ select request_payment_refund((select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), 'x') $$,
  '42501', null, 'J8 : sans session admin → 42501');
select test_login('88980000-0000-4000-8000-000000000031');
select throws_ok(
  $$ select request_payment_refund((select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), '') $$,
  'P0001', 'motif obligatoire pour demander un remboursement', 'J9 : motif obligatoire');
select is((select request_payment_refund((select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), 'Cliente prefiere reembolso') ->> 'ok'), 'true',
  'J10 : admin demande le remboursement → ok');
select throws_ok(
  $$ select request_payment_refund((select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), 'otra vez') $$,
  'P0001', 'un remboursement est déjà en cours ou effectué pour cette entrée', 'J11 : idempotent — pas deux remboursements vivants');
select is((select status from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), 'retrying', 'J12 : l''entrée passe « en cours »');
select is((select mp_payment_id from payment_refunds where entry_id = (select id from payment_reconciliation_entries where mp_payment_id = 'mp-g1')), 'mp-g1',
  'J13 : le remboursement vise le paiement MP de l''ENTRÉE');
select is((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000ac') ->> 'refund_status', 'pending',
  'J14 : refund_status pending côté client');
select test_logout();

-- Exécution par le job.
select is((select count(*)::int from claim_payment_refunds(10) where mp_payment_id = 'mp-g1'), 1, 'J15 : le job réclame le remboursement en attente');
select is((select count(*)::int from claim_payment_refunds(10) where mp_payment_id = 'mp-g1'), 0, 'J16 : bail de 10 min — pas de double réclamation');
select is((select finalize_payment_refund((select id from payment_refunds where mp_payment_id = 'mp-g1'), 'approved', 'refund-777', '{"status":"approved"}'::jsonb) ->> 'reason'), 'approved',
  'J17 : finalize approved');
select is((select status from payment_reconciliation_entries where mp_payment_id = 'mp-g1'), 'resolved', 'J18 : entrée résolue par le job');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000cc'), 'cancelled',
  'J19 : le paiement local (cancelled par l''expiration, jamais le payeur) ne passe PAS refunded');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000ac'), 'unpaid', 'J20 : la commande reste unpaid');
select is(((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000ac') ->> 'payment_received_not_honored')::boolean, false,
  'J21 : entrée résolue → le drapeau client retombe');
select is((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000ac') ->> 'refund_status', 'approved',
  'J22 : refund_status approved → écran « te reembolsamos »');
select is((select finalize_payment_refund((select id from payment_refunds where mp_payment_id = 'mp-g1'), 'approved', 'refund-777', '{}'::jsonb) ->> 'reason'), 'already_finalized',
  'J23 : rejeu de finalize → no-op');

-- Double paiement remboursé : la commande reste PAYÉE.
select test_login('88980000-0000-4000-8000-000000000031');
select is((select request_payment_refund((select id from payment_reconciliation_entries where mp_payment_id = 'mp-b3-2'), 'Doble pago') ->> 'ok'), 'true', 'J24 : demande sur le doublon');
select test_logout();
select is((select count(*)::int from claim_payment_refunds(10) where mp_payment_id = 'mp-b3-2'), 1, 'J25 : réclamé');
select is((select finalize_payment_refund((select id from payment_refunds where mp_payment_id = 'mp-b3-2'), 'approved', 'refund-778') ->> 'reason'), 'approved', 'J26 : remboursé');
select is((select payment_status from orders where id = '88980000-0000-4000-8000-0000000000a9'), 'refunded',
  'J27 : ⚠️ la commande a9 a été passée charged_back en F3 — refunded ici est le statut de F3 conservé, pas une rétrogradation (voir J28)');
select is((select status from payments where id = '88980000-0000-4000-8000-0000000000c9'), 'charged_back',
  'J28 : le paiement payeur (mp-b3-1) garde son statut F3 : le remboursement du doublon mp-b3-2 ne le touche pas');

-- Échec MP → backoff, puis rejet définitif → entrée rouverte.
select test_login('88980000-0000-4000-8000-000000000031');
select is((select request_payment_refund((select id from payment_reconciliation_entries where mp_payment_id = 'mp-b2'), 'Reembolsar écart') ->> 'ok'), 'true', 'J29 : demande sur l''écart de montant');
select test_logout();
select is((select count(*)::int from claim_payment_refunds(10) where mp_payment_id = 'mp-b2'), 1, 'J30 : réclamé');
select fail_payment_refund((select id from payment_refunds where mp_payment_id = 'mp-b2'), 'HTTP 503');
select ok((select next_attempt_at > now() + interval '4 minutes' from payment_refunds where mp_payment_id = 'mp-b2'),
  'J31 : échec réseau → backoff ≥ 5 min, le remboursement reste pending');
select is((select count(*)::int from claim_payment_refunds(10) where mp_payment_id = 'mp-b2'), 0, 'J32 : pas réclamé avant next_attempt_at');
select is((select finalize_payment_refund((select id from payment_refunds where mp_payment_id = 'mp-b2'), 'rejected', null, '{"message":"Payment-too-old-to-be-refunded"}'::jsonb, 'Payment-too-old-to-be-refunded') ->> 'reason'), 'rejected',
  'J33 : refus MP → rejected');
select is((select status from payment_reconciliation_entries where mp_payment_id = 'mp-b2'), 'open', 'J34 : l''entrée revient à l''admin (open)');
select is((select order_for_client_jsonb(o) from orders o where o.id = '88980000-0000-4000-8000-0000000000a8') ->> 'refund_status', 'rejected',
  'J35 : refund_status rejected — le client reste sur « te contactamos »');

select * from finish();
rollback;
