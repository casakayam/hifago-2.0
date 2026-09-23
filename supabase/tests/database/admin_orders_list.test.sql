-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 3/10 :
-- admin_orders_list (20260922190000) remplace la lecture directe de
-- apps/admin/app/admin/orders/page.tsx (liste paginée).
begin;
select plan(5);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('889e0000-0000-4000-8000-000000000001', 'Admin Orders List Test Partner');
insert into establishments (id, partner_id, name) values
  ('889e0000-0000-4000-8000-000000000011', '889e0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Admin Orders List'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('889e0000-0000-4000-8000-000000000021', '889e0000-0000-4000-8000-000000000001',
   '889e0000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Admin Orders List'), 50000, true, 'admin-orders-list-test');

insert into auth.users (id, email) values
  ('889e0000-0000-4000-8000-000000000031', 'aol-admin@test.local'),
  ('889e0000-0000-4000-8000-000000000032', 'aol-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('889e0000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('889e0000-0000-4000-8000-000000000041', '889e0000-0000-4000-8000-000000000032',
   'Zamora Orders List', 'aol-holder@test.local'),
  ('889e0000-0000-4000-8000-000000000042', '889e0000-0000-4000-8000-000000000032',
   'Abarca Orders List', 'aol-holder-2@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('889e0000-0000-4000-8000-000000000051', '889e0000-0000-4000-8000-000000000041',
   '889e0000-0000-4000-8000-000000000032', '889e0000-0000-4000-8000-000000000021',
   '2029-08-30', 1, 'reserved', 'Zamora Orders List',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('889e0000-0000-4000-8000-000000000052', '889e0000-0000-4000-8000-000000000042',
   '889e0000-0000-4000-8000-000000000032', '889e0000-0000-4000-8000-000000000021',
   '2029-08-31', 1, 'fulfilled', 'Abarca Orders List',
   50000, 70000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;

select test_login('889e0000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select * from admin_orders_list() $$,
  '42501'::char(5), null,
  'appel non-admin → exception 42501'
);

select test_login('889e0000-0000-4000-8000-000000000031'); -- admin

select is(
  (select count(*)::int from admin_orders_list()),
  2,
  'admin : voit les deux lignes, aucun filtre'
);
select is(
  (select count(*)::int from admin_orders_list(p_status => 'fulfilled')),
  1,
  'filtre status : une seule ligne fulfilled'
);
select is(
  (select array_agg(holder_name) from admin_orders_list(p_sort_key => 'total_cop', p_sort_desc => false)),
  array['Zamora Orders List', 'Abarca Orders List'],
  'tri total_cop ascendant : 50000 (Zamora) avant 70000 (Abarca)'
);

select is(
  (
    select coalesce(string_agg(a.attname, ', ' order by a.attname), '')
    from pg_proc p
    join pg_type t on t.oid = p.prorettype
    join pg_attribute a on a.attrelid = t.typrelid
    where p.proname = 'admin_orders_list'
      and a.attname in ('referrer_commission_cop', 'app_commission_cop', 'acompte_cop', 'commission_case', 'referrer_partner_id')
  ),
  '',
  'admin_orders_list ne retourne structurellement aucune colonne de commission'
);

select * from finish();
rollback;
