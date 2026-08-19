-- Spec 15 (docs/specs/15-socio-creation-produit.md) — Socio : proposer la création d'une nouvelle
-- fiche produit. submit_product_creation_proposal (3 garde-fous + whitelist par type + 2
-- plafonds + plafond photos), moderate_product_proposal branche kind='create' (approbation pour
-- 3 types représentatifs — activity/hotel/lodging — et rejet), create_product_from_proposal
-- jamais appelable directement (pas de grant execute).
begin;
select plan(34);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : partenaire "own" avec DEUX établissements actifs (le plafond "1 pending" de
-- submit_product_creation_proposal est par établissement, pas par partenaire — prouvé plus bas),
-- "other" (établissement d'un tiers) et "nocap" (établissement possédé mais sans capacité operator
-- du tout, pas seulement suspendue).
insert into partners (id, display_name) values
  ('88880000-0000-4000-8000-000000000001', 'Creation Test Own'),
  ('88880000-0000-4000-8000-000000000002', 'Creation Test Other'),
  ('88880000-0000-4000-8000-000000000003', 'Creation Test NoCap');

insert into establishments (id, partner_id, name) values
  ('88880000-0000-4000-8000-000000000011', '88880000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Own 1')),
  ('88880000-0000-4000-8000-000000000014', '88880000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Own 2')),
  ('88880000-0000-4000-8000-000000000012', '88880000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Other')),
  ('88880000-0000-4000-8000-000000000013', '88880000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Establecimiento NoCap'));

insert into auth.users (id, email) values
  ('88880000-0000-4000-8000-000000000021', 'creation-own@test.local'),
  ('88880000-0000-4000-8000-000000000022', 'creation-other@test.local'),
  ('88880000-0000-4000-8000-000000000023', 'creation-nocap@test.local'),
  ('88880000-0000-4000-8000-000000000024', 'creation-admin@test.local');

update partner_accounts set partner_id = '88880000-0000-4000-8000-000000000001'
 where id = '88880000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '88880000-0000-4000-8000-000000000002'
 where id = '88880000-0000-4000-8000-000000000022';
update partner_accounts set partner_id = '88880000-0000-4000-8000-000000000003'
 where id = '88880000-0000-4000-8000-000000000023';

insert into partner_capabilities (partner_id, role, source, status) values
  ('88880000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88880000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active'),
  ('88880000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('88880000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '88880000-0000-4000-8000-000000000011'),
  ('88880000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '88880000-0000-4000-8000-000000000014'),
  ('88880000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '88880000-0000-4000-8000-000000000012');
-- nocap : délibérément aucune ligne operator sur son établissement.

insert into partner_capabilities (account_id, role, source, status) values
  ('88880000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into catalog_tags (id, label, slug) values
  ('88880000-0000-4000-8000-000000000041', jsonb_build_object('es', 'Aventura'), 'creation-test-aventura');

set local role authenticated;

-- Garde-fous 1+2 (identité + propriété) : établissement d'un autre partenaire / inexistant --------
select test_login('88880000-0000-4000-8000-000000000021');

select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000012'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', 'X'))
   )->>'reason'),
  'establishment_not_found',
  'établissement appartenant à un autre partenaire → establishment_not_found'
);
select is(
  (select submit_product_creation_proposal(
     '00000000-0000-4000-8000-000000000099'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', 'X'))
   )->>'reason'),
  'establishment_not_found',
  'établissement inexistant → la même réponse establishment_not_found (ne révèle rien de plus)'
);

-- Garde-fou 3 (capacité) : absente (nocap) puis suspendue (own, temporairement) -------------------
select test_login('88880000-0000-4000-8000-000000000023');
select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000013'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', 'X'))
   )->>'reason'),
  'capability_suspended',
  'aucune ligne operator du tout pour cet établissement → capability_suspended'
);

reset role;
update partner_capabilities set status = 'suspended'
 where partner_id = '88880000-0000-4000-8000-000000000001' and establishment_id = '88880000-0000-4000-8000-000000000011';
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000011'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', 'X'))
   )->>'reason'),
  'capability_suspended',
  'capacité operator suspendue pour cet établissement précis → capability_suspended'
);
reset role;
update partner_capabilities set status = 'active'
 where partner_id = '88880000-0000-4000-8000-000000000001' and establishment_id = '88880000-0000-4000-8000-000000000011';
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

-- Validation minimale : type invalide, nom manquant ------------------------------------------------
select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000011'::uuid, 'tour', jsonb_build_object('name', jsonb_build_object('es', 'X'))
   )->>'reason'),
  'invalid_type',
  '"tour" (legacy, jamais exposé dans aucun formulaire) est refusé par ce mécanisme → invalid_type'
);
select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000011'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', '  '))
   )->>'reason'),
  'name_required',
  'nom vide (espaces seulement) → name_required'
);

-- Soumission valide + preuve du filtrage du payload (propriété de sûreté n°2 du cahier socio) -----
select lives_ok(
  $$ select submit_product_creation_proposal(
       '88880000-0000-4000-8000-000000000011'::uuid, 'activity',
       jsonb_build_object(
         'name', jsonb_build_object('es', 'Actividad Propuesta'),
         'description', jsonb_build_object('es', 'Descripción'),
         'address', 'Calle Falsa 123',
         'lat', 4.5, 'lon', -75.6,
         'tag_ids', jsonb_build_array('88880000-0000-4000-8000-000000000041'),
         'price_cop', 45000, 'min_qty', 1, 'max_qty', 8,
         'slot_rules', jsonb_build_array(jsonb_build_object(
           'weekdays', jsonb_build_array(6, 1), 'start_time', '09:00', 'end_time', '12:00',
           'slot_duration_minutes', 60, 'capacity', 4
         )),
         'sellable', true, 'commission_pct', 0.99, 'lobby_product_id', 12345, 'champo_arbitrario', 'x'
       )
     ) $$,
  'une soumission valide (avec un payload piégé de champs hors whitelist) réussit'
);
select is(
  (select payload ? 'sellable' or payload ? 'commission_pct' or payload ? 'lobby_product_id' or payload ? 'champo_arbitrario'
     from product_proposals
    where establishment_id = '88880000-0000-4000-8000-000000000011' and kind = 'create' and status = 'pending'),
  false,
  'sellable/commission_pct/lobby_product_id/champo_arbitrario absents du payload stocké (whitelist stricte par type)'
);
select is(
  (select (payload->>'price_cop')::int from product_proposals
    where establishment_id = '88880000-0000-4000-8000-000000000011' and kind = 'create' and status = 'pending'),
  45000,
  'price_cop, lui, autorisé pour ce type (activity, hasPriceQtyFields) est bien conservé'
);

-- Photos (révision Jérôme 2026-08-17) : plafond 6, filtrage des entrées sans storage_path --------
-- Sur le 2e établissement d'own (…0014), jamais touché encore à ce stade — pour ne pas perturber
-- la proposition pending sur …0011 dont dépend le test "pending_creation_exists" juste après.
select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000014'::uuid, 'activity',
     jsonb_build_object(
       'name', jsonb_build_object('es', 'Con demasiadas fotos'),
       'photos', (select jsonb_agg(jsonb_build_object('storage_path', 'products/' || n || '.webp'))
                    from generate_series(1, 7) as n)
     )
   )->>'reason'),
  'gallery_cap_exceeded',
  '7 photos proposées à la création → gallery_cap_exceeded (plafond 6, cahier socio §3e)'
);

-- Plusieurs créations pending simultanées sur le MÊME établissement — désormais autorisées ---------
-- (correctif Jérôme 2026-08-18 : le plafond "1 pending par établissement" bloquait un socio qui
-- voulait proposer une 2e fiche pendant qu'une 1re attendait encore la revue admin. Retiré :
-- product_proposals_scope n'impose aucune limite de nombre, seul le plafond générique 10
-- pending/partenaire — testé juste après — reste une vraie barrière.)
select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000011'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', 'Y'))
   )->>'ok')::boolean,
  true,
  'une 2e création pending sur le MÊME établissement réussit désormais (plafond par établissement retiré)'
);
select is(
  (select count(*) from product_proposals
    where establishment_id = '88880000-0000-4000-8000-000000000011' and kind = 'create' and status = 'pending')::int,
  2,
  '2 créations pending coexistent bien sur le même établissement'
);

-- Plafond générique 10 pending / partenaire (tous kinds confondus) --------------------------------
reset role;
delete from product_proposals where partner_id = '88880000-0000-4000-8000-000000000001';
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88880000-0000-4000-8000-000000000051', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Dummy'), 1000, false, 'creation-test-dummy');
insert into product_proposals (product_id, partner_id, submitted_by, payload, status)
select
  '88880000-0000-4000-8000-000000000051', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000021', jsonb_build_object('name', jsonb_build_object('es', 'Dummy ' || n)), 'pending'
from generate_series(1, 10) as n;
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

select is(
  (select submit_product_creation_proposal(
     '88880000-0000-4000-8000-000000000014'::uuid, 'activity', jsonb_build_object('name', jsonb_build_object('es', 'Z'))
   )->>'reason'),
  'pending_cap_exceeded',
  '10 propositions déjà en attente (tous kinds confondus) → pending_cap_exceeded'
);

reset role;
delete from product_proposals where partner_id = '88880000-0000-4000-8000-000000000001';
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

-- Approbation, 3 types représentatifs --------------------------------------------------------------

-- activity : tags + slot_rules + price_cop simple -------------------------------------------------
create temp table tmp_activity as
  select (submit_product_creation_proposal(
    '88880000-0000-4000-8000-000000000011'::uuid, 'activity',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Actividad Aprobada'),
      'tag_ids', jsonb_build_array('88880000-0000-4000-8000-000000000041'),
      'price_cop', 30000,
      -- Cupo diario por defecto (spec 18) — miroir de capacity côté lodging, prouve le round-trip
      -- payload → whitelist (submit_product_creation_proposal) → insert (create_product_from_proposal).
      'default_capacity', 5,
      'slot_rules', jsonb_build_array(jsonb_build_object(
        'weekdays', jsonb_build_array(3, 1), 'start_time', '08:00', 'end_time', '10:00',
        'slot_duration_minutes', 30, 'capacity', 6
      )),
      -- 2e entrée sans storage_path : doit être filtrée par la whitelist, jamais stockée ni
      -- rattachée à product_media.
      'photos', jsonb_build_array(
        jsonb_build_object('storage_path', 'products/photo-1.webp'),
        jsonb_build_object('note', 'sans storage_path'),
        jsonb_build_object('storage_path', 'products/photo-2.webp')
      )
    )
  )->>'proposal_id')::uuid as id;

select test_login('88880000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_activity), 'approve', 1)->>'ok'),
  'true',
  'approbation de la création activity réussit'
);
select is(
  (select jsonb_build_object('type', p.type, 'sellable', p.sellable, 'establishment_id', p.establishment_id)
     from product_proposals pp join products p on p.id = pp.product_id
    where pp.id = (select id from tmp_activity)),
  jsonb_build_object('type', 'activity', 'sellable', false, 'establishment_id', '88880000-0000-4000-8000-000000000011'),
  'products créé avec type=activity, sellable=false, rattaché au bon établissement'
);
select is(
  (select count(*) from product_tag_assignments pta join product_proposals pp on pp.product_id = pta.product_id
    where pp.id = (select id from tmp_activity) and pta.tag_id = '88880000-0000-4000-8000-000000000041')::int,
  1,
  'product_tag_assignments contient le tag proposé'
);
select is(
  (select jsonb_build_object('weekdays', psr.weekdays, 'capacity', psr.capacity)
     from product_slot_rules psr join product_proposals pp on pp.product_id = psr.product_id
    where pp.id = (select id from tmp_activity)),
  jsonb_build_object('weekdays', array[1, 3], 'capacity', 6),
  'product_slot_rules contient le créneau proposé, weekdays triés'
);
select is(
  (select array_agg(pm.storage_path order by pm.sort)
     from product_media pm join product_proposals pp on pp.product_id = pm.product_id
    where pp.id = (select id from tmp_activity)),
  array['products/photo-1.webp', 'products/photo-2.webp'],
  'product_media contient les 2 photos valides (celle sans storage_path filtrée), dans l''ordre proposé'
);
select is(
  (select p.default_capacity from product_proposals pp join products p on p.id = pp.product_id
    where pp.id = (select id from tmp_activity)),
  5,
  'default_capacity (cupo diario) proposé survit le round-trip whitelist + insert pour un type activity'
);

-- hotel : 2 chambres, aucune capacity/stay_rates/price_cop sur le produit lui-même ------------------
-- Photos de chambre (retour Jérôme 2026-08-18, "les chambres et dortoirs n'ont toujours pas la
-- possibilité d'avoir des images") : le dortoir en propose 2 (dont round-trip room_media), la
-- chambre privée aucune (prouve que l'absence de photos reste un cas normal, pas une erreur).
select test_login('88880000-0000-4000-8000-000000000021');
create temp table tmp_hotel as
  select (submit_product_creation_proposal(
    '88880000-0000-4000-8000-000000000014'::uuid, 'hotel',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Hotel Aprobado'),
      'room_types', jsonb_build_array(
        jsonb_build_object(
          'kind', 'dorm', 'name', jsonb_build_object('es', 'Dormitorio'), 'capacity', 6, 'price_cop', 40000,
          'photos', jsonb_build_array(
            jsonb_build_object('storage_path', 'rooms/dorm-1.webp'),
            jsonb_build_object('storage_path', 'rooms/dorm-2.webp')
          )
        ),
        jsonb_build_object('kind', 'private', 'name', jsonb_build_object('es', 'Privada'), 'capacity', 2, 'price_cop', 120000)
      )
    )
  )->>'proposal_id')::uuid as id;

select test_login('88880000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_hotel), 'approve', 1)->>'ok'),
  'true',
  'approbation de la création hotel réussit'
);
select is(
  (select jsonb_build_object('type', p.type, 'price_cop', p.price_cop)
     from product_proposals pp join products p on p.id = pp.product_id
    where pp.id = (select id from tmp_hotel)),
  jsonb_build_object('type', 'hotel', 'price_cop', null),
  'products (hotel) créé sans prix propre — le prix vit sur les chambres'
);
select is(
  (select count(*) from product_room_types prt join product_proposals pp on pp.product_id = prt.product_id
    where pp.id = (select id from tmp_hotel))::int,
  2,
  'product_room_types contient les 2 chambres proposées'
);
select is(
  (select array_agg(rm.storage_path order by rm.sort)
     from room_media rm
     join product_room_types prt on prt.id = rm.room_type_id
     join product_proposals pp on pp.product_id = prt.product_id
    where pp.id = (select id from tmp_hotel) and prt.kind = 'dorm'),
  array['rooms/dorm-1.webp', 'rooms/dorm-2.webp'],
  'room_media contient les 2 photos proposées pour le dortoir, dans l''ordre'
);
select is(
  (select count(*) from room_media rm
     join product_room_types prt on prt.id = rm.room_type_id
     join product_proposals pp on pp.product_id = prt.product_id
    where pp.id = (select id from tmp_hotel) and prt.kind = 'private')::int,
  0,
  'aucune photo proposée pour la chambre privée → room_media vide pour elle (cas normal)'
);

-- Les photos de chambre survivent à une correction admin qui ne les transporte jamais (exactement
-- ce qui se passe en pratique : ModerateProductCreationProposalForm.tsx masque toujours l'éditeur
-- de photos de chambre, hidePhotosInHotelRooms=true — p_corrected_payload ne les inclut donc
-- jamais). Réinjectées par moderate_product_proposal depuis la proposition ORIGINALE, par position.
select test_login('88880000-0000-4000-8000-000000000021');
create temp table tmp_hotel_corrected as
  select (submit_product_creation_proposal(
    '88880000-0000-4000-8000-000000000014'::uuid, 'hotel',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Hotel Con Correccion'),
      'room_types', jsonb_build_array(jsonb_build_object(
        'kind', 'private', 'name', jsonb_build_object('es', 'Privada'), 'capacity', 2, 'price_cop', 100000,
        'photos', jsonb_build_array(jsonb_build_object('storage_path', 'rooms/private-1.webp'))
      ))
    )
  )->>'proposal_id')::uuid as id;

select test_login('88880000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal(
     (select id from tmp_hotel_corrected), 'approve', 1,
     jsonb_build_object(
       'name', jsonb_build_object('es', 'Hotel Con Correccion (editado)'),
       'room_types', jsonb_build_array(jsonb_build_object(
         'kind', 'private', 'name', jsonb_build_object('es', 'Privada'), 'capacity', 2, 'price_cop', 110000
       ))
     )
   )->>'ok'),
  'true',
  'approbation avec correction admin (room_types SANS photos, comme le formulaire réel) réussit'
);
select is(
  (select array_agg(rm.storage_path)
     from room_media rm
     join product_room_types prt on prt.id = rm.room_type_id
     join product_proposals pp on pp.product_id = prt.product_id
    where pp.id = (select id from tmp_hotel_corrected)),
  array['rooms/private-1.webp'],
  'la photo de la proposition ORIGINALE survit malgré une correction admin qui l''omet'
);
select is(
  (select price_cop from product_room_types prt join product_proposals pp on pp.product_id = prt.product_id
    where pp.id = (select id from tmp_hotel_corrected)),
  110000::bigint,
  'la correction admin (prix) est bien appliquée par ailleurs'
);

-- camp : tag_ids désormais autorisé (retour Jérôme 2026-08-18, "servicios incluidos") -------------
select test_login('88880000-0000-4000-8000-000000000021');
create temp table tmp_camp as
  select (submit_product_creation_proposal(
    '88880000-0000-4000-8000-000000000011'::uuid, 'camp',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Campamento Aprobado'),
      'price_cop', 250000, 'duration_days', 3,
      'tag_ids', jsonb_build_array('88880000-0000-4000-8000-000000000041')
    )
  )->>'proposal_id')::uuid as id;

select test_login('88880000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_camp), 'approve', 1)->>'ok'),
  'true',
  'approbation de la création camp réussit'
);
select is(
  (select count(*) from product_tag_assignments pta join product_proposals pp on pp.product_id = pta.product_id
    where pp.id = (select id from tmp_camp) and pta.tag_id = '88880000-0000-4000-8000-000000000041')::int,
  1,
  'camp : product_tag_assignments contient le tag proposé (servicios incluidos)'
);

-- lodging : capacity + stay_rates + tramos de prix ---------------------------------------------
select test_login('88880000-0000-4000-8000-000000000021');
create temp table tmp_lodging as
  select (submit_product_creation_proposal(
    '88880000-0000-4000-8000-000000000011'::uuid, 'lodging',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Alojamiento Aprobado'),
      'capacity', 8,
      'price_tiers', jsonb_build_array(
        jsonb_build_object('min_qty', 1, 'max_qty', 4, 'price_cop', 200000),
        jsonb_build_object('min_qty', 5, 'max_qty', 8, 'price_cop', 320000)
      ),
      'price_cop', 200000,
      'stay_rates', jsonb_build_object(
        'season', jsonb_build_object('months', jsonb_build_array(12), 'surcharge_pct', 0.2, 'note', null),
        'weekend_days', jsonb_build_array(5, 6), 'weekend_surcharge_pct', 0.1,
        'includes', jsonb_build_array(), 'deposit_cop', null, 'extra_note', null
      )
    )
  )->>'proposal_id')::uuid as id;

select test_login('88880000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_lodging), 'approve', 1)->>'ok'),
  'true',
  'approbation de la création lodging réussit'
);
select is(
  (select jsonb_build_object('capacity', p.capacity, 'price_cop', p.price_cop, 'has_stay_rates', p.stay_rates is not null)
     from product_proposals pp join products p on p.id = pp.product_id
    where pp.id = (select id from tmp_lodging)),
  jsonb_build_object('capacity', 8, 'price_cop', 200000, 'has_stay_rates', true),
  'products (lodging) porte capacity/price_cop (plus bas tramo)/stay_rates'
);

-- Rejet d'une création : aucun produit créé, product_id reste null ---------------------------------
select test_login('88880000-0000-4000-8000-000000000021');
create temp table tmp_rejected as
  select (submit_product_creation_proposal(
    '88880000-0000-4000-8000-000000000014'::uuid, 'transport', jsonb_build_object('name', jsonb_build_object('es', 'Rechazado'), 'price_cop', 15000)
  )->>'proposal_id')::uuid as id;

select test_login('88880000-0000-4000-8000-000000000024');
select lives_ok(
  $$ select moderate_product_proposal((select id from tmp_rejected), 'reject', 1, null, 'No cumple los estándares') $$,
  'rejet d''une création avec motif réussit'
);
select is(
  (select jsonb_build_object('status', status, 'product_id', product_id) from product_proposals where id = (select id from tmp_rejected)),
  jsonb_build_object('status', 'rejected', 'product_id', null),
  'proposition rejetée : status=rejected, product_id reste null (aucune fiche créée)'
);

-- create_product_from_proposal n'est jamais appelable directement (pas de grant execute) -----------
select test_login('88880000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select create_product_from_proposal(
       '88880000-0000-4000-8000-000000000001'::uuid, '88880000-0000-4000-8000-000000000011'::uuid,
       'activity', jsonb_build_object('name', jsonb_build_object('es', 'Direct'))
     ) $$,
  '42501'::char(5), null,
  'create_product_from_proposal appelée directement par authenticated échoue en permission denied (aucun grant execute)'
);

select * from finish();
rollback;
