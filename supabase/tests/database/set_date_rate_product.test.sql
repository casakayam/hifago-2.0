-- Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — couverture dédiée du
-- chemin p_entity_type='product' de set_date_rate (dispatcher défini dans la migration
-- 20260817210000_room_type_availability_and_date_rates.sql). Depuis T3 étape 2 (20260827220000),
-- 'product' est le SEUL chemin de set_date_rate : le chemin 'room_type' a disparu avec les chambres,
-- non touché ici) — même dispatcher, mêmes garde-fous identité/propriété/capacité que
-- set_product_availability (cf. set_product_availability_socio.test.sql, même patron de fixtures).
begin;
select plan(6);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 2 partenaires (own : point de vue principal, capacité operator active scopée à son
-- établissement ; other : tiers, cible "produit d'un autre partenaire") + 1 admin — même patron
-- que set_product_availability_socio.test.sql.
insert into partners (id, display_name) values
  ('77790000-0000-4000-8000-000000000001', 'Date Rate Product Test Own'),
  ('77790000-0000-4000-8000-000000000002', 'Date Rate Product Test Other');

insert into establishments (id, partner_id, name) values
  ('77790000-0000-4000-8000-000000000011', '77790000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Own')),
  ('77790000-0000-4000-8000-000000000012', '77790000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Other'));

insert into auth.users (id, email) values
  ('77790000-0000-4000-8000-000000000021', 'date-rate-product-own@test.local'),
  ('77790000-0000-4000-8000-000000000022', 'date-rate-product-other@test.local'),
  ('77790000-0000-4000-8000-000000000023', 'date-rate-product-admin@test.local');

-- partner_accounts.id est auto-créé par le trigger on_auth_user_created (20260813163438) dès
-- l'insert ci-dessus ; il ne reste qu'à le rattacher à un partner_id.
update partner_accounts set partner_id = '77790000-0000-4000-8000-000000000001'
 where id = '77790000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '77790000-0000-4000-8000-000000000002'
 where id = '77790000-0000-4000-8000-000000000022';

-- enforce_operator_implies_referrer : une capacité operator exige une capacité referrer
-- préexistante pour le même partner_id.
insert into partner_capabilities (partner_id, role, source, status) values
  ('77790000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('77790000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('77790000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '77790000-0000-4000-8000-000000000011'),
  ('77790000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '77790000-0000-4000-8000-000000000012');

insert into partner_capabilities (account_id, role, source, status) values
  ('77790000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '77790000-0000-4000-8000-000000000031', '77790000-0000-4000-8000-000000000001',
  '77790000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Producto Date Rate'), 50000, true, 'date-rate-product-own'
);

set local role authenticated;

-- === Admin fixe un prix spécial pour une date du produit → succès, ligne créée =================
select test_login('77790000-0000-4000-8000-000000000023');

select is(
  (select set_date_rate(
     'product', '77790000-0000-4000-8000-000000000031'::uuid, '2027-06-01'::date, 75000
   )->>'ok'),
  'true',
  'admin fixe un prix spécial pour une date du produit : succès'
);
select is(
  (select price_cop from product_date_rates
    where product_id = '77790000-0000-4000-8000-000000000031' and date = '2027-06-01'),
  75000::bigint,
  'product_date_rates : ligne créée avec le bon prix'
);

-- === Socio d'un AUTRE partenaire, produit pas à lui → not_found (jamais un refus qui révèle =====
-- qu'il existe, même patron que set_product_availability_socio.test.sql) =========================
select test_login('77790000-0000-4000-8000-000000000022');
select is(
  (select set_date_rate(
     'product', '77790000-0000-4000-8000-000000000031'::uuid, '2027-06-02'::date, 99000
   )->>'reason'),
  'not_found',
  'socio d''un autre partenaire ne peut pas fixer un prix sur ce produit → not_found'
);

-- === price=null supprime l'override existant (créé par l'admin ci-dessus) ======================
select test_login('77790000-0000-4000-8000-000000000023');
select ok(
  (select set_date_rate(
     'product', '77790000-0000-4000-8000-000000000031'::uuid, '2027-06-01'::date, null
   )->>'ok')::boolean,
  'set_date_rate : prix null supprime l''override existant'
);
select is(
  (select count(*)::int from product_date_rates
    where product_id = '77790000-0000-4000-8000-000000000031' and date = '2027-06-01'),
  0,
  'product_date_rates : ligne bien supprimée'
);

-- === Prix invalide (<=0) refusé, jamais silencieusement accepté ================================
select is(
  (select set_date_rate(
     'product', '77790000-0000-4000-8000-000000000031'::uuid, '2027-06-03'::date, 0
   )->>'reason'),
  'invalid_price',
  'prix <= 0 refusé (invalid_price)'
);

select * from finish();
rollback;
