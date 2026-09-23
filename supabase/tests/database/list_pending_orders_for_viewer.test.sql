-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 8/10 :
-- list_pending_orders_for_viewer (20260922120000) remplace la lecture directe de
-- apps/web/lib/orders/getPendingOrdersForViewer.ts. Doit rester utilisable par une session anonyme
-- (guest checkout, spec 31/32) — c'est le seul des 10 sites où c'est un invariant à prouver
-- explicitement, pas juste une garde is_admin/has_capability.
begin;
select plan(6);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_login_anonymous(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', true)::text,
    true
  );
$$;

insert into partners (id, display_name) values
  ('889f0000-0000-4000-8000-000000000001', 'Pending Orders Viewer Test Partner');
insert into establishments (id, partner_id, name) values
  ('889f0000-0000-4000-8000-000000000011', '889f0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Pending Orders Viewer'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('889f0000-0000-4000-8000-000000000021', '889f0000-0000-4000-8000-000000000001',
   '889f0000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Pending Orders Viewer'), 50000, true, 'pending-orders-viewer-test');

-- Une identité anonyme (le cas d'usage réel de ce module) et un compte authentifié classique, pour
-- prouver que le scope account_id = auth.uid() fonctionne identiquement pour les deux.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('889f0000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now(), now());
insert into auth.users (id, email) values
  ('889f0000-0000-4000-8000-000000000032', 'pending-orders-viewer-other@test.local');

insert into orders (id, account_id, holder_name, holder_email, reference, access_token, payment_status) values
  ('889f0000-0000-4000-8000-000000000041', '889f0000-0000-4000-8000-000000000031',
   'Pending Orders Viewer Holder', 'pov-holder@test.local', 'HFG-POV001', 'pov-token-001', 'unpaid'),
  -- Commande déjà payée du MÊME compte : ne doit jamais remonter (payment_status hors de la
  -- liste unsettled).
  ('889f0000-0000-4000-8000-000000000042', '889f0000-0000-4000-8000-000000000031',
   'Pending Orders Viewer Holder', 'pov-holder@test.local', 'HFG-POV002', 'pov-token-002', 'paid'),
  -- Commande d'un AUTRE compte, unpaid : ne doit jamais remonter pour l'identité anonyme.
  ('889f0000-0000-4000-8000-000000000043', '889f0000-0000-4000-8000-000000000032',
   'Other Holder', 'pov-other@test.local', 'HFG-POV003', 'pov-token-003', 'unpaid');

insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('889f0000-0000-4000-8000-000000000051', '889f0000-0000-4000-8000-000000000041',
   '889f0000-0000-4000-8000-000000000031', '889f0000-0000-4000-8000-000000000021',
   '2029-09-01', 1, 'reserved', 'Pending Orders Viewer Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;

-- Aucune session (jamais de JWT claims posé) → aucune ligne, jamais une exception.
select is(
  (select count(*)::int from list_pending_orders_for_viewer()),
  0,
  'sans session → aucune ligne'
);

select test_login_anonymous('889f0000-0000-4000-8000-000000000031');
select is(
  (select count(*)::int from list_pending_orders_for_viewer()),
  1,
  'session ANONYME : voit sa commande unpaid — l''invariant central de cette RPC'
);
select is(
  (select jsonb_build_object('reference', reference, 'access_token', access_token)
     from list_pending_orders_for_viewer()),
  jsonb_build_object('reference', 'HFG-POV001', 'access_token', 'pov-token-001'),
  'colonnes attendues, correctes'
);
select is(
  (select line_statuses from list_pending_orders_for_viewer()),
  array['reserved'],
  'line_statuses porte le statut brut de la ligne (isDeadLine reste appliqué côté TS)'
);

select test_login('889f0000-0000-4000-8000-000000000032'); -- l'autre compte, authenticated normal
select is(
  (select reference from list_pending_orders_for_viewer()),
  'HFG-POV003',
  'l''autre compte voit SA propre commande (003), jamais celle de l''identité anonyme (001) — account_id scope, pas de fuite croisée'
);

select is(
  array[
    has_function_privilege('anon', 'public.list_pending_orders_for_viewer()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.list_pending_orders_for_viewer()', 'EXECUTE')
  ],
  array[true, true],
  'anon ET authenticated peuvent l''exécuter — une session anonyme Supabase authentifie comme authenticated, mais le grant anon reste posé comme create_order/create_payment_intent'
);

select * from finish();
rollback;
