-- Transport : fenêtre de départs, places annoncées par départ, et DEUX lieux (départ + arrivée)
-- — demande Jérôme du 2026-09-16.
--
-- ⚠️ CE QUE CETTE MIGRATION N'EST PAS. Les trois champs d'horaire/places sont PUREMENT INFORMATIFS :
-- aucune RPC ne les lit, ils ne décrémentent rien, ils ne rendent pas un transport réservable à
-- l'heure. Ce ne sont surtout PAS des `product_slot_rules` — cette table-là rend `create_order`
-- bloquant (refus `slot_required` dès qu'un produit porte une règle, spec 18 §0), ce qui changerait
-- le parcours de réservation du transport. Le cupo réel d'un transport reste `default_capacity`,
-- par date, exactement comme avant. Décision explicite de Jérôme : « c'est à titre informatif pour
-- la personne qui réserve ».
--
-- CE QU'ELLE RÉVOQUE. `docs/specs/14-admin-transporte.md` (statut `implemente`, 2026-08-16) affirmait
-- « Aucune migration » (§0) et mettait « Toute donnée d'horaires structurée » hors périmètre (§2 Out),
-- et qualifiait `products.address`/`lat`/`lon` de « point de départ » d'un transport (§2 In, §4 pt 3).
-- Les trois sont révoquées par l'amendement daté du 2026-09-16 en tête de cette spec — jamais en
-- silence (hifago/CLAUDE.md §1.2 : une spec `implemente` fait foi tant qu'elle n'est pas amendée).
--
-- ANCRAGE LEGACY (« refaire pas réinventer »). Ces informations existaient déjà en production, mais
-- FIGÉES DANS LE CODE : `public/reservar.js:176` du dépôt parent porte `transport_info_html`
-- (« salidas … desde el Parque de El Poblado o la Carrera 70 (Laureles) a las 7:00 y 7:45 »), avec
-- son miroir lecture seule assumé dans `public/admin.html:755`. Personne ne pouvait les modifier
-- sans déployer. Ce lot les sort du code pour les rendre éditables depuis le backoffice.
--
-- POURQUOI DES COLONNES DE DÉPART DÉDIÉES plutôt que réutiliser `address`/`lat`/`lon` (arbitrage
-- Jérôme sur la première version du plan) : un trajet a DEUX extrémités, et une seule convention de
-- nommage doit porter un seul concept. `transport_departure_*` fait donc face à
-- `transport_arrival_*`, et le trio générique n'est plus ni exposé ni utilisé pour ce type — d'où
-- la migration de données plus bas, et le retrait de `transport` du bloc `address`/`lat`/`lon` des
-- whitelists de proposition.
--
-- FRONTIÈRE §3 : RLS DIRECTE, PAS RPC-only. Aucune de ces 9 colonnes n'est capacitaire — la
-- quantité est descriptive, ne décrémente rien, aucun compteur, aucun verrou optimiste, aucune
-- lecture d'une autre identité. Aucun des 4 critères RPC-only de hifago/CLAUDE.md §3.1 ne
-- s'applique, donc §3.2 : `products_write_admin` (existante) couvre déjà la ligne entière — même
-- raisonnement que 20260816090000 (lieu d'une activité) et 20260914130000 (remise de groupe).
-- Aucune policy nouvelle, aucun grant nouveau (`products` n'a pas de grant colonne par colonne,
-- contrairement à `establishments`). Aucun test de concurrence : §4.1 ne s'applique pas — ce n'est
-- pas un oubli, il n'y a rien à sérialiser.

alter table public.products
  add column transport_first_departure_time time,
  add column transport_last_departure_time  time,
  add column transport_seats_per_departure  integer,
  add column transport_departure_address    text,
  add column transport_departure_lat        double precision,
  add column transport_departure_lon        double precision,
  add column transport_arrival_address      text,
  add column transport_arrival_lat          double precision,
  add column transport_arrival_lon          double precision,

  -- Portée imposée EN BASE, pas seulement dans le gating de l'UI — même geste que
  -- products_group_discount_camp_only (20260914130000).
  add constraint products_transport_info_transport_only
    check (type = 'transport' or (
      transport_first_departure_time is null and transport_last_departure_time is null
      and transport_seats_per_departure is null
      and transport_departure_address is null and transport_departure_lat is null
      and transport_departure_lon is null
      and transport_arrival_address is null and transport_arrival_lat is null
      and transport_arrival_lon is null)),

  -- Les deux bornes ensemble ou aucune (forme de products_group_discount_pair).
  add constraint products_transport_departure_pair
    check ((transport_first_departure_time is null) = (transport_last_departure_time is null)),

  -- ⚠️ `>=`, PAS `>` — DIVERGENCE DÉLIBÉRÉE avec product_slot_rules_time_order
  -- (`end_time > start_time`, 20260816091000). Là-bas le strict est OBLIGATOIRE : une fenêtre doit
  -- contenir au moins un créneau de `slot_duration_minutes`. Ici il n'y a rien à découper, et
  -- `first = last` est le cas NORMAL d'un départ unique (un transfert privé à 14:00 ; le legacy
  -- annonce « a las 7:00 y 7:45 », donc deux départs, mais tous n'en ont pas deux). NE PAS
  -- « harmoniser » les deux contraintes : elles ne disent pas la même chose.
  -- Effet de bord assumé : un service de nuit (22:00 → 02:00) est impossible. Aucun transport réel
  -- n'est dans ce cas aujourd'hui ; à la première demande, la réponse est d'ouvrir une seconde
  -- plage (donc de rouvrir la décision « un seul intervalle »), pas de retirer ce CHECK.
  add constraint products_transport_departure_order
    check (transport_last_departure_time is null
           or transport_last_departure_time >= transport_first_departure_time),

  add constraint products_transport_seats_positive
    check (transport_seats_per_departure is null or transport_seats_per_departure > 0),

  -- Discipline posée sur les colonnes NEUVES seulement : le trio générique address/lat/lon n'a
  -- jamais eu cette contrainte et on ne la rétrofit pas ici (ça toucherait activity/lodging, et une
  -- ligne à moitié remplie en préprod ferait échouer la migration — sujet à part).
  add constraint products_transport_departure_coords_pair
    check ((transport_departure_lat is null) = (transport_departure_lon is null)),
  add constraint products_transport_arrival_coords_pair
    check ((transport_arrival_lat is null) = (transport_arrival_lon is null));

-- MIGRATION DE DONNÉES — obligatoire, et dans la même transaction que le DDL ci-dessus.
-- `address`/`lat`/`lon` porte AUJOURD'HUI le point de départ des transports (spec 14 §2/§4, les 6
-- fichiers de mockData/transport/, l'e2e admin-product-transport.spec.ts). 7 transports en base
-- locale au 2026-09-16, la préprod est concernée aussi. Sans ce transfert, tous perdraient leur
-- lieu de départ à l'instant où le formulaire cesse d'exposer le trio générique.
update public.products
   set transport_departure_address = address,
       transport_departure_lat     = lat,
       transport_departure_lon     = lon
 where type = 'transport';

-- Second `update` DÉLIBÉRÉ : laisser le trio générique rempli en parallèle créerait deux sources de
-- vérité pour le même lieu — exactement ce que les colonnes dédiées viennent fermer. Même
-- transaction que le transfert ci-dessus, donc aucune fenêtre où la donnée serait perdue.
-- Pas de CHECK qui INTERDISE `address` sur un transport : la colonne reste générique et légitime
-- (un jour l'adresse de l'agence du transporteur, par exemple), et un CHECK la fermerait
-- définitivement. Le garde-fou est ailleurs, et il est mécanique (CLAUDE.md §11.20) : le formulaire
-- ne l'expose plus pour ce type, et l'e2e assert son absence — même geste que l'assertion existante
-- sur `check-in-input`.
update public.products
   set address = null, lat = null, lon = null
 where type = 'transport';

comment on column public.products.transport_first_departure_time is
  'Première heure de la fenêtre de départs quotidienne d''un transport. INFORMATIF : ce n''est PAS '
  'un créneau réservable — product_slot_rules est délibérément écarté (il rendrait create_order '
  'bloquant via le refus slot_required, spec 18 §0). Le cupo réel d''un transport reste '
  'products.default_capacity, par date. Heure opaque « HH:MM » : jamais combinée à une date en '
  'objet Date JS, qui serait interprété dans le fuseau du navigateur visiteur et pas celui de '
  'Bogota (spec 18 §0, CLAUDE.md §11.20).';

comment on column public.products.transport_seats_per_departure is
  'Nombre de places ANNONCÉES par départ (« 40 plazas por salida »). Purement descriptif : ne '
  'décrémente rien, aucun compteur, jamais lu par create_order. NE PAS le renommer en *_capacity — '
  'son voisin default_capacity, lui, BLOQUE la vente (verrou product_availability).';

comment on column public.products.transport_departure_address is
  'Lieu de DÉPART d''un transport, face à transport_arrival_address. Le trio générique '
  'address/lat/lon n''est PLUS utilisé pour type=''transport'' depuis cette migration (données '
  'transférées ici, whitelists de proposition ajustées) — cf. l''amendement daté du 2026-09-16 de '
  'docs/specs/14-admin-transporte.md §4.';

-- Les 4 RPC de proposition, recréées depuis leur définition VIVANTE (pg_get_functiondef) et
-- modifiées par occurrences comptées — jamais retapées à la main (.claude/rules/supabase.md pt 7).
-- Signatures inchangées, donc `create or replace` suffit : pas de `drop function`, aucun grant à
-- reposer. Les quatre sont nécessaires, pas seulement celles du socio : le chemin mockData passe
-- par create_product_from_proposal (supabase/scripts/seed-mock-data.mjs), et en faire 2 sur 4 est
-- strictement pire que 0 — le champ se remplirait à la création puis disparaîtrait à la première
-- modification.

CREATE OR REPLACE FUNCTION public.submit_product_creation_proposal(p_establishment_id uuid, p_type text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_safe_photos jsonb;
  v_lobby_connector_active boolean;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_type not in ('activity', 'evento', 'camp', 'lodging', 'transport') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  if v_partner_id is null or not exists (
    select 1 from public.establishments where id = p_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if (
    select count(*) from public.product_proposals where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;

  -- Ajout de cette migration (20260916140000) : plafond serveur du programme, exactement le motif
  -- de gallery_cap_exceeded. La whitelist ci-dessous ne valide AUCUNE forme — sans ce garde-fou un
  -- socio peut poster plusieurs Mo de JSONB dans product_proposals.payload, qui n'a lui-même
  -- aucune limite de taille. Le plafond par ligne, la borne sur le jour et l'obligation d'un texte
  -- espagnol restent côté app (apps/admin/lib/products/program.ts, testé) : ici on ne borne que
  -- l'abus grossier, le seul que la base puisse constater sans dupliquer la validation métier.
  if jsonb_typeof(p_payload -> 'program') = 'array' and jsonb_array_length(p_payload -> 'program') > 200 then
    return jsonb_build_object('ok', false, 'reason', 'program_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  select lobby_connector_active into v_lobby_connector_active
    from public.establishments where id = p_establishment_id;

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description', 'photos', v_safe_photos
    )
    -- 2026-09-16 (transport informatif) : `transport` RETIRÉ de ce bloc. Un trajet a DEUX
    -- extrémités, donc ses propres colonnes dédiées (transport_departure_*/transport_arrival_*,
    -- bloc ajouté plus bas) ; laisser le trio générique whitelisté pour lui recréerait la double
    -- source de vérité que ces colonnes viennent précisément fermer — une proposition résiduelle
    -- reposerait `address` sur un transport au moment de l'approuver.
    || case when p_type in ('activity', 'lodging') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    || case when p_type in ('activity', 'lodging', 'transport', 'camp') then jsonb_build_object(
         'tag_ids', coalesce(p_payload -> 'tag_ids', '[]'::jsonb)
       ) else '{}'::jsonb end
    || case when p_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_cop', p_payload -> 'price_cop', 'price_tiers', p_payload -> 'price_tiers',
         'min_qty', p_payload -> 'min_qty', 'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    -- Ajout de cette migration (20260914140000) : group_discount_threshold_qty/group_discount_pct
    -- rejoignent le bloc whitelist camp déjà existant — même geste que duration_days.
    || case when p_type = 'camp' then
         jsonb_build_object(
           'price_cop', p_payload -> 'price_cop', 'duration_days', p_payload -> 'duration_days',
           'group_discount_threshold_qty', p_payload -> 'group_discount_threshold_qty',
           'group_discount_pct', p_payload -> 'group_discount_pct',
           -- Ajout de cette migration (20260916140000) : le programme rejoint le bloc camp déjà
           -- existant — même geste que group_discount_* en 20260914140000. Une clé absente d'ici
           -- est SILENCIEUSEMENT jetée, donc création et édition DOIVENT whitelister les mêmes
           -- clés, sinon le programme se remplirait à la création puis disparaîtrait à la première
           -- modification (précédent vécu : unit_count, lodging_kind, external_booking_url).
           'program', p_payload -> 'program'
         )
       else '{}'::jsonb end
    || case when p_type = 'lodging' then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`
    -- rejoint la whitelist des logements. Une clé absente d'ici est SILENCIEUSEMENT jetée — c'est
    -- exactement le rôle de cette whitelist — donc l'oublier ferait disparaître le type de couchage
    -- entre le formulaire du socio et la proposition enregistrée, sans erreur nulle part.
    || case when p_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind', 'unit', p_payload -> 'unit',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    || case when p_type in ('activity', 'camp', 'transport') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- 2026-09-16 (transport informatif, demande Jérôme) : fenêtre de départs quotidienne, places
    -- annoncées par départ, et les DEUX lieux dédiés. ⚠️ PUREMENT INFORMATIFS — aucune RPC ne les
    -- lit, ils ne décrémentent rien, et ce ne sont surtout pas des `slot_rules` (bloc juste en
    -- dessous, activity seulement), qui rendraient `create_order` bloquant via le refus
    -- `slot_required`. Le cupo réel d'un transport reste `default_capacity`, par date.
    -- Whitelistés pour le socio sans restriction : un transporteur est précisément la personne qui
    -- connaît ses horaires.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, pas un `jsonb_build_object` des 9 clés.
    -- `jsonb_build_object('k', p_payload -> 'k')` produit `{"k": null}` quand la clé est absente
    -- de l'entrée : la clé EXISTE alors dans le payload enregistré, avec la valeur null. Le `?` de
    -- la forme gardée de moderate_product_proposal répondrait « présente » et écrirait ce null —
    -- donc EFFACERAIT les horaires déjà posés, ce que la forme gardée existe précisément pour
    -- empêcher (prouvé par transport_departure_info_proposal_parity.test.sql).
    -- Ici : clé absente ⇒ rien n'entre ⇒ moderate conserve l'existant. Clé présente à null ⇒ elle
    -- entre ⇒ moderate efface, ce qui est bien une demande explicite du prestataire.
    || case when p_type = 'transport'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'transport_first_departure_time', 'transport_last_departure_time',
             'transport_seats_per_departure',
             'transport_departure_address', 'transport_departure_lat', 'transport_departure_lon',
             'transport_arrival_address', 'transport_arrival_lat', 'transport_arrival_lon'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    || case when p_type = 'activity' then
         jsonb_build_object('slot_rules', coalesce(p_payload -> 'slot_rules', '[]'::jsonb))
       else '{}'::jsonb end
    -- 2026-09-09 : la VITRINE n'est plus réservée aux eventos. `external_booking_url` est le
    -- mécanisme de vitrine (cahier §2e, spec 30 §3.1) et la contrainte
    -- `products_price_cop_required_unless_vitrine` l'accepte depuis le 2026-09-08 pour TOUS les
    -- types — mais cette whitelist les jetait silencieusement hors evento, donc l'URL saisie par un
    -- socio disparaissait entre son formulaire et la proposition enregistrée, sans erreur nulle
    -- part. `price_label` l'accompagne : sans lui, une vitrine sans prix chiffré n'aurait rien à
    -- afficher. Le bloc `evento` ci-dessous garde les siens (il porte aussi ses occurrences).
    || case when p_type <> 'evento' then jsonb_build_object(
         'external_booking_url', p_payload -> 'external_booking_url',
         'price_label', p_payload -> 'price_label'
       ) else '{}'::jsonb end
    || case when p_type = 'evento' then jsonb_build_object(
         'price_label', p_payload -> 'price_label', 'occurrence_type', p_payload -> 'occurrence_type',
         'occurrence_date', p_payload -> 'occurrence_date',
         'recurrence_frequency_days', p_payload -> 'recurrence_frequency_days',
         'recurrence_end_date', p_payload -> 'recurrence_end_date',
         'recurrence_end_count', p_payload -> 'recurrence_end_count',
         'start_time', p_payload -> 'start_time', 'duration_minutes', p_payload -> 'duration_minutes',
         'external_booking_url', p_payload -> 'external_booking_url'
       ) else '{}'::jsonb end
    -- Refonte LobbyPMS (2026-08-25) : uniquement si l'établissement est déjà connecté — jamais un
    -- ID Lobby arbitraire sur un établissement non connecté (cf. commentaire de tête).
    || case when p_type = 'lodging' and coalesce(v_lobby_connector_active, false) then
         jsonb_build_object('lobby_category_id', nullif(p_payload ->> 'lobby_category_id', '')::int)
       else '{}'::jsonb end
    -- Élargi le 2026-08-26 de 'activity' seul à ('activity', 'transport') — cf. commentaire de tête
    -- de ce fichier pour le raisonnement complet (evento/camp restent exclus, incompatibilité
    -- structurelle avec addLobbyProductService, pas un simple oubli).
    || case when p_type in ('activity', 'transport') and coalesce(v_lobby_connector_active, false) then
         jsonb_build_object('lobby_product_id', nullif(p_payload ->> 'lobby_product_id', '')::int)
       else '{}'::jsonb end;

  insert into public.product_proposals
    (product_id, establishment_id, partner_id, submitted_by, kind, type, payload)
  values (null, p_establishment_id, v_partner_id, v_account_id, 'create', p_type, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_product_from_proposal(p_partner_id uuid, p_establishment_id uuid, p_type text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id uuid;
  v_slug_base text;
  v_slug text;
  v_suffix int := 1;
  v_tag_id text;
  v_slot jsonb;
  v_photo jsonb;
  v_sort int;
  v_default_capacity int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_product_from_proposal réservé au rôle admin' using errcode = '42501';
  end if;

  v_slug_base := public.slugify(coalesce(p_payload -> 'name' ->> 'es', 'producto'));
  if v_slug_base = '' then
    v_slug_base := 'producto';
  end if;
  v_slug := v_slug_base;
  while exists (select 1 from public.products where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  v_default_capacity := nullif(p_payload ->> 'default_capacity', '')::int;
  if p_type = 'lodging' and v_default_capacity is null then
    v_default_capacity := public.resolve_lodging_default_capacity(
      nullif(p_payload ->> 'lodging_kind', ''),
      nullif(p_payload ->> 'unit_count', '')::int,
      nullif(p_payload ->> 'capacity', '')::int
    );
  end if;

  insert into public.products (
    partner_id, establishment_id, type, name, description, slug, sellable,
    price_cop, price_tiers, min_qty, max_qty,
    address, lat, lon,
    check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates,
    duration_days,
    -- Ajout de cette migration (20260914140000) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans ces 2 colonnes ici, la remise configurée par un
    -- prestataire survivrait dans la proposition mais disparaîtrait à l'approbation.
    group_discount_threshold_qty, group_discount_pct,
    -- Ajout de cette migration (20260916140000) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans cette colonne ici, le programme saisi par un
    -- prestataire survivrait dans la proposition et disparaîtrait à l'approbation.
    program,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url,
    lobby_category_id, lobby_product_id,
    -- 2026-09-16 (transport informatif) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans ces 9 colonnes ici, les horaires et les deux lieux
    -- d'un transport survivraient dans la proposition mais disparaîtraient à l'approbation (le
    -- défaut déjà vécu pour unit_count, lodging_kind puis external_booking_url).
    transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure,
    transport_departure_address, transport_departure_lat, transport_departure_lon,
    transport_arrival_address, transport_arrival_lat, transport_arrival_lon
  )
  values (
    p_partner_id, p_establishment_id, p_type,
    p_payload -> 'name', p_payload -> 'description', v_slug,
    true,
    nullif(p_payload ->> 'price_cop', '')::bigint,
    p_payload -> 'price_tiers',
    nullif(p_payload ->> 'min_qty', '')::int,
    nullif(p_payload ->> 'max_qty', '')::int,
    p_payload ->> 'address',
    nullif(p_payload ->> 'lat', '')::double precision,
    nullif(p_payload ->> 'lon', '')::double precision,
    nullif(p_payload ->> 'check_in_time', '')::time,
    nullif(p_payload ->> 'check_out_time', '')::time,
    nullif(p_payload ->> 'capacity', '')::int,
    nullif(p_payload ->> 'unit_count', '')::int,
    nullif(p_payload ->> 'lodging_kind', ''),
    nullif(p_payload ->> 'unit', ''),
    v_default_capacity,
    p_payload -> 'stay_rates',
    nullif(p_payload ->> 'duration_days', '')::int,
    nullif(p_payload ->> 'group_discount_threshold_qty', '')::int,
    nullif(p_payload ->> 'group_discount_pct', '')::numeric,
    -- ⚠️ NORMALISÉ, jamais `p_payload -> 'program'` brut comme price_tiers/stay_rates au-dessus :
    -- un payload {"program": null} donne ici le littéral JSON `null` ('null'::jsonb) et NON un
    -- NULL SQL, et jsonb_typeof('null'::jsonb) = 'null' ferait échouer le CHECK
    -- products_program_is_array (20260916130000) sur TOUTE création de camp sans programme.
    -- Précédent exact : 20260818240000_fix_price_tiers_json_null.sql (11 produits pollués).
    case when jsonb_typeof(p_payload -> 'program') = 'array' then p_payload -> 'program' else null end,
    p_payload ->> 'price_label',
    p_payload ->> 'occurrence_type',
    nullif(p_payload ->> 'occurrence_date', '')::date,
    nullif(p_payload ->> 'recurrence_frequency_days', '')::int,
    nullif(p_payload ->> 'recurrence_end_date', '')::date,
    nullif(p_payload ->> 'recurrence_end_count', '')::int,
    nullif(p_payload ->> 'start_time', '')::time,
    nullif(p_payload ->> 'duration_minutes', '')::int,
    nullif(p_payload ->> 'external_booking_url', ''),
    nullif(p_payload ->> 'lobby_category_id', '')::int,
    nullif(p_payload ->> 'lobby_product_id', '')::int,
    -- Même ordre que la liste de colonnes ci-dessus. Les CHECK products_transport_* font échouer
    -- BRUYAMMENT un payload d'un autre type qui porterait ces clés — échec fermé voulu, pas un
    -- défaut : cette RPC insère pour tous les types depuis un seul `insert`.
    nullif(p_payload ->> 'transport_first_departure_time', '')::time,
    nullif(p_payload ->> 'transport_last_departure_time', '')::time,
    nullif(p_payload ->> 'transport_seats_per_departure', '')::int,
    nullif(p_payload ->> 'transport_departure_address', ''),
    nullif(p_payload ->> 'transport_departure_lat', '')::double precision,
    nullif(p_payload ->> 'transport_departure_lon', '')::double precision,
    nullif(p_payload ->> 'transport_arrival_address', ''),
    nullif(p_payload ->> 'transport_arrival_lat', '')::double precision,
    nullif(p_payload ->> 'transport_arrival_lon', '')::double precision
  )
  returning id into v_product_id;

  if jsonb_typeof(p_payload -> 'tag_ids') = 'array' then
    for v_tag_id in select * from jsonb_array_elements_text(p_payload -> 'tag_ids') loop
      insert into public.product_tag_assignments (product_id, tag_id) values (v_product_id, v_tag_id::uuid);
    end loop;
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' then
    v_sort := 0;
    for v_photo in select * from jsonb_array_elements(p_payload -> 'photos') loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_product_id, v_photo ->> 'storage_path', v_sort);
      v_sort := v_sort + 1;
    end loop;
  end if;

  if p_type = 'activity' and jsonb_typeof(p_payload -> 'slot_rules') = 'array' then
    for v_slot in select * from jsonb_array_elements(p_payload -> 'slot_rules') loop
      insert into public.product_slot_rules
        (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
      values (
        v_product_id,
        (select array_agg((w)::int order by (w)::int) from jsonb_array_elements_text(v_slot -> 'weekdays') w),
        (v_slot ->> 'start_time')::time,
        (v_slot ->> 'end_time')::time,
        (v_slot ->> 'slot_duration_minutes')::int,
        (v_slot ->> 'capacity')::int
      );
    end loop;
  end if;

  if p_type = 'lodging' and v_default_capacity is not null then
    perform public.open_default_lodging_availability(v_product_id);
  end if;

  perform public.log_admin_action(
    'product_proposal.approve_create', 'products', v_product_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'establishment_id', p_establishment_id, 'type', p_type),
    null
  );

  return v_product_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_product_proposal(p_product_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_establishment_id uuid;
  v_type text;
  v_proposal_id uuid;
  v_safe_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select establishment_id, type into v_establishment_id, v_type
    from public.products where id = p_product_id;

  -- Garde-fous 1+2 (identité + propriété) : produit inexistant ou d'un autre partenaire → même
  -- réponse "introuvable" dans les deux cas, jamais un refus explicite qui révèlerait l'existence
  -- du produit d'un tiers (cahier des charges socio §3d).
  if v_establishment_id is null or not exists (
    select 1 from public.establishments
     where id = v_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis, pas juste l'identité
  -- (correctif Tranche 1 — has_capability avec le 3e argument).
  if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  -- Plafond de propositions en attente (cahier des charges socio §3e).
  if (
    select count(*) from public.product_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  -- Ajout de cette migration (20260916140000) : plafond serveur du programme, exactement le motif
  -- de gallery_cap_exceeded. La whitelist ci-dessous ne valide AUCUNE forme — sans ce garde-fou un
  -- socio peut poster plusieurs Mo de JSONB dans product_proposals.payload, qui n'a lui-même
  -- aucune limite de taille. Le plafond par ligne, la borne sur le jour et l'obligation d'un texte
  -- espagnol restent côté app (apps/admin/lib/products/program.ts, testé) : ici on ne borne que
  -- l'abus grossier, le seul que la base puisse constater sans dupliquer la validation métier.
  if jsonb_typeof(p_payload -> 'program') = 'array' and jsonb_array_length(p_payload -> 'program') > 200 then
    return jsonb_build_object('ok', false, 'reason', 'program_cap_exceeded');
  end if;

  -- Whitelist par type — miroir exact du bloc `if (isEditing && product)` de ProductForm
  -- (product-form.tsx), jamais tags/photos/slot_rules (délégués à des blocs séparés à
  -- sauvegarde immédiate côté admin, jamais couverts par ce même submit là non plus).
  v_safe_payload := jsonb_build_object('name', p_payload -> 'name', 'description', p_payload -> 'description')
    -- 2026-09-16 (transport informatif) : `transport` RETIRÉ de ce bloc. Un trajet a DEUX
    -- extrémités, donc ses propres colonnes dédiées (transport_departure_*/transport_arrival_*,
    -- bloc ajouté plus bas) ; laisser le trio générique whitelisté pour lui recréerait la double
    -- source de vérité que ces colonnes viennent précisément fermer — une proposition résiduelle
    -- reposerait `address` sur un transport au moment de l'approuver.
    || case when v_type in ('activity', 'lodging') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    || case when v_type <> 'evento' then
         jsonb_build_object('price_cop', p_payload -> 'price_cop') else '{}'::jsonb end
    || case when v_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_tiers', p_payload -> 'price_tiers', 'min_qty', p_payload -> 'min_qty',
         'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    || case when v_type = 'lodging' then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`,
    -- miroir exact de submit_product_creation_proposal ci-dessus — création et édition doivent
    -- whitelister les MÊMES clés, sinon un champ se remplit à la création et disparaît à la
    -- première modification.
    || case when v_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind', 'unit', p_payload -> 'unit',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    || case when v_type in ('activity', 'camp', 'transport') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- Ajout de cette migration (20260914140000) : jusqu'ici aucun bloc dédié à camp au-delà de
    -- default_capacity (partagé avec activity/transport) dans ce chemin d'ÉDITION — miroir du bloc
    -- camp déjà présent dans submit_product_creation_proposal (création), même raisonnement.
    || case when v_type = 'camp' then
         jsonb_build_object(
           'group_discount_threshold_qty', p_payload -> 'group_discount_threshold_qty',
           'group_discount_pct', p_payload -> 'group_discount_pct',
           -- Ajout de cette migration (20260916140000) : le programme rejoint le bloc camp déjà
           -- existant — même geste que group_discount_* en 20260914140000. Une clé absente d'ici
           -- est SILENCIEUSEMENT jetée, donc création et édition DOIVENT whitelister les mêmes
           -- clés, sinon le programme se remplirait à la création puis disparaîtrait à la première
           -- modification (précédent vécu : unit_count, lodging_kind, external_booking_url).
           'program', p_payload -> 'program'
         )
       else '{}'::jsonb end
    -- 2026-09-09 : ces deux clés n'étaient whitelistées ici pour AUCUN type, evento compris — un
    -- socio ne pouvait donc pas corriger l'URL d'une vitrine qu'il avait lui-même proposée, ni son
    -- libellé de prix. Défaut antérieur à l'ouverture de la vitrine aux non-eventos, pas une
    -- régression de celle-ci. Whitelistées pour TOUS les types, exactement comme
    -- submit_product_creation_proposal ci-dessus : création et modification doivent whitelister les
    -- MÊMES clés, sinon un champ se remplit à la création et disparaît à la première modification
    -- (c'est la leçon déjà écrite pour `unit_count` et `lodging_kind`).
    -- 2026-09-16 (transport informatif) : miroir EXACT du bloc transport de
    -- submit_product_creation_proposal. Création et édition doivent whitelister les MÊMES clés,
    -- sinon un champ se remplit à la création et disparaît à la première modification — leçon déjà
    -- écrite ici pour unit_count, lodging_kind puis external_booking_url/price_label.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, pas un `jsonb_build_object` des 9 clés.
    -- `jsonb_build_object('k', p_payload -> 'k')` produit `{"k": null}` quand la clé est absente
    -- de l'entrée : la clé EXISTE alors dans le payload enregistré, avec la valeur null. Le `?` de
    -- la forme gardée de moderate_product_proposal répondrait « présente » et écrirait ce null —
    -- donc EFFACERAIT les horaires déjà posés, ce que la forme gardée existe précisément pour
    -- empêcher (prouvé par transport_departure_info_proposal_parity.test.sql).
    -- Ici : clé absente ⇒ rien n'entre ⇒ moderate conserve l'existant. Clé présente à null ⇒ elle
    -- entre ⇒ moderate efface, ce qui est bien une demande explicite du prestataire.
    || case when v_type = 'transport'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'transport_first_departure_time', 'transport_last_departure_time',
             'transport_seats_per_departure',
             'transport_departure_address', 'transport_departure_lat', 'transport_departure_lon',
             'transport_arrival_address', 'transport_arrival_lat', 'transport_arrival_lon'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    || jsonb_build_object(
         'external_booking_url', p_payload -> 'external_booking_url',
         'price_label', p_payload -> 'price_label'
       );

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.moderate_product_proposal(p_proposal_id uuid, p_decision text, p_expected_version integer, p_corrected_payload jsonb DEFAULT NULL::jsonb, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
  v_photo jsonb;
  v_next_sort int;
  v_new_product_id uuid;
  v_submitted_by uuid;
  v_submitted_by_email text;
  v_entity_name text;
  v_subject text;
  v_body text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_product_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, product_id, establishment_id, partner_id, type, payload, status, version, reviewed_by, kind
    into v_proposal
    from public.product_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  if p_decision = 'approve' and v_proposal.kind = 'create' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload)
      || jsonb_build_object('photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb));

    v_new_product_id := public.create_product_from_proposal(
      v_proposal.partner_id, v_proposal.establishment_id, v_proposal.type, v_final_payload
    );

    update public.product_proposals
       set status = 'approved', product_id = v_new_product_id, payload = v_final_payload,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

  elsif p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.product_media where product_id = v_proposal.product_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_proposal.product_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve_photos', 'product_media',
      v_proposal.product_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    update public.products
       set name = v_final_payload -> 'name',
           description = v_final_payload -> 'description',
           address = v_final_payload ->> 'address',
           lat = nullif(v_final_payload ->> 'lat', '')::double precision,
           lon = nullif(v_final_payload ->> 'lon', '')::double precision,
           price_cop = nullif(v_final_payload ->> 'price_cop', '')::bigint,
           price_tiers = v_final_payload -> 'price_tiers',
           min_qty = nullif(v_final_payload ->> 'min_qty', '')::int,
           max_qty = nullif(v_final_payload ->> 'max_qty', '')::int,
           check_in_time = nullif(v_final_payload ->> 'check_in_time', '')::time,
           check_out_time = nullif(v_final_payload ->> 'check_out_time', '')::time,
           capacity = nullif(v_final_payload ->> 'capacity', '')::int,
           unit_count = nullif(v_final_payload ->> 'unit_count', '')::int,
           lodging_kind = nullif(v_final_payload ->> 'lodging_kind', ''),
           unit = nullif(v_final_payload ->> 'unit', ''),
           default_capacity = nullif(v_final_payload ->> 'default_capacity', '')::int,
           stay_rates = v_final_payload -> 'stay_rates',
           -- Ajout de cette migration (20260914140000) : forme GARDÉE (`?`), même raisonnement que
           -- external_booking_url/price_label juste en dessous — une proposition `pending` créée
           -- AVANT cette migration ne porte pas ces 2 clés ; une écriture inconditionnelle
           -- effacerait un group_discount déjà posé sur le produit au moment de l'approuver.
           group_discount_threshold_qty = case when v_final_payload ? 'group_discount_threshold_qty'
                                               then nullif(v_final_payload ->> 'group_discount_threshold_qty', '')::int
                                               else group_discount_threshold_qty end,
           group_discount_pct = case when v_final_payload ? 'group_discount_pct'
                                     then nullif(v_final_payload ->> 'group_discount_pct', '')::numeric
                                     else group_discount_pct end,
           -- Ajout de cette migration (20260916140000) : GARDÉE comme ses voisines (une proposition
           -- `pending` créée avant cette migration ne porte pas la clé, une écriture
           -- inconditionnelle effacerait le programme posé entre-temps sur le produit), et en plus
           -- NORMALISÉE pour la même raison qu'à l'insert de create_product_from_proposal — sans
           -- quoi une proposition portant {"program": null} ferait échouer l'approbation sur le
           -- CHECK products_program_is_array au lieu d'effacer le programme comme demandé.
           program = case when v_final_payload ? 'program'
                          then case when jsonb_typeof(v_final_payload -> 'program') = 'array'
                                    then v_final_payload -> 'program'
                                    else null end
                          else program end,
           -- 2026-09-09 : sans ces deux colonnes, une proposition qui portait enfin une URL de
           -- vitrine était approuvée SANS elle — la whitelist élargie n'aurait servi à rien.
           -- ⚠️ Forme volontairement différente des lignes ci-dessus (`case when ... ?` plutôt
           -- qu'une écriture inconditionnelle) : une proposition `pending` créée AVANT cette
           -- migration ne porte pas ces clés, et l'écriture inconditionnelle EFFACERAIT l'URL déjà
           -- posée sur le produit au moment de l'approuver. `?` distingue « clé absente » (garder
           -- l'existant) de « clé présente à null » (effacer volontairement) — ce que `->>` seul ne
           -- permet pas. Les autres colonnes ont ce défaut ; on ne le reproduit pas ici.
           external_booking_url = case when v_final_payload ? 'external_booking_url'
                                       then nullif(v_final_payload ->> 'external_booking_url', '')
                                       else external_booking_url end,
           price_label = case when v_final_payload ? 'price_label'
                              then nullif(v_final_payload ->> 'price_label', '')
                              else price_label end,
           -- 2026-09-16 (transport informatif) : forme GARDÉE (`?`), jamais l'écriture
           -- inconditionnelle des lignes address/lat/lon plus haut. Une proposition `pending`
           -- créée AVANT cette migration ne porte pas ces 9 clés, et `->>` seul ne distingue pas
           -- « clé absente » (garder l'existant) de « clé présente à null » (effacer
           -- volontairement) : l'écriture inconditionnelle EFFACERAIT des horaires déjà posés au
           -- moment d'approuver une simple correction de nom.
           transport_first_departure_time = case when v_final_payload ? 'transport_first_departure_time'
                                       then nullif(v_final_payload ->> 'transport_first_departure_time', '')::time
                                       else transport_first_departure_time end,
           transport_last_departure_time = case when v_final_payload ? 'transport_last_departure_time'
                                       then nullif(v_final_payload ->> 'transport_last_departure_time', '')::time
                                       else transport_last_departure_time end,
           transport_seats_per_departure = case when v_final_payload ? 'transport_seats_per_departure'
                                       then nullif(v_final_payload ->> 'transport_seats_per_departure', '')::int
                                       else transport_seats_per_departure end,
           transport_departure_address = case when v_final_payload ? 'transport_departure_address'
                                       then nullif(v_final_payload ->> 'transport_departure_address', '')
                                       else transport_departure_address end,
           transport_departure_lat = case when v_final_payload ? 'transport_departure_lat'
                                       then nullif(v_final_payload ->> 'transport_departure_lat', '')::double precision
                                       else transport_departure_lat end,
           transport_departure_lon = case when v_final_payload ? 'transport_departure_lon'
                                       then nullif(v_final_payload ->> 'transport_departure_lon', '')::double precision
                                       else transport_departure_lon end,
           transport_arrival_address = case when v_final_payload ? 'transport_arrival_address'
                                       then nullif(v_final_payload ->> 'transport_arrival_address', '')
                                       else transport_arrival_address end,
           transport_arrival_lat = case when v_final_payload ? 'transport_arrival_lat'
                                       then nullif(v_final_payload ->> 'transport_arrival_lat', '')::double precision
                                       else transport_arrival_lat end,
           transport_arrival_lon = case when v_final_payload ? 'transport_arrival_lon'
                                       then nullif(v_final_payload ->> 'transport_arrival_lon', '')::double precision
                                       else transport_arrival_lon end,
           updated_at = now()
     where id = v_proposal.product_id;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve', 'products', v_proposal.product_id,
      null, v_final_payload, null);
  else
    update public.product_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.reject', 'product_proposals', p_proposal_id,
      null, null, p_rejection_reason);
  end if;

  -- Spec 23 §0/§7 — notification partenaire du verdict, isolée (§8.1). Requête séparée (v_proposal
  -- ne porte pas submitted_by) plutôt qu'élargir le select ci-dessus.
  begin
    select submitted_by into v_submitted_by from public.product_proposals where id = p_proposal_id;
    select email into v_submitted_by_email from auth.users where id = v_submitted_by;
    v_entity_name := coalesce(v_proposal.payload -> 'name' ->> 'es', 'Producto sin nombre');

    if p_decision = 'approve' then
      v_subject := 'Tu propuesta fue aprobada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue aprobada.</p>';
    else
      v_subject := 'Tu propuesta fue rechazada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue rechazada.</p>'
        || '<p>Motivo: ' || coalesce(p_rejection_reason, '') || '</p>';
    end if;

    perform public.enqueue_notification_email(
      'partner_proposal_decided', v_submitted_by_email, v_submitted_by, v_subject, v_body,
      'product_proposals', p_proposal_id
    );
  exception
    when query_canceled then
      raise warning 'moderate_product_proposal: notification annulée (query_canceled) pour % — %', p_proposal_id, sqlerrm;
    when others then
      raise warning 'moderate_product_proposal: échec notification pour % — %', p_proposal_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'product_id', v_new_product_id);
end;
$function$;
