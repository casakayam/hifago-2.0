-- Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — migration
-- 20260817210000_room_type_availability_and_date_rates.sql. Couvre resolve_date_price,
-- set_room_type_availability, set_date_rate, et les deux nouvelles branches plage de create_order
-- (chambre d'hôtel via room_type_id, alojamiento via end_date seul). Le test de concurrence réelle
-- (matrice plages identiques/imbriquées/adjacentes/qty multiple) vit dans
-- tests/concurrency/create_order_room_range.concurrency.mjs — jamais ici, cf. hifago/CLAUDE.md §6.3
-- (pgTAP tourne en transaction annulée, structurellement incapable de simuler une vraie
-- concurrence).
begin;
select plan(34);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 1 partenaire/établissement, 1 admin, 1 socio actif (operator sur cet établissement),
-- 1 socio d'un AUTRE établissement (garde de propriété), 1 buyer.
insert into partners (id, display_name) values
  ('88930000-0000-4000-8000-000000000001', 'Room Range Test Partner'),
  ('88930000-0000-4000-8000-000000000002', 'Room Range Other Partner');
insert into establishments (id, partner_id, name) values
  ('88930000-0000-4000-8000-000000000011', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hotel Room Range')),
  ('88930000-0000-4000-8000-000000000012', '88930000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Otro Establecimiento'));

insert into auth.users (id, email) values
  ('88930000-0000-4000-8000-000000000031', 'room-range-admin@test.local'),
  ('88930000-0000-4000-8000-000000000032', 'room-range-operator@test.local'),
  ('88930000-0000-4000-8000-000000000033', 'room-range-other-operator@test.local'),
  ('88930000-0000-4000-8000-000000000034', 'room-range-buyer@test.local');

-- partner_capabilities_scope (CHECK) : role='admin' → account_id (jamais partner_id) ; role in
-- ('referrer','operator') → partner_id (jamais account_id) — un socio agit au nom de son
-- ORGANISATION, pas de son compte directement (cf. availability_orders_rls.test.sql, même patron).
-- partner_accounts.id est auto-créé par le trigger on_auth_user_created (20260813163438) dès
-- l'insert ci-dessus ; il ne reste qu'à le rattacher à un partner_id.
update partner_accounts set partner_id = '88930000-0000-4000-8000-000000000001'
 where id = '88930000-0000-4000-8000-000000000032';
update partner_accounts set partner_id = '88930000-0000-4000-8000-000000000002'
 where id = '88930000-0000-4000-8000-000000000033';

insert into partner_capabilities (account_id, role, source, status) values
  ('88930000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- enforce_operator_implies_referrer : une capacité operator exige une capacité referrer
-- préexistante pour le même partner_id (même patron que availability_orders_rls.test.sql /
-- set_product_availability_socio.test.sql).
insert into partner_capabilities (partner_id, role, source, status) values
  ('88930000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88930000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('88930000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '88930000-0000-4000-8000-000000000011'),
  ('88930000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '88930000-0000-4000-8000-000000000012');

-- HOTEL : produit hôtel avec 2 chambres — DORM (kind=dorm, qty=lits) et PRIV (kind=private, qty=
-- chambres), + une chambre TIERS avec palier de quantité + stay_rates (surcharge week-end 20%).
insert into products (id, partner_id, establishment_id, type, name, sellable, slug) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'hotel', jsonb_build_object('es', 'Hotel Range Test'),
   true, 'room-range-hotel');

insert into product_room_types (id, product_id, kind, name, capacity, quantity, price_cop, min_qty, max_qty)
values
  ('88930000-0000-4000-8000-000000000041', '88930000-0000-4000-8000-000000000021', 'dorm',
   jsonb_build_object('es', 'Dormitorio 6 camas'), 6, 1, 20000, 1, 6),
  ('88930000-0000-4000-8000-000000000042', '88930000-0000-4000-8000-000000000021', 'private',
   jsonb_build_object('es', 'Privada doble'), 2, 3, 100000, 1, 1);
insert into product_room_types (id, product_id, kind, name, capacity, quantity, price_cop, price_tiers, stay_rates, min_qty, max_qty)
values (
  '88930000-0000-4000-8000-000000000043', '88930000-0000-4000-8000-000000000021', 'dorm',
  jsonb_build_object('es', 'Dormitorio Tiers'), 10, 2, 30000,
  jsonb_build_array(
    jsonb_build_object('min_qty', 1, 'max_qty', 2, 'price_cop', 30000),
    jsonb_build_object('min_qty', 3, 'max_qty', 10, 'price_cop', 25000)
  ),
  jsonb_build_object(
    'season', jsonb_build_object('months', jsonb_build_array(), 'surcharge_pct', 0, 'note', null),
    'weekend_days', jsonb_build_array(6, 7), -- ISO : 6=samedi, 7=dimanche
    'weekend_surcharge_pct', 0.20,
    'includes', jsonb_build_array(), 'deposit_cop', null, 'extra_note', null
  ),
  1, 10
);

-- ALOJAMIENTO : produit lodging réservable par plage (room_type_id null).
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values ('88930000-0000-4000-8000-000000000022', '88930000-0000-4000-8000-000000000001',
        '88930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Casa Range Test'),
        200000, true, 'room-range-lodging', 1, 4);

-- Disponibilité : DORM ouverte 2028-11-01..05 (capacité 4 lits), PRIV ouverte 2028-11-01..03
-- (capacité 1 chambre), TIERS ouverte 2028-11-04 (samedi, week-end) et 05 (dimanche). '2028-11-06'
-- volontairement SANS ligne pour DORM (garde slot_not_found).
insert into room_type_availability (room_type_id, date, capacity, booked)
select '88930000-0000-4000-8000-000000000041', d::date, 4, 0
  from generate_series('2028-11-01'::date, '2028-11-05'::date, interval '1 day') as d;
insert into room_type_availability (room_type_id, date, capacity, booked) values
  ('88930000-0000-4000-8000-000000000042', '2028-11-01', 1, 0),
  ('88930000-0000-4000-8000-000000000042', '2028-11-02', 1, 0),
  -- Jour déjà plein (booked=capacity) pour la garde "full" sur une plage PRIV.
  ('88930000-0000-4000-8000-000000000042', '2028-11-03', 1, 1);
insert into room_type_availability (room_type_id, date, capacity, booked) values
  ('88930000-0000-4000-8000-000000000043', '2028-11-04', 5, 0), -- samedi
  ('88930000-0000-4000-8000-000000000043', '2028-11-05', 5, 0); -- dimanche

insert into product_calendar (product_id, date, open)
select '88930000-0000-4000-8000-000000000022', d::date, true
  from generate_series('2028-12-01'::date, '2028-12-05'::date, interval '1 day') as d;
-- '2028-12-04' fermée explicitement pour la garde date_closed d'une plage lodging (PAS 01/02,
-- déjà consommées par le scénario succès plus bas — sinon l'assertion "nuit non consommée" ne
-- prouverait rien, la nuit serait déjà à booked=1 pour une tout autre raison).
update product_calendar set open = false
 where product_id = '88930000-0000-4000-8000-000000000022' and date = '2028-12-04';
insert into product_availability (product_id, date, capacity, booked)
select '88930000-0000-4000-8000-000000000022', d::date, 2, 0
  from generate_series('2028-12-01'::date, '2028-12-05'::date, interval '1 day') as d;

-- === resolve_date_price ==========================================================================
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');

select is(
  resolve_date_price(null, null, '2028-11-01', 20000, null),
  20000::bigint,
  'resolve_date_price : sans stay_rates ni override, retourne le prix palier/base tel quel'
);
select is(
  resolve_date_price(
    '88930000-0000-4000-8000-000000000043', null, '2028-11-04', 25000,
    (select stay_rates from product_room_types where id = '88930000-0000-4000-8000-000000000043')
  ),
  round(25000 * 1.20)::bigint,
  'resolve_date_price : samedi (weekend_days) → majoration stay_rates 20% appliquée sur le prix palier'
);
select is(
  resolve_date_price(
    '88930000-0000-4000-8000-000000000043', null, '2028-11-06', 25000,
    (select stay_rates from product_room_types where id = '88930000-0000-4000-8000-000000000043')
  ),
  25000::bigint,
  'resolve_date_price : jour hors weekend_days → aucune majoration'
);

reset role;
insert into room_type_date_rates (room_type_id, date, price_cop) values
  ('88930000-0000-4000-8000-000000000043', '2028-11-04', 99000);
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');

select is(
  resolve_date_price(
    '88930000-0000-4000-8000-000000000043', null, '2028-11-04', 25000,
    (select stay_rates from product_room_types where id = '88930000-0000-4000-8000-000000000043')
  ),
  99000::bigint,
  'resolve_date_price : un override date exact gagne intégralement, ignore stay_rates'
);

-- === set_room_type_availability ==================================================================
select test_login('88930000-0000-4000-8000-000000000032'); -- operator du bon établissement

select is(
  (set_room_type_availability('88930000-0000-4000-8000-000000000041', '2028-11-10', 3)->>'ok')::boolean,
  true,
  'set_room_type_availability : socio propriétaire peut ouvrir une date'
);
select is(
  (select capacity from room_type_availability
    where room_type_id = '88930000-0000-4000-8000-000000000041' and date = '2028-11-10'),
  3,
  'set_room_type_availability : capacité bien enregistrée'
);
select is(
  (set_room_type_availability('88930000-0000-4000-8000-000000000041', '2028-11-11', 999)->>'reason'),
  'capacity_exceeds_physical',
  'set_room_type_availability : capacité > quantity×capacity (dortoir, 1×6=6) refusée'
);
select is(
  (set_room_type_availability('88930000-0000-4000-8000-000000000042', '2028-11-03', 0)->>'reason'),
  'below_booked',
  'set_room_type_availability : capacité sous le booked déjà consommé (0 < 1 sur privada le 03/11, déjà plein par fixture) refusée'
);

select test_login('88930000-0000-4000-8000-000000000033'); -- operator d'un AUTRE établissement
select is(
  (set_room_type_availability('88930000-0000-4000-8000-000000000041', '2028-11-12', 2)->>'reason'),
  'room_type_not_found',
  'set_room_type_availability : socio d''un autre établissement ne peut pas toucher cette chambre'
);

-- === set_date_rate (dispatcher product/room_type) ================================================
select test_login('88930000-0000-4000-8000-000000000032');
select is(
  (set_date_rate('room_type', '88930000-0000-4000-8000-000000000041', '2028-11-15', 45000)->>'ok')::boolean,
  true,
  'set_date_rate : socio propriétaire peut fixer un prix pour sa chambre'
);
select is(
  (select price_cop from room_type_date_rates
    where room_type_id = '88930000-0000-4000-8000-000000000041' and date = '2028-11-15'),
  45000::bigint,
  'set_date_rate : override room_type bien enregistré'
);
select ok(
  (set_date_rate('room_type', '88930000-0000-4000-8000-000000000041', '2028-11-15', null)->>'ok')::boolean,
  'set_date_rate : prix null supprime l''override'
);
select is(
  (select count(*)::int from room_type_date_rates
    where room_type_id = '88930000-0000-4000-8000-000000000041' and date = '2028-11-15'),
  0,
  'set_date_rate : ligne bien supprimée'
);

-- === create_order — chambre d'hôtel par plage : succès ==========================================
reset role;
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');

create temp table tmp_room_success as
select create_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', '88930000-0000-4000-8000-000000000021',
    'room_type_id', '88930000-0000-4000-8000-000000000041',
    'date', '2028-11-01', 'end_date', '2028-11-03', 'qty', 2
  )),
  'Holder Room Range Success', p_holder_email => 'room-range-success@test.local'
) as result;

select ok(
  (select (result->>'ok')::boolean from tmp_room_success),
  'create_order chambre par plage : réservation de 2 nuits (01→03) acceptée'
);
select is(
  (select booked from room_type_availability
    where room_type_id = '88930000-0000-4000-8000-000000000041' and date = '2028-11-01'),
  2,
  'create_order chambre par plage : nuit 01/11 décrémentée de qty=2'
);
select is(
  (select booked from room_type_availability
    where room_type_id = '88930000-0000-4000-8000-000000000041' and date = '2028-11-02'),
  2,
  'create_order chambre par plage : nuit 02/11 décrémentée de qty=2'
);
select is(
  (select booked from room_type_availability
    where room_type_id = '88930000-0000-4000-8000-000000000041' and date = '2028-11-03'),
  0,
  'create_order chambre par plage : checkout (03/11, exclu de la plage) NON touché'
);
select is(
  (select total_cop from order_lines where holder_name = 'Holder Room Range Success'),
  (20000 * 2 * 2)::bigint, -- 2 nuits × 20000 (prix de base, aucun tier/override) × qty=2
  'create_order chambre par plage : total_cop = somme des prix nuit par nuit × qty'
);
select is(
  (select end_date from order_lines where holder_name = 'Holder Room Range Success'),
  '2028-11-03'::date,
  'create_order chambre par plage : end_date enregistrée sur la ligne'
);

-- === create_order — chambre d'hôtel par plage : refus tout-ou-rien (nuit pleine) ================
create temp table tmp_room_full as
select create_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', '88930000-0000-4000-8000-000000000021',
    'room_type_id', '88930000-0000-4000-8000-000000000042',
    'date', '2028-11-01', 'end_date', '2028-11-04', 'qty', 1
  )),
  'Holder Room Range Full', p_holder_email => 'room-range-full@test.local'
) as result;

select is(
  (select result->>'reason' from tmp_room_full),
  'full',
  'create_order chambre par plage : refusé car la 3e nuit (03/11, privada) est déjà pleine'
);
select is(
  (select booked from room_type_availability
    where room_type_id = '88930000-0000-4000-8000-000000000042' and date = '2028-11-01'),
  0,
  'create_order chambre par plage (refus) : nuit 01/11, AUCUNE nuit consommée (tout ou rien)'
);
select is(
  (select count(*)::int from order_lines where holder_name = 'Holder Room Range Full'),
  0,
  'create_order chambre par plage (refus) : aucune ligne créée'
);

-- === create_order — chambre d'hôtel par plage : nuit sans ligne room_type_availability ==========
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000021',
       'room_type_id', '88930000-0000-4000-8000-000000000041',
       'date', '2028-11-05', 'end_date', '2028-11-07', 'qty', 1
     )),
     'Holder Room Range NoSlot', p_holder_email => 'room-range-noslot@test.local'
   )->>'reason'),
  'slot_not_found',
  'create_order chambre par plage : nuit 06/11 sans ligne room_type_availability → slot_not_found'
);

-- === create_order — gardes Phase 1 (chambre) =====================================================
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000021',
       'room_type_id', '88930000-0000-4000-8000-000000000041',
       'date', '2028-11-01', 'qty', 1
     )),
     'Holder No End Date', p_holder_email => 'room-range-noend@test.local'
   )->>'reason'),
  'end_date_required',
  'create_order chambre : room_type_id sans end_date → end_date_required'
);
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000021',
       'room_type_id', '88930000-0000-4000-8000-000000000041',
       'date', '2028-11-03', 'end_date', '2028-11-01', 'qty', 1
     )),
     'Holder Invalid Range', p_holder_email => 'room-range-invalid@test.local'
   )->>'reason'),
  'invalid_date_range',
  'create_order chambre : end_date <= date → invalid_date_range'
);
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000022', -- lodging, pas hotel
       'room_type_id', '88930000-0000-4000-8000-000000000041',
       'date', '2028-11-01', 'end_date', '2028-11-02', 'qty', 1
     )),
     'Holder Mismatch', p_holder_email => 'room-range-mismatch@test.local'
   )->>'reason'),
  'room_type_mismatch',
  'create_order chambre : room_type_id sur un produit non-hotel → room_type_mismatch'
);
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000021',
       'room_type_id', '88930000-0000-4000-8000-000000000041',
       'date', '2028-11-01', 'end_date', '2028-11-02', 'qty', 99
     )),
     'Holder Qty Cap', p_holder_email => 'room-range-qtycap@test.local'
   )->>'reason'),
  'qty_cap_exceeded',
  'create_order chambre : qty > max_qty de la chambre → qty_cap_exceeded'
);

-- === create_order — qty multiples de la même chambre le même soir, dans le MÊME panier ==========
-- 2 lignes distinctes (dates de check-in différentes) qui se chevauchent toutes deux sur la nuit
-- du 04/11 (TIERS, capacité 5) : 3 + 3 = 6 > 5 → doit refuser, jamais additionner silencieusement
-- sans compter l'autre ligne du panier.
select is(
  (select create_order(
     jsonb_build_array(
       jsonb_build_object(
         'product_id', '88930000-0000-4000-8000-000000000021',
         'room_type_id', '88930000-0000-4000-8000-000000000043',
         'date', '2028-11-04', 'end_date', '2028-11-05', 'qty', 3
       ),
       jsonb_build_object(
         'product_id', '88930000-0000-4000-8000-000000000021',
         'room_type_id', '88930000-0000-4000-8000-000000000043',
         'date', '2028-11-04', 'end_date', '2028-11-05', 'qty', 3
       )
     ),
     'Holder Cart Overlap', p_holder_email => 'room-range-cartoverlap@test.local'
   )->>'reason'),
  'full',
  'create_order chambre : deux lignes du même panier sur la même chambre/nuit somment leur qty (3+3>5) → full'
);

-- === create_order — alojamiento (lodging) par plage : succès ====================================
create temp table tmp_lodging_success as
select create_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', '88930000-0000-4000-8000-000000000022',
    'date', '2028-12-01', 'end_date', '2028-12-03', 'qty', 1
  )),
  'Holder Lodging Range Success', p_holder_email => 'lodging-range-success@test.local'
) as result;

select ok(
  (select (result->>'ok')::boolean from tmp_lodging_success),
  'create_order alojamiento par plage : réservation de 2 nuits (01→03/12) acceptée'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000022' and date = '2028-12-01'),
  1,
  'create_order alojamiento par plage : nuit 01/12 décrémentée'
);
select is(
  (select total_cop from order_lines where holder_name = 'Holder Lodging Range Success'),
  (200000 * 2)::bigint, -- 2 nuits × prix de base (aucun tier/stay_rates sur ce produit) × qty=1
  'create_order alojamiento par plage : total_cop = somme nuit par nuit'
);

-- === create_order — alojamiento par plage : refus (date fermée) tout-ou-rien ====================
-- Plage 03→05 (nuits 03 ouverte, 04 fermée) : la nuit 03, ouverte et validée en premier, ne doit
-- PAS être consommée puisque la nuit 04 (dans la même plage) échoue ensuite — preuve que Phase 3
-- valide TOUTES les nuits avant que Phase 4 n'en écrive une seule, pas un simple court-circuit sur
-- la première nuit testée.
select is(
  (select create_order(
     jsonb_build_array(jsonb_build_object(
       'product_id', '88930000-0000-4000-8000-000000000022',
       'date', '2028-12-03', 'end_date', '2028-12-05', 'qty', 1
     )),
     'Holder Lodging Closed', p_holder_email => 'lodging-range-closed@test.local'
   )->>'reason'),
  'date_closed',
  'create_order alojamiento par plage : la nuit du 04/12 (fermée) refuse toute la plage'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000022' and date = '2028-12-03'),
  0,
  'create_order alojamiento par plage (refus) : nuit 03/12 (ouverte, validée avant la fermée) non consommée (tout ou rien)'
);

-- === modify_order_line exige p_new_end_date pour une ligne à plage ==============================
-- Le refus catégorique posé par CETTE migration (20260817210000) a été remplacé par une prise en
-- charge réelle des lignes à plage dans une migration ultérieure (20260817220400_modify_order_
-- line_range_support.sql, Tranche 2 suite) — couverture complète (succès nuits/qty, nuit commune
-- aux deux intervalles, tout-ou-rien) dans modify_order_line.test.sql, pas ici. Seule reste ici la
-- preuve que la garde de cohérence p_new_end_date/forme de la ligne s'applique toujours à un
-- appel à 4 arguments positionnels (p_new_end_date par défaut null) sur une ligne à plage.
select test_login('88930000-0000-4000-8000-000000000031'); -- admin
select throws_like(
  format(
    'select modify_order_line(%L, %L, %s, %L)',
    (select id from order_lines where holder_name = 'Holder Room Range Success' limit 1),
    '2028-11-10', 1, 'test'
  ),
  '%p_new_end_date%',
  'modify_order_line : p_new_end_date obligatoire pour modifier une ligne à plage (garde de cohérence Tranche 2)'
);

select * from finish();
rollback;
