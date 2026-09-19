-- Transport informatif (migration 20260916150000, demande Jérôme du 2026-09-16) — LE test qui
-- manquait à chaque fois.
--
-- Ces 9 colonnes traversent une whitelist jsonb (submit_product_creation_proposal /
-- submit_product_proposal) PUIS un insert ou un update explicite (create_product_from_proposal /
-- moderate_product_proposal). Un oubli dans l'une quelconque des quatre jette la valeur EN
-- SILENCE : aucune erreur, aucun type qui rougit, juste une donnée qui n'arrive jamais en base.
-- Aucun test TypeScript ne peut voir ça — la perte se produit entièrement côté Postgres. C'est
-- exactement la classe de panne qui a coûté trois migrations correctives à ce projet
-- (`unit_count`, `lodging_kind`, puis `external_booking_url`/`price_label`).
--
-- Il couvre aussi les deux choses qu'on ne peut prouver qu'ici :
--   * la FORME GARDÉE (`?`) de moderate_product_proposal — une proposition créée avant la
--     migration ne porte pas ces clés et ne doit RIEN effacer ;
--   * le retrait de `address`/`lat`/`lon` de la whitelist transport, sans quoi la double source de
--     vérité que les colonnes dédiées ferment se reformerait par le chemin socio.
begin;
select plan(20);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('77770000-0000-4000-8000-000000000001', 'Transporte Test');

insert into establishments (id, partner_id, name) values
  ('77770000-0000-4000-8000-000000000011', '77770000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Transportadora Test'));

insert into auth.users (id, email) values
  ('77770000-0000-4000-8000-000000000021', 'transporte-socio@test.local'),
  ('77770000-0000-4000-8000-000000000024', 'transporte-admin@test.local');

update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000001'
 where id = '77770000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('77770000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. CRÉATION par un socio : whitelist de submit_product_creation_proposal
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('77770000-0000-4000-8000-000000000021');
create temp table tmp_create as
  select (submit_product_creation_proposal(
    '77770000-0000-4000-8000-000000000011'::uuid, 'transport',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Bus compartido de prueba'),
      'price_cop', 80000,
      'transport_first_departure_time', '07:00',
      'transport_last_departure_time', '07:45',
      'transport_seats_per_departure', 40,
      'transport_departure_address', 'Parque de El Poblado, Medellín',
      'transport_departure_lat', 6.2077,
      'transport_departure_lon', -75.5673,
      'transport_arrival_address', 'Parque Principal, Guatapé',
      'transport_arrival_lat', 6.2326,
      'transport_arrival_lon', -75.1592,
      'transport_contact_phone', '+573001112233',
      -- Volontairement présents dans l'entrée : ils doivent être JETÉS par la whitelist, un
      -- transport n'utilisant plus le trio générique.
      'address', 'NO DEBE PASAR',
      'lat', 1.111,
      'lon', 2.222
    )
  )->>'proposal_id')::uuid as id;

select is(
  -- On soustrait tout ce qui est légitimement whitelisté pour un transport par ailleurs (nom,
  -- photos, tags, prix, bornes de quantité, cupo, vitrine) : ce qui RESTE doit être exactement les
  -- 9 clés de ce lot, ni plus ni moins.
  (select payload - 'name' - 'description' - 'photos' - 'tag_ids' - 'price_cop' - 'price_tiers'
                  - 'min_qty' - 'max_qty' - 'default_capacity' - 'external_booking_url' - 'price_label'
     from product_proposals where id = (select id from tmp_create)),
  jsonb_build_object(
    'transport_first_departure_time', '07:00',
    'transport_last_departure_time', '07:45',
    'transport_seats_per_departure', 40,
    'transport_departure_address', 'Parque de El Poblado, Medellín',
    'transport_departure_lat', 6.2077,
    'transport_departure_lon', -75.5673,
    'transport_arrival_address', 'Parque Principal, Guatapé',
    'transport_arrival_lat', 6.2326,
    'transport_arrival_lon', -75.1592,
    'transport_contact_phone', '+573001112233'
  ),
  'création : les 10 clés transport traversent la whitelist, et RIEN d''autre'
);

select ok(
  (select not (payload ? 'address' or payload ? 'lat' or payload ? 'lon')
     from product_proposals where id = (select id from tmp_create)),
  'création : address/lat/lon sont JETÉS pour un transport (plus de double source de vérité)'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. APPROBATION de la création : insert de create_product_from_proposal
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('77770000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_create), 'approve', 1)->>'ok'),
  'true',
  'approbation de la création transport réussit'
);

create temp table tmp_produit as
  select product_id as id from product_proposals where id = (select id from tmp_create);

select is(
  (select jsonb_build_object(
            'first', p.transport_first_departure_time::text,
            'last', p.transport_last_departure_time::text,
            'seats', p.transport_seats_per_departure,
            'dep_addr', p.transport_departure_address,
            'dep_lat', p.transport_departure_lat,
            'dep_lon', p.transport_departure_lon,
            'arr_addr', p.transport_arrival_address,
            'arr_lat', p.transport_arrival_lat,
            'arr_lon', p.transport_arrival_lon,
            'tel', p.transport_contact_phone)
     from products p where p.id = (select id from tmp_produit)),
  jsonb_build_object(
    'first', '07:00:00', 'last', '07:45:00', 'seats', 40,
    'dep_addr', 'Parque de El Poblado, Medellín', 'dep_lat', 6.2077, 'dep_lon', -75.5673,
    'arr_addr', 'Parque Principal, Guatapé', 'arr_lat', 6.2326, 'arr_lon', -75.1592,
    'tel', '+573001112233'),
  'approbation : les 10 colonnes atterrissent réellement sur products'
);

select ok(
  (select address is null and lat is null and lon is null
     from products where id = (select id from tmp_produit)),
  'approbation : le trio générique reste NULL sur un transport'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. ÉDITION par le socio : whitelist de submit_product_proposal, puis update gardé de moderate
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('77770000-0000-4000-8000-000000000021');
create temp table tmp_edit as
  select (submit_product_proposal(
    (select id from tmp_produit),
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Bus compartido de prueba'),
      -- ⚠️ price_cop OBLIGATOIRE dans un payload d'édition : moderate_product_proposal l'écrit
      -- INCONDITIONNELLEMENT (forme héritée), donc l'omettre le mettrait à null et violerait
      -- `products_price_cop_required_unless_vitrine`. Rien à voir avec ce lot — c'est le contrat
      -- existant du chemin d'édition.
      'price_cop', 80000,
      'transport_first_departure_time', '06:30',
      'transport_last_departure_time', '06:30',
      'transport_seats_per_departure', 25,
      'transport_departure_address', 'Carrera 70, Laureles, Medellín',
      'transport_departure_lat', 6.2530,
      'transport_departure_lon', -75.5900,
      'transport_arrival_address', 'Malecón, Guatapé',
      'transport_arrival_lat', 6.2340,
      'transport_arrival_lon', -75.1600
    )
  )->>'proposal_id')::uuid as id;

select ok(
  (select payload ? 'transport_first_departure_time'
      and payload ? 'transport_seats_per_departure'
      and payload ? 'transport_arrival_lon'
     from product_proposals where id = (select id from tmp_edit)),
  'édition : les clés transport traversent aussi la whitelist du chemin de MODIFICATION'
);

select test_login('77770000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_edit), 'approve', 1)->>'ok'),
  'true',
  'approbation de l''édition transport réussit'
);

select is(
  (select jsonb_build_object(
            'first', p.transport_first_departure_time::text,
            'last', p.transport_last_departure_time::text,
            'seats', p.transport_seats_per_departure,
            'dep_addr', p.transport_departure_address,
            'arr_addr', p.transport_arrival_address)
     from products p where p.id = (select id from tmp_produit)),
  jsonb_build_object('first', '06:30:00', 'last', '06:30:00', 'seats', 25,
                     'dep_addr', 'Carrera 70, Laureles, Medellín', 'arr_addr', 'Malecón, Guatapé'),
  'édition : les nouvelles valeurs remplacent les anciennes (et first = last est accepté)'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. FORME GARDÉE : une proposition qui NE PORTE PAS ces clés ne doit RIEN effacer.
--    C'est le cas d'une proposition `pending` créée AVANT la migration, ou d'une simple
--    correction de nom. Une écriture inconditionnelle (`->>` seul) effacerait les horaires.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('77770000-0000-4000-8000-000000000021');
create temp table tmp_edit_nu as
  select (submit_product_proposal(
    (select id from tmp_produit),
    jsonb_build_object('name', jsonb_build_object('es', 'Solo cambio de nombre'),
                       'price_cop', 80000)
  )->>'proposal_id')::uuid as id;

select test_login('77770000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_edit_nu), 'approve', 1)->>'ok'),
  'true',
  'approbation d''une édition sans clés transport réussit'
);

select is(
  (select jsonb_build_object(
            'first', p.transport_first_departure_time::text,
            'seats', p.transport_seats_per_departure,
            'arr_addr', p.transport_arrival_address)
     from products p where p.id = (select id from tmp_produit)),
  jsonb_build_object('first', '06:30:00', 'seats', 25, 'arr_addr', 'Malecón, Guatapé'),
  'FORME GARDÉE : une proposition sans ces clés n''efface NI les horaires NI les lieux'
);

-- Le téléphone est le pivot du lot du 2026-09-17 : l'effacer par accident remettrait un calendrier
-- sur la fiche (plus d'URL de contact → le mode retombe sur « date »). Sauf que non, justement :
-- le repli sur le WhatsApp de Hifago vit côté app, pas en base. Cette assertion vérifie quand même
-- que la colonne survit, parce qu'un transporteur qui perd SON numéro reçoit les messages de Hifago
-- sans que personne ne s'en aperçoive.
select is(
  (select transport_contact_phone from products where id = (select id from tmp_produit)),
  '+573001112233',
  'FORME GARDÉE : le téléphone du transporteur survit aussi'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. Le chemin mockData : create_product_from_proposal appelée DIRECTEMENT
--    (supabase/scripts/seed-mock-data.mjs fait exactement cet appel, pour tous les types).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Temp table plutôt qu'un appel dans le WHERE : la fonction est VOLATILE, un WHERE peut la
-- réévaluer et créerait alors plusieurs produits.
create temp table tmp_mock as
  select create_product_from_proposal(
    '77770000-0000-4000-8000-000000000001'::uuid,
    '77770000-0000-4000-8000-000000000011'::uuid,
    'transport',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Transporte mockData'),
      'price_cop', 20000,
      'transport_first_departure_time', '14:00',
      'transport_last_departure_time', '14:00',
      'transport_seats_per_departure', 12,
      'transport_departure_address', 'Parque Principal, Guatapé'
    )) as id;

select is(
  (select jsonb_build_object('seats', p.transport_seats_per_departure,
                             'first', p.transport_first_departure_time::text,
                             'dep_addr', p.transport_departure_address)
     from products p where p.id = (select id from tmp_mock)),
  jsonb_build_object('seats', 12, 'first', '14:00:00', 'dep_addr', 'Parque Principal, Guatapé'),
  'chemin mockData : create_product_from_proposal appelée directement écrit bien les colonnes'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F. Les 6 CHECK — la base refuse ce que l'écran refuse déjà (CLAUDE.md §11.20)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Tout produit créé plus haut dans ce fichier est 'transport' — le premier CHECK ci-dessous cible
-- `where type = 'activity'` sans qu'AUCUNE ligne n'y corresponde jamais : l'UPDATE touchait donc
-- zéro ligne, ne levait rien, et `throws_ok` échouait pour une raison sans rapport avec le CHECK
-- lui-même (trouvé le 2026-09-19, masqué jusque-là par un job CI en échec en amont qui empêchait
-- celui-ci de tourner). Fixture minimale, dédiée à cette seule assertion.
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop) values
  ('77770000-0000-4000-8000-000000000098', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad no transporte'), 'transport-check-no-transporte', true, 30000);

select throws_ok(
  $$ update products set transport_first_departure_time = '07:00',
                         transport_last_departure_time = '07:45'
      where type = 'activity' $$,
  23514,
  null,
  'CHECK : un produit NON transport ne peut pas porter ces colonnes'
);

select throws_ok(
  format($$ update products set transport_first_departure_time = '09:00',
                                transport_last_departure_time = '07:00'
             where id = %L $$, (select id from tmp_produit)),
  23514,
  null,
  'CHECK : dernière salida antérieure à la première refusée'
);

select throws_ok(
  format($$ update products set transport_seats_per_departure = 0 where id = %L $$,
         (select id from tmp_produit)),
  23514,
  null,
  'CHECK : 0 place par salida refusé'
);

select throws_ok(
  format($$ update products set transport_last_departure_time = null where id = %L $$,
         (select id from tmp_produit)),
  23514,
  null,
  'CHECK : une seule des deux bornes horaires refusée'
);

select throws_ok(
  format($$ update products set transport_departure_lon = null where id = %L $$,
         (select id from tmp_produit)),
  23514,
  null,
  'CHECK : latitude de salida sans longitude refusée'
);

select throws_ok(
  format($$ update products set transport_arrival_lat = null where id = %L $$,
         (select id from tmp_produit)),
  23514,
  null,
  'CHECK : longitude de llegada sans latitude refusée'
);

select throws_ok(
  format($$ update products set transport_contact_phone = '0300111' where id = %L $$,
         (select id from tmp_produit)),
  23514,
  null,
  'CHECK : un téléphone hors format E.164 est refusé'
);

-- Le cas NORMAL, celui qui justifie `>=` plutôt que `>` : un transfert privé part à heure fixe.
select lives_ok(
  format($$ update products set transport_first_departure_time = '16:15',
                                transport_last_departure_time = '16:15'
             where id = %L $$, (select id from tmp_produit)),
  'first = last est ACCEPTÉ — une salida unique n''est pas une erreur de saisie'
);

select * from finish();
rollback;
