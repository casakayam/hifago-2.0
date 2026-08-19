-- Feature 8 (Client : annuler sa réservation) — cancel_order.
-- Migration 20260814161500_cancel_order_rpc.sql, seule source de vérité pour les reasons/logique.
-- PAS une RPC critique anti-survente (aucun compteur de capacité touché) : verrou FOR UPDATE
-- simple sur orders (propriété), même calibrage que la feature 16 — pas de test de concurrence à
-- barrière ici, cf. plan.
--
-- Fixtures créées directement en SQL (orders/order_lines RPC-only, INSERT/UPDATE/DELETE révoqués
-- pour authenticated/anon — mais ce fichier tourne en tant que postgres, qui contourne les grants,
-- exactement comme les fixtures product_availability des autres fichiers de test).
begin;
select plan(10);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Cas 1 : non authentifié, EN PREMIER, avant toute fixture (aucun claim JWT actif). Rôle
-- authenticated posé (sinon l'appel échouerait par un refus de grant AVANT même d'atteindre le
-- corps de la fonction — cancel_order n'a justement aucun grant anon, donc ce n'est pas le même
-- échec que celui testé ici : la défense explicite de la fonction contre un rôle authenticated
-- sans identité résolvable, ex. JWT expiré/malformé).
set local role authenticated;
select is(
  (select cancel_order('00000000-0000-4000-8000-000000000099'::uuid)->>'reason'),
  'not_authenticated',
  'rôle authenticated sans JWT claims → not_authenticated'
);
reset role;

-- Fixtures : 1 partenaire/établissement/produit, 2 comptes acheteurs (OWNER = propriétaire des
-- commandes testées, OTHER = pour prouver order_not_found sur la commande d'un autre compte).
insert into partners (id, display_name) values
  ('88890000-0000-4000-8000-000000000001', 'Cancel Order Test Partner');
insert into establishments (id, partner_id, name) values
  ('88890000-0000-4000-8000-000000000011', '88890000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Cancel Order'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88890000-0000-4000-8000-000000000021', '88890000-0000-4000-8000-000000000001',
  '88890000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Cancel Order'), 50000, true, 'cancel-order-test'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('88890000-0000-4000-8000-000000000021', '2028-11-01', 10, 3);

insert into auth.users (id, email) values
  ('88890000-0000-4000-8000-000000000031', 'cancel-owner@test.local'),
  ('88890000-0000-4000-8000-000000000032', 'cancel-other@test.local');

-- Colonnes de snapshot commission (feature 11, order_lines.price_cop/total_cop/commission_case/...)
-- renseignées avec des valeurs de remplissage neutres (commission_case='direct') sur toutes les
-- lignes insérées directement ci-dessous — hors de portée de ce fichier, qui teste cancel_order,
-- pas le calcul de commission.

-- Commande 1 (OWNER) : 2 lignes reserved — cas 4 (annulation complète) puis cas 6 (second appel).
insert into orders (id, account_id, holder_name, holder_email)
values (
  '88890000-0000-4000-8000-000000000041', '88890000-0000-4000-8000-000000000031', 'Holder Cancel Full',
  'holder-cancel-full@test.local'
);
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88890000-0000-4000-8000-000000000041', '88890000-0000-4000-8000-000000000031',
   '88890000-0000-4000-8000-000000000021', '2028-11-01', 1, 'reserved', 'Holder Cancel Full',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('88890000-0000-4000-8000-000000000041', '88890000-0000-4000-8000-000000000031',
   '88890000-0000-4000-8000-000000000021', '2028-11-01', 2, 'reserved', 'Holder Cancel Full',
   50000, 100000, 'direct', 0, 0, 0, 0, 0, 0);

-- Commande 2 (OWNER) : 1 ligne fulfilled (seedée ainsi) + 1 ligne reserved — cas 5 (seule la
-- ligne reserved doit être touchée).
insert into orders (id, account_id, holder_name, holder_email)
values (
  '88890000-0000-4000-8000-000000000042', '88890000-0000-4000-8000-000000000031', 'Holder Cancel Partial',
  'holder-cancel-partial@test.local'
);
-- qty distincts entre les 2 lignes : permet d'identifier sans ambiguïté « la ligne reserved » par
-- un attribut d'origine stable après l'appel, plutôt que par son statut qui vient justement de
-- changer.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88890000-0000-4000-8000-000000000042', '88890000-0000-4000-8000-000000000031',
   '88890000-0000-4000-8000-000000000021', '2028-11-01', 5, 'fulfilled', 'Holder Cancel Partial',
   50000, 250000, 'direct', 0, 0, 0, 0, 0, 0),
  ('88890000-0000-4000-8000-000000000042', '88890000-0000-4000-8000-000000000031',
   '88890000-0000-4000-8000-000000000021', '2028-11-01', 1, 'reserved', 'Holder Cancel Partial',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

-- Commande 3 (OTHER) : pour le cas order_not_found « commande d'un autre compte ».
insert into orders (id, account_id, holder_name, holder_email)
values (
  '88890000-0000-4000-8000-000000000043', '88890000-0000-4000-8000-000000000032', 'Holder Cancel Other',
  'holder-cancel-other@test.local'
);
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88890000-0000-4000-8000-000000000043', '88890000-0000-4000-8000-000000000032',
   '88890000-0000-4000-8000-000000000021', '2028-11-01', 1, 'reserved', 'Holder Cancel Other',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;
select test_login('88890000-0000-4000-8000-000000000031'); -- OWNER

-- Cas 2 : commande d'un autre compte → order_not_found (même réponse que « inexistante », jamais
-- un refus qui distinguerait les deux).
select is(
  (select cancel_order('88890000-0000-4000-8000-000000000043'::uuid)->>'reason'),
  'order_not_found',
  'commande appartenant à un autre compte → order_not_found'
);

-- Cas 3 : commande inexistante → order_not_found (même reason que le cas 2 ci-dessus).
select is(
  (select cancel_order('00000000-0000-4000-8000-000000000099'::uuid)->>'reason'),
  'order_not_found',
  'commande inexistante → order_not_found (même reason que le cas 2)'
);

-- Cas 4 : commande avec lignes actives → toutes passent à cancelled_by_client, booked inchangé
-- (preuve explicite de la décision de conception : jamais de remise en vente automatique).
select is(
  (select cancel_order('88890000-0000-4000-8000-000000000041'::uuid)),
  jsonb_build_object('ok', true, 'cancelled_lines', 2),
  'commande avec 2 lignes reserved → succès, cancelled_lines=2'
);
select is(
  (select count(*) from order_lines
    where order_id = '88890000-0000-4000-8000-000000000041' and status = 'cancelled_by_client')::int,
  2,
  'les 2 lignes sont passées à cancelled_by_client'
);
select is(
  (select booked from product_availability
    where product_id = '88890000-0000-4000-8000-000000000021' and date = '2028-11-01'),
  3,
  'booked inchangé après annulation (aucune remise en vente automatique)'
);

-- Cas 5 : commande avec une ligne déjà fulfilled et une ligne reserved → seule la ligne reserved
-- est touchée, la fulfilled reste intacte.
select is(
  (select cancel_order('88890000-0000-4000-8000-000000000042'::uuid)),
  jsonb_build_object('ok', true, 'cancelled_lines', 1),
  'commande avec 1 ligne fulfilled + 1 reserved → succès, cancelled_lines=1 (seulement la reserved)'
);
select is(
  (select status from order_lines
    where order_id = '88890000-0000-4000-8000-000000000042' and qty = 1),
  'cancelled_by_client',
  'la ligne reserved (qty=1) est passée à cancelled_by_client'
);
select is(
  (select count(*) from order_lines
    where order_id = '88890000-0000-4000-8000-000000000042' and status = 'fulfilled')::int,
  1,
  'la ligne déjà fulfilled reste intacte, jamais retouchée'
);

-- Cas 6 : second appel sur la commande 1, déjà entièrement annulée par le cas 4 → no_active_lines,
-- jamais une exception ni une double transition.
select is(
  (select cancel_order('88890000-0000-4000-8000-000000000041'::uuid)->>'reason'),
  'no_active_lines',
  'second appel sur une commande déjà entièrement annulée → no_active_lines'
);

select * from finish();
rollback;
