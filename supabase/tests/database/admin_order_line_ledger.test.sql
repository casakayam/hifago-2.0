-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 4/10 :
-- admin_order_line_ledger (20260922150000) remplace la lecture directe de
-- apps/admin/app/admin/orders/[id]/page.tsx. SEUL des 10 sites où le besoin de colonnes de
-- commission complètes est réel et légitime (LedgerLinesTable/deriveLedgerEntry) — ce test le
-- prouve positivement (les colonnes SONT là pour l'admin), contrairement aux autres RPC qui
-- prouvent leur absence structurelle.
begin;
select plan(3);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('889a0000-0000-4000-8000-000000000001', 'Order Line Ledger Test Partner');
insert into establishments (id, partner_id, name) values
  ('889a0000-0000-4000-8000-000000000011', '889a0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Order Line Ledger'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('889a0000-0000-4000-8000-000000000021', '889a0000-0000-4000-8000-000000000001',
   '889a0000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Order Line Ledger'), 50000, true, 'order-line-ledger-test');

insert into auth.users (id, email) values
  ('889a0000-0000-4000-8000-000000000031', 'oll-admin@test.local'),
  ('889a0000-0000-4000-8000-000000000032', 'oll-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('889a0000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('889a0000-0000-4000-8000-000000000041', '889a0000-0000-4000-8000-000000000032',
   'Order Line Ledger Holder', 'oll-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '889a0000-0000-4000-8000-000000000051', '889a0000-0000-4000-8000-000000000041',
  '889a0000-0000-4000-8000-000000000032', '889a0000-0000-4000-8000-000000000021',
  '2029-08-10', 1, 'fulfilled', 'Order Line Ledger Holder',
  50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500
);

set local role authenticated;

select test_login('889a0000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select * from admin_order_line_ledger('889a0000-0000-4000-8000-000000000041') $$,
  '42501'::char(5), null,
  'appel non-admin → exception 42501'
);

select test_login('889a0000-0000-4000-8000-000000000031'); -- admin
select is(
  (select jsonb_build_object(
     'total_cop', total_cop, 'acompte_cop', acompte_cop,
     'referrer_commission_cop', referrer_commission_cop, 'app_commission_cop', app_commission_cop,
     'commission_case', commission_case
   ) from admin_order_line_ledger('889a0000-0000-4000-8000-000000000041')),
  jsonb_build_object(
    'total_cop', 50000, 'acompte_cop', 8500,
    'referrer_commission_cop', 5000, 'app_commission_cop', 3500,
    'commission_case', 'external_referrer'
  ),
  'admin : les colonnes de commission complètes sont bien présentes et correctes — seul besoin légitime des 10 sites'
);
select is(
  (select count(*)::int from admin_order_line_ledger('00000000-0000-4000-8000-000000000099')),
  0,
  'commande inexistante → aucune ligne, pas d''exception'
);

select * from finish();
rollback;
