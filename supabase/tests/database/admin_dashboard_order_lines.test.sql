-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 1/10 : les
-- 5 RPC du tableau de bord admin (20260922160000) remplacent les 5 requêtes directes sur
-- order_lines de apps/admin/app/admin/page.tsx.
begin;
select plan(10);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('889b0000-0000-4000-8000-000000000001', 'Dashboard Test Partner');
insert into establishments (id, partner_id, name) values
  ('889b0000-0000-4000-8000-000000000011', '889b0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Dashboard'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('889b0000-0000-4000-8000-000000000021', '889b0000-0000-4000-8000-000000000001',
   '889b0000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Dashboard'), 50000, true, 'dashboard-test');

insert into auth.users (id, email) values
  ('889b0000-0000-4000-8000-000000000031', 'dashboard-admin@test.local'),
  ('889b0000-0000-4000-8000-000000000032', 'dashboard-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('889b0000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('889b0000-0000-4000-8000-000000000041', '889b0000-0000-4000-8000-000000000032',
   'Dashboard Holder', 'dashboard-holder@test.local');
-- Une ligne fulfilled (compte pour revenue/commission/série/volume) + une ligne reserved en retard
-- (statut réaliste d'une réservation en attente — mais `admin_order_lines_pending_action_count`
-- mirrore le filtre status='confirmed' de la page d'origine, qui n'existe plus dans
-- order_lines_status_check depuis 20260814161500 (renommé 'reserved') : elle prouve ci-dessous que
-- le filtre reste fidèlement DEAD, pas silencieusement "corrigé" en reserved — un bug préexistant,
-- hors périmètre de ce chantier de sécurité, signalé séparément.
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, referrer_partner_id
) values
  ('889b0000-0000-4000-8000-000000000051', '889b0000-0000-4000-8000-000000000041',
   '889b0000-0000-4000-8000-000000000032', '889b0000-0000-4000-8000-000000000021',
   '2029-08-15', 1, 'fulfilled', 'Dashboard Holder',
   50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500,
   '889b0000-0000-4000-8000-000000000001'),
  ('889b0000-0000-4000-8000-000000000052', '889b0000-0000-4000-8000-000000000041',
   '889b0000-0000-4000-8000-000000000032', '889b0000-0000-4000-8000-000000000021',
   '2020-01-01', 1, 'reserved', 'Dashboard Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0, null);

set local role authenticated;
select test_login('889b0000-0000-4000-8000-000000000032'); -- buyer, pas admin

select throws_ok($$ select * from admin_order_lines_revenue_rows() $$, '42501'::char(5), null,
  'admin_order_lines_revenue_rows : non-admin refusé');
select throws_ok($$ select * from admin_order_lines_commission_rows() $$, '42501'::char(5), null,
  'admin_order_lines_commission_rows : non-admin refusé');
select throws_ok($$ select * from admin_order_lines_pending_action_count('2029-01-01'::date) $$, '42501'::char(5), null,
  'admin_order_lines_pending_action_count : non-admin refusé');
select throws_ok($$ select * from admin_order_lines_daily_series('2029-01-01'::date) $$, '42501'::char(5), null,
  'admin_order_lines_daily_series : non-admin refusé');
select throws_ok($$ select * from admin_order_lines_volume_by_partner_rows() $$, '42501'::char(5), null,
  'admin_order_lines_volume_by_partner_rows : non-admin refusé');

select test_login('889b0000-0000-4000-8000-000000000031'); -- admin

select is(
  (select sum(total_cop)::bigint from admin_order_lines_revenue_rows()),
  50000::bigint,
  'revenue_rows : seule la ligne fulfilled compte — reserved n''est pas dans TERMINAL_NON_CANCELLED'
);
select is(
  (select jsonb_build_object('referrer_commission_cop', referrer_commission_cop, 'app_commission_cop', app_commission_cop)
     from admin_order_lines_commission_rows()),
  jsonb_build_object('referrer_commission_cop', 5000, 'app_commission_cop', 3500),
  'commission_rows : uniquement la ligne fulfilled'
);
select is(
  (select pending_count from admin_order_lines_pending_action_count('2029-01-01'::date)),
  0::bigint,
  'pending_action_count : filtre status=confirmed fidèlement mirroré — 0 même avec une ligne reserved en retard (bug préexistant, hors périmètre)'
);
select is(
  (select count(*)::int from admin_order_lines_daily_series('2029-08-01'::date)),
  1,
  'daily_series : seule la ligne fulfilled (2029-08-15) tombe dans la fenêtre depuis 2029-08-01'
);
select is(
  (select jsonb_build_object('total_cop', total_cop, 'partner_id', partner_id)
     from admin_order_lines_volume_by_partner_rows()
    where partner_id = '889b0000-0000-4000-8000-000000000001'),
  jsonb_build_object('total_cop', 50000, 'partner_id', '889b0000-0000-4000-8000-000000000001'::uuid),
  'volume_by_partner_rows : volume attribué au partenaire propriétaire de l''établissement (pas au référent)'
);

select * from finish();
rollback;
