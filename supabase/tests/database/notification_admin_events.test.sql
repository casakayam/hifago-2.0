-- Spec 23 Tranche 1 — triggers AFTER INSERT "nouvelle proposition à modérer"
-- (notify_admin_new_proposal, migration 20260824050000) et "nouvelle exception de réconciliation"
-- (notify_admin_new_reconciliation_exception, migration 20260824060000). Les deux couvrent
-- plusieurs tables/sites d'INSERT — c'est justement pourquoi un trigger a été choisi plutôt qu'un
-- enqueue direct par RPC (spec 23 §7).
begin;
select plan(11);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('99991000-0000-4000-8000-000000000001', 'events-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('99991000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

insert into partners (id, display_name) values
  ('99991000-0000-4000-8000-000000000011', 'Events Test Partner');
insert into establishments (id, partner_id, name) values
  ('99991000-0000-4000-8000-000000000012', '99991000-0000-4000-8000-000000000011',
   jsonb_build_object('es', 'Establecimiento Events Test'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('99991000-0000-4000-8000-000000000013', '99991000-0000-4000-8000-000000000011',
   '99991000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', 'Producto Events Test'), 30000, false, 'events-test-product');

insert into orders (id, holder_name, holder_email) values
  ('99991000-0000-4000-8000-000000000014', 'Events Holder', 'events-holder@test.local');
insert into order_lines (
  id, order_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '99991000-0000-4000-8000-000000000015', '99991000-0000-4000-8000-000000000014',
  '99991000-0000-4000-8000-000000000013', '2029-01-01', 1, 'reserved', 'Events Holder',
  30000, 30000, 'direct', 0, 0, 0, 0, 0, 0
);
insert into payments (id, order_id, amount_cop, status) values
  ('99991000-0000-4000-8000-000000000016', '99991000-0000-4000-8000-000000000014', 30000, 'pending');

-- Trigger "nouvelle proposition" — product_proposals ------------------------------------------
insert into product_proposals (id, product_id, partner_id, submitted_by, payload) values (
  '99991000-0000-4000-8000-000000000021', '99991000-0000-4000-8000-000000000013',
  '99991000-0000-4000-8000-000000000011', '99991000-0000-4000-8000-000000000001',
  jsonb_build_object('name', jsonb_build_object('es', 'Nom proposé'))
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'admin_new_proposal' and related_table = 'product_proposals'
      and related_id = '99991000-0000-4000-8000-000000000021'
      and recipient_email = 'events-admin@test.local'),
  1,
  'cas 1 : INSERT sur product_proposals déclenche une notification admin'
);
select ok(
  ((select subject from notification_emails
    where related_table = 'product_proposals' and related_id = '99991000-0000-4000-8000-000000000021' and recipient_email = 'events-admin@test.local') like '%propuesta de producto%'),
  'cas 2 : sujet identifie le type de proposition'
);
select ok(
  ((select body_html from notification_emails
    where related_table = 'product_proposals' and related_id = '99991000-0000-4000-8000-000000000021' and recipient_email = 'events-admin@test.local') like '%/admin/proposals/99991000-0000-4000-8000-000000000021%'),
  'cas 3 : corps contient le lien vers /admin/proposals/[id] (contenu minimal, spec 23 §3)'
);

-- Trigger "nouvelle proposition" — establishment_proposals (kind='create', establishment_id null) --
insert into establishment_proposals (id, establishment_id, partner_id, submitted_by, kind, payload) values (
  '99991000-0000-4000-8000-000000000022', null, '99991000-0000-4000-8000-000000000011',
  '99991000-0000-4000-8000-000000000001', 'create', jsonb_build_object('name', jsonb_build_object('es', 'Nuevo lugar'))
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'admin_new_proposal' and related_table = 'establishment_proposals'
      and related_id = '99991000-0000-4000-8000-000000000022'
      and recipient_email = 'events-admin@test.local'),
  1,
  'cas 4 : INSERT sur establishment_proposals (kind=create, establishment_id NULL) déclenche une notification'
);
select ok(
  ((select body_html from notification_emails
    where related_table = 'establishment_proposals' and related_id = '99991000-0000-4000-8000-000000000022' and recipient_email = 'events-admin@test.local') like '%Nuevo lugar%'),
  'cas 5 : nom repris depuis le payload quand establishment_id est encore NULL (kind=create)'
);

-- Trigger "exception réconciliation" — pms_reconciliation_entries ------------------------------
insert into pms_reconciliation_entries (id, order_line_id) values (
  '99991000-0000-4000-8000-000000000023', '99991000-0000-4000-8000-000000000015'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'admin_new_reconciliation_exception' and related_table = 'pms_reconciliation_entries'
      and related_id = '99991000-0000-4000-8000-000000000023'
      and recipient_email = 'events-admin@test.local'),
  1,
  'cas 6 : INSERT sur pms_reconciliation_entries déclenche une notification admin'
);
select ok(
  ((select body_html from notification_emails
    where related_table = 'pms_reconciliation_entries' and related_id = '99991000-0000-4000-8000-000000000023' and recipient_email = 'events-admin@test.local') like '%/admin/reconciliation%'),
  'cas 7 : corps contient le lien vers /admin/reconciliation'
);

-- Trigger "exception réconciliation" — payment_reconciliation_entries, payment_id renseigné ----
insert into payment_reconciliation_entries (id, payment_id, raw_event, failure_reason) values (
  '99991000-0000-4000-8000-000000000024', '99991000-0000-4000-8000-000000000016',
  '{}'::jsonb, 'test failure'
);
select ok(
  ((select body_html from notification_emails
    where related_table = 'payment_reconciliation_entries' and related_id = '99991000-0000-4000-8000-000000000024' and recipient_email = 'events-admin@test.local') like '%Events Holder%'),
  'cas 8 : payment_id renseigné → nom du titulaire de commande retrouvé (jointure payments→orders)'
);

-- Trigger "exception réconciliation" — payment_reconciliation_entries, payment_id NULL (cas
-- limite spec 23 §9 — webhook jamais corrélé à un paiement connu) -----------------------------
insert into payment_reconciliation_entries (id, payment_id, raw_event, failure_reason) values (
  '99991000-0000-4000-8000-000000000025', null, '{}'::jsonb, 'external_reference introuvable'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'admin_new_reconciliation_exception' and related_table = 'payment_reconciliation_entries'
      and related_id = '99991000-0000-4000-8000-000000000025'
      and recipient_email = 'events-admin@test.local'),
  1,
  'cas 9 : payment_id NULL → notification quand même créée (jamais de crash de construction)'
);
select ok(
  ((select body_html from notification_emails
    where related_table = 'payment_reconciliation_entries' and related_id = '99991000-0000-4000-8000-000000000025' and recipient_email = 'events-admin@test.local') like '%no identificado%'),
  'cas 10 : payment_id NULL → libellé générique (spec 23 §9, jamais un crash de jointure)'
);

-- Isolation du trigger (spec 23 §8.1) : une proposition doit toujours pouvoir s'insérer même si
-- son trigger de notification est cassé — fault-injection en cassant notify_all_admins.
create or replace function notify_all_admins(
  p_event_type text, p_subject text, p_body_html text,
  p_related_table text default null, p_related_id uuid default null
) returns void language plpgsql as $$
begin
  raise exception 'fault injection : notify_all_admins toujours en échec';
end;
$$;

select lives_ok(
  $$
    insert into product_proposals (id, product_id, partner_id, submitted_by, payload) values (
      '99991000-0000-4000-8000-000000000026', '99991000-0000-4000-8000-000000000013',
      '99991000-0000-4000-8000-000000000011', '99991000-0000-4000-8000-000000000001',
      jsonb_build_object('name', jsonb_build_object('es', 'Nom sans notification'))
    )
  $$,
  'cas 11 : une proposition s''insère toujours même si notify_all_admins échoue systématiquement (spec 23 §8.1, trigger)'
);

select * from finish();
rollback;
