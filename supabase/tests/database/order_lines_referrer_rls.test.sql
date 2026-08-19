-- Feature 14 (Socio : dashboard de commissions) — order_lines_select_referrer, additive à
-- order_lines_select (Tranche 3, inchangée). Commandes créées via la vraie RPC create_order (pas
-- un insert brut) : preuve de bout en bout que Phase 4 écrit referrer_partner_id ET que la policy
-- le lit correctement, sur le même chemin qu'un vrai parcours d'achat.
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 2 partenaires référents (A/B), 1 partenaire propriétaire du produit (sans rapport avec
-- l'attribution — referrer_partner_id ne dépend jamais de qui possède le produit), 3 comptes
-- (référent A, référent B, un simple acheteur jamais référent d'aucune ligne).
insert into partners (id, display_name) values
  ('aa110000-0000-4000-8000-000000000001', 'Referrer RLS Test A'),
  ('aa110000-0000-4000-8000-000000000002', 'Referrer RLS Test B'),
  ('aa110000-0000-4000-8000-000000000003', 'Referrer RLS Test Owner');

insert into establishments (id, partner_id, name) values
  ('aa110000-0000-4000-8000-000000000011', 'aa110000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Establecimiento Referrer RLS'));

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  'aa110000-0000-4000-8000-000000000021', 'aa110000-0000-4000-8000-000000000003',
  'aa110000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Referrer RLS'), 40000, true, 'referrer-rls-test'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('aa110000-0000-4000-8000-000000000021', '2028-12-01', 10, 0),
  ('aa110000-0000-4000-8000-000000000021', '2028-12-02', 10, 0);

insert into partner_codes (code, partner_id, active) values
  ('RLS-TEST-A', 'aa110000-0000-4000-8000-000000000001', true),
  ('RLS-TEST-B', 'aa110000-0000-4000-8000-000000000002', true);

insert into auth.users (id, email) values
  ('aa110000-0000-4000-8000-000000000031', 'rls-referrer-a@test.local'),
  ('aa110000-0000-4000-8000-000000000032', 'rls-referrer-b@test.local'),
  ('aa110000-0000-4000-8000-000000000033', 'rls-buyer-only@test.local'),
  -- Acheteur de la commande 2, DIFFÉRENT de '...033' — inséré ici (avant le switch de rôle,
  -- comme toutes les fixtures auth.users de ce fichier), pas inline plus bas où le rôle
  -- authenticated ne peut plus écrire dans auth.users (grants revoke, cf. checklist RLS).
  ('aa110000-0000-4000-8000-000000000034', 'rls-other-buyer@test.local');

update partner_accounts set partner_id = 'aa110000-0000-4000-8000-000000000001'
 where id = 'aa110000-0000-4000-8000-000000000031';
update partner_accounts set partner_id = 'aa110000-0000-4000-8000-000000000002'
 where id = 'aa110000-0000-4000-8000-000000000032';
-- '...033' reste sans partner_id : un simple acheteur, jamais référent d'aucune ligne.

set local role authenticated;

-- Commande 1 : achetée par le simple acheteur, référée par A (code RLS-TEST-A).
select test_login('aa110000-0000-4000-8000-000000000033');
select create_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', 'aa110000-0000-4000-8000-000000000021', 'date', '2028-12-01', 'qty', 1
  )),
  'Holder Referrer RLS 1', 'buyer-fixture@hifago.test', null, false, 'RLS-TEST-A', 'link'
);

-- Commande 2 : achetée par un AUTRE acheteur (jamais '...033'), référée par B (code RLS-TEST-B).
select test_login('aa110000-0000-4000-8000-000000000034');
select create_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', 'aa110000-0000-4000-8000-000000000021', 'date', '2028-12-02', 'qty', 1
  )),
  'Holder Referrer RLS 2', 'buyer-fixture@hifago.test', null, false, 'RLS-TEST-B', 'link'
);

reset role;

-- Preuve que Phase 4 écrit bien referrer_partner_id (au-delà de la policy elle-même) — lecture
-- privilégiée, avant tout switch de rôle pour les tests RLS ci-dessous.
select is(
  (select referrer_partner_id from order_lines where date = '2028-12-01'),
  'aa110000-0000-4000-8000-000000000001'::uuid,
  'create_order écrit referrer_partner_id = A sur la ligne de la commande 1'
);
select is(
  (select referrer_partner_id from order_lines where date = '2028-12-02'),
  'aa110000-0000-4000-8000-000000000002'::uuid,
  'create_order écrit referrer_partner_id = B sur la ligne de la commande 2'
);

set local role authenticated;

-- Référent A : voit la ligne qu'il a référée, pas celle de B.
select test_login('aa110000-0000-4000-8000-000000000031');
select is(
  (select count(*) from order_lines where date = '2028-12-01')::int, 1,
  'référent A voit la ligne qu''il a référée (commande 1)'
);
select is(
  (select count(*) from order_lines where date = '2028-12-02')::int, 0,
  'référent A NE voit PAS la ligne référée par B (commande 2)'
);

-- Référent B : symétrique.
select test_login('aa110000-0000-4000-8000-000000000032');
select is(
  (select count(*) from order_lines where date = '2028-12-02')::int, 1,
  'référent B voit la ligne qu''il a référée (commande 2)'
);
select is(
  (select count(*) from order_lines where date = '2028-12-01')::int, 0,
  'référent B NE voit PAS la ligne référée par A (commande 1)'
);

-- Simple acheteur ('...033', sans partner_id, jamais référent) : voit sa PROPRE commande via
-- order_lines_select (inchangée), mais aucun accès supplémentaire à la commande d'un autre acheteur
-- via la nouvelle policy — preuve que order_lines_select_referrer n'élargit rien pour un non-référent.
select test_login('aa110000-0000-4000-8000-000000000033');
select is(
  (select count(*) from order_lines where date = '2028-12-01')::int, 1,
  'l''acheteur simple voit sa propre commande 1 (order_lines_select existante, inchangée)'
);
select is(
  (select count(*) from order_lines where date = '2028-12-02')::int, 0,
  'l''acheteur simple ne gagne AUCUN accès à la commande 2 (ni acheteur ni référent) via la nouvelle policy'
);

select * from finish();
rollback;
