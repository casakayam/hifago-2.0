-- Spec 34 Tranche 1 — list_my_orders : la liste « Mis reservas » du compte client.
-- Migration 20260911100000_contrat_commande_client.sql, seule source de vérité.
--
-- PAS une RPC critique anti-survente (lecture seule, aucun compteur touché).
--
-- ⚠️ Ce fichier prouve TROIS choses qu'aucun e2e n'atteindrait au même prix :
--   (a) le REFUS d'une session anonyme (décision ⑦) — la garde de zone vit dans un layout qui
--       appartient à un autre chantier, donc la règle doit être vraie EN BASE, pas à l'écran ;
--   (b) l'ISOLEMENT entre deux comptes — la RPC étant security definer, la RLS ne la protège
--       plus : c'est `where account_id = auth.uid()` seul qui le fait, donc ça se prouve ;
--   (c) qu'AUCUNE colonne de commission ne sort du contrat — rien en base ne s'y oppose
--       (order_lines_select couvre toutes les colonnes), cette liste blanche est le seul rempart.
--
-- Fixtures créées directement en SQL (orders/order_lines RPC-only) : ce fichier tourne en tant que
-- postgres, qui contourne les grants — même geste que cancel_order.test.sql.
--
-- ⚠️ Les dates sont construites RELATIVEMENT à public.today_in_bogota(), jamais en dur : une date
-- fixe ferait passer ce test aujourd'hui et échouer dans deux ans, et c'est précisément la
-- frontière « à venir / passée » qu'il teste.
begin;
select plan(16);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function lmo_group(p_ref text) returns text language sql as $$
  select x ->> 'group'
    from jsonb_array_elements(public.list_my_orders() -> 'orders') x
   where x ->> 'reference' = p_ref;
$$;

-- Cas 1 : rôle authenticated sans aucun claim JWT, AVANT toute fixture.
set local role authenticated;
select is(
  (select public.list_my_orders()->>'reason'),
  'not_authenticated',
  'rôle authenticated sans JWT claims → not_authenticated'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into partners (id, display_name) values
  ('88891000-0000-4000-8000-000000000001', 'List My Orders Test Partner');
insert into establishments (id, partner_id, name, slug, contact_phone) values
  ('88891000-0000-4000-8000-000000000011', '88891000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento List My Orders'), 'est-list-my-orders',
   '+573001234567');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88891000-0000-4000-8000-000000000021', '88891000-0000-4000-8000-000000000001',
  '88891000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad List My Orders'), 50000, true, 'list-my-orders-test'
);

insert into auth.users (id, email) values
  ('88891000-0000-4000-8000-000000000031', 'lmo-owner@test.local'),
  ('88891000-0000-4000-8000-000000000032', 'lmo-other@test.local'),
  ('88891000-0000-4000-8000-000000000033', 'lmo-anon@test.local');

-- L'identité anonyme se pose sur la TABLE, pas sur le claim : is_anonymous_session() lit
-- auth.users.is_anonymous (20260909200000), jamais le JWT. Même geste qu'attach_orders_to_account.
update auth.users set is_anonymous = true
 where id = '88891000-0000-4000-8000-000000000033';

-- Cinq commandes pour OWNER, construites pour ne PAS pouvoir se confondre.
-- A = prestation future réservée            → upcoming
-- B = séjour EN COURS (date < today <= end) → upcoming  ⬅ l'assertion que ce fichier existe pour tenir
-- C = prestation passée réalisée            → past
-- D = prestation ANNULÉE à une date FUTURE  → past (plus rien n'arrivera)
-- E = commande SANS AUCUNE LIGNE (défensif) → past
insert into orders (id, account_id, holder_name, holder_email, reference) values
  ('88891000-0000-4000-8000-000000000041', '88891000-0000-4000-8000-000000000031', 'LMO A', 'a@test.local', 'HFG-900001'),
  ('88891000-0000-4000-8000-000000000042', '88891000-0000-4000-8000-000000000031', 'LMO B', 'b@test.local', 'HFG-900002'),
  ('88891000-0000-4000-8000-000000000043', '88891000-0000-4000-8000-000000000031', 'LMO C', 'c@test.local', 'HFG-900003'),
  ('88891000-0000-4000-8000-000000000044', '88891000-0000-4000-8000-000000000031', 'LMO D', 'd@test.local', 'HFG-900004'),
  ('88891000-0000-4000-8000-000000000045', '88891000-0000-4000-8000-000000000031', 'LMO E', 'e@test.local', 'HFG-900005'),
  ('88891000-0000-4000-8000-000000000046', '88891000-0000-4000-8000-000000000032', 'LMO OTHER', 'o@test.local', 'HFG-900006'),
  ('88891000-0000-4000-8000-000000000047', '88891000-0000-4000-8000-000000000033', 'LMO ANON', 'an@test.local', 'HFG-900007');

-- Colonnes de snapshot commission renseignées avec des valeurs NON NULLES et DISTINCTES :
-- une valeur à zéro laisserait passer une fuite sans qu'on la voie. Elles ne doivent JAMAIS
-- ressortir du contrat — c'est le cas 14 plus bas.
insert into order_lines (
  order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  -- A : future
  ('88891000-0000-4000-8000-000000000041', '88891000-0000-4000-8000-000000000031',
   '88891000-0000-4000-8000-000000000021', public.today_in_bogota() + 10, null, 1, 'reserved', 'LMO A',
   50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  -- B : séjour commencé AVANT-HIER et fini APRÈS-DEMAIN → à venir, pas passé
  ('88891000-0000-4000-8000-000000000042', '88891000-0000-4000-8000-000000000031',
   '88891000-0000-4000-8000-000000000021', public.today_in_bogota() - 2, public.today_in_bogota() + 2,
   1, 'reserved', 'LMO B', 50000, 200000, 'direct', 0.17, 0.10, 0.07, 34000, 20000, 14000),
  -- C : passée, réalisée
  ('88891000-0000-4000-8000-000000000043', '88891000-0000-4000-8000-000000000031',
   '88891000-0000-4000-8000-000000000021', public.today_in_bogota() - 30, null, 1, 'fulfilled', 'LMO C',
   50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  -- D : annulée, à une date FUTURE
  ('88891000-0000-4000-8000-000000000044', '88891000-0000-4000-8000-000000000031',
   '88891000-0000-4000-8000-000000000021', public.today_in_bogota() + 20, null, 1, 'cancelled_by_client', 'LMO D',
   50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  -- OTHER et ANON : une ligne future chacun, pour l'isolement
  ('88891000-0000-4000-8000-000000000046', '88891000-0000-4000-8000-000000000032',
   '88891000-0000-4000-8000-000000000021', public.today_in_bogota() + 5, null, 1, 'reserved', 'LMO OTHER',
   50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  ('88891000-0000-4000-8000-000000000047', '88891000-0000-4000-8000-000000000033',
   '88891000-0000-4000-8000-000000000021', public.today_in_bogota() + 5, null, 1, 'reserved', 'LMO ANON',
   50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500);

-- ---------------------------------------------------------------------------------------------
-- Cas 2-3 : la session anonyme est refusée EN BASE, et ne voit rien
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88891000-0000-4000-8000-000000000033');

select is(
  (select public.list_my_orders()->>'reason'),
  'anonymous_session',
  'une session anonyme est refusée (décision ⑦), même propriétaire de commandes'
);
select ok(
  (select public.list_my_orders() -> 'orders') is null,
  'une session anonyme refusée ne reçoit AUCUNE commande, pas même une liste vide remplie'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 4 : isolement — OTHER ne voit que la sienne, jamais celles d'OWNER
-- ---------------------------------------------------------------------------------------------
select test_login('88891000-0000-4000-8000-000000000032');
select is(
  (select jsonb_agg(x ->> 'reference') from jsonb_array_elements(public.list_my_orders() -> 'orders') x),
  '["HFG-900006"]'::jsonb,
  'un compte ne voit QUE ses propres commandes (la RPC est security definer : la RLS ne la protège plus)'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 5-10 : les groupes, commande par commande
-- ---------------------------------------------------------------------------------------------
select test_login('88891000-0000-4000-8000-000000000031');

select is(
  (select jsonb_array_length(public.list_my_orders() -> 'orders')),
  5,
  'le propriétaire voit ses cinq commandes'
);

select is(lmo_group('HFG-900001'), 'upcoming', 'une prestation future réservée → upcoming');
select is(
  lmo_group('HFG-900002'), 'upcoming',
  'un SÉJOUR EN COURS (date passée, end_date future) → upcoming — coalesce(end_date, date), pas date seule'
);
select is(lmo_group('HFG-900003'), 'past', 'une prestation passée réalisée → past');
select is(
  lmo_group('HFG-900004'), 'past',
  'une commande dont toutes les lignes sont annulées → past, même à une date future'
);
select is(lmo_group('HFG-900005'), 'past', 'une commande sans aucune ligne → past (défensif)');

-- ---------------------------------------------------------------------------------------------
-- Cas 11 : l'ordre exact — à venir d'abord (la plus proche en haut), puis passées (la plus récente)
-- ---------------------------------------------------------------------------------------------
select is(
  (select jsonb_agg(x ->> 'reference') from jsonb_array_elements(public.list_my_orders() -> 'orders') x),
  '["HFG-900002","HFG-900001","HFG-900004","HFG-900003","HFG-900005"]'::jsonb,
  'ordre : séjour en cours, puis future ; puis passées par date décroissante, sans-ligne en dernier'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 12-16 : le contrat
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
     from jsonb_array_elements(public.list_my_orders() -> 'orders') o,
          lateral jsonb_array_elements(o -> 'lines') l,
          lateral jsonb_object_keys(l) k
    where k like '%commission%' or k like '%\_pct' or k = 'referrer_partner_id'),
  0,
  'AUCUNE colonne de commission ne sort du contrat (le seul rempart de ce chemin)'
);

select is(
  (select count(*)::int
     from jsonb_array_elements(public.list_my_orders() -> 'orders') o
    where o ? 'status'),
  0,
  'orders.status n''est pas transmis — placeholder jamais calculé (invariant 4)'
);

select is(
  (select count(*)::int
     from jsonb_array_elements(public.list_my_orders() -> 'orders') o
    where (o ->> 'access_token') ~ '^[0-9a-f]{32}$'),
  5,
  'chaque commande porte son access_token — le lien vers /reserva/<jeton> (décision ③)'
);

select is(
  (select count(*)::int
     from jsonb_array_elements(public.list_my_orders() -> 'orders') o,
          lateral jsonb_array_elements(o -> 'lines') l
    where l ? 'acompte_cop' and l ? 'total_cop'
      and l ? 'establishment_slug' and l ? 'establishment_contact_phone'),
  4,
  'chaque ligne porte ses DEUX montants (décision ④) et son établissement (décisions ③/⑥)'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 17 : les grants, lus sur l'ACL — jamais déduits du corps de la fonction
-- ---------------------------------------------------------------------------------------------
reset role;
select is(
  array[
    has_function_privilege('anon', 'public.list_my_orders()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.list_my_orders()', 'EXECUTE'),
    has_function_privilege('anon', 'public.order_for_client_jsonb(public.orders)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.order_for_client_jsonb(public.orders)', 'EXECUTE')
  ],
  array[false, true, false, false],
  'list_my_orders : authenticated seul ; le contrat partagé : personne (il n''est pas une API)'
);

select * from finish();
rollback;
