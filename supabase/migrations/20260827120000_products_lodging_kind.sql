-- products.lodging_kind — dortoir / chambre privée / maison entière (arbitrage Jérôme, 2026-08-27).
--
-- CE QUI MANQUAIT. LobbyPMS distingue `privada` et `compartida` sur chaque catégorie ; hifago
-- parse ce champ depuis le 2026-08-26 (parseLobbyRooms.normalizeLobbyRoomKind), l'affiche dans la
-- carte de prévisualisation du sélecteur… et le JETTE au moment de lier. Une chambre importée
-- arrivait donc au catalogue public sans jamais dire si on y dort seul ou à huit — l'information
-- la plus structurante d'une fiche d'hébergement, disponible gratuitement, perdue à la dernière
-- étape.
--
-- POURQUOI TROIS VALEURS ET NON DEUX. `whole_house` n'est pas une hypothèse : la v1 en production
-- porte `mode: 'whole_house'` sur Bania Travel (src/config/properties.js du dépôt legacy), pendant
-- que Casa Kayam est en `mode: 'rooms'`. Un partenaire réel se loue déjà maison entière, et hifago
-- n'avait aucun moyen de le représenter. Conséquence directe : cette valeur ne viendra JAMAIS d'un
-- import — le vocabulaire de Lobby n'a que deux termes — c'est toujours un choix manuel, et
-- l'écran doit le dire (sinon on cherchera longtemps pourquoi « Usar estos datos » ne la propose
-- jamais).
--
-- CE QUE CE N'EST PAS : `products.unit`. La tentation de recycler la colonne voisine était réelle,
-- elle est fausse. `unit` est une unité de PRIX — la fiche publique s'en sert pour imprimer « por
-- persona » à côté du montant. `lodging_kind` est une NATURE DE COUCHAGE. La correspondance n'est
-- pas mécanique : la catégorie « CAMPER Van » du compte réel est `privada` avec `capacity: 4`, et
-- sûrement pas vendue « per_two ». Les fusionner recréerait exactement l'homonymie que la migration
-- 20260827100000 vient de retirer entre les deux `quantity`.
--
-- `unit` EST TOUT DE MÊME ÉTENDUE À `per_house` ici, dans le même geste : la v1 l'a
-- (src/services/catalogService.js:841, `unit: 'per_house'` pour une propriété whole_house), un
-- logement maison entière en aura besoin, et c'est une ligne de contrainte sur la même table — la
-- séparer coûterait une seconde migration pour rien. Ce qui n'est PAS fait, et doit être lu comme
-- délibéré : RIEN n'écrit `unit` (seul seed.sql le fait, cf. défaut C4 du plan LobbyPMS). La
-- colonne reste inerte, elle a simplement cessé d'être incomplète.
--
-- DESCRIPTIF, comme unit_count : aucune RPC de commande ne lit `lodging_kind`, il n'autorise ni ne
-- refuse jamais une réservation. Pour un logement PMS-backed, c'est Lobby qui tranche la
-- disponibilité en direct.
--
-- CE QUI RESTE OUVERT, et qu'il ne faut pas confondre avec cette colonne : la v1 porte
-- `whole_house` sur la PROPRIÉTÉ, pas sur le produit, parce que ça répond à une autre question —
-- « cet établissement a-t-il des chambres à choisir, ou se loue-t-il entier ? ». La future page
-- publique établissement (T2 du modèle hébergement, spec 24 §4) en aura besoin : lui afficher une
-- liste de chambres n'aurait aucun sens. Non porté ici, noté pour ne pas être redécouvert.
--
-- Règle du projet : jamais éditer une migration déjà appliquée. Les 4 fonctions du parcours de
-- proposition sont donc recréées, corps extraits MÉCANIQUEMENT de 20260827100000 (leur dernière
-- définition), avec pour seul changement l'ajout de `lodging_kind`.

alter table public.products
  add column lodging_kind text
    check (lodging_kind is null or lodging_kind in ('dorm', 'private', 'whole_house'));

comment on column public.products.lodging_kind is
  'Nature du couchage : dorm (lit en dortoir), private (chambre privative), whole_house (logement entier). DESCRIPTIF — jamais utilisé pour autoriser ou refuser une réservation. Prérempli depuis LobbyPMS (privada/compartida) pour dorm et private ; whole_house est toujours un choix manuel, Lobby n''ayant pas ce terme. À ne pas confondre avec unit, qui est une unité de PRIX.';

-- `unit` acceptait deux valeurs depuis 20260813190232 ; la v1 en a trois. Le check est recréé
-- plutôt qu'ajouté à côté, pour qu'il n'y ait jamais deux contraintes concurrentes sur la colonne.
alter table public.products drop constraint products_unit_check;

alter table public.products
  add constraint products_unit_check
    check (unit is null or unit in ('per_person', 'per_two', 'per_house'));

-- ============================================================================================
-- 1. submit_product_creation_proposal (verbatim 20260827100000) + lodging_kind
-- ============================================================================================

create or replace function public.submit_product_creation_proposal(p_establishment_id uuid, p_type text, p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  if p_type not in ('activity', 'evento', 'camp', 'lodging', 'hotel', 'transport') then
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
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  select lobby_connector_active into v_lobby_connector_active
    from public.establishments where id = p_establishment_id;

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description', 'photos', v_safe_photos
    )
    || case when p_type in ('activity', 'lodging', 'hotel', 'transport') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    || case when p_type in ('activity', 'lodging', 'hotel', 'transport', 'camp') then jsonb_build_object(
         'tag_ids', coalesce(p_payload -> 'tag_ids', '[]'::jsonb)
       ) else '{}'::jsonb end
    || case when p_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_cop', p_payload -> 'price_cop', 'price_tiers', p_payload -> 'price_tiers',
         'min_qty', p_payload -> 'min_qty', 'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    || case when p_type = 'camp' then
         jsonb_build_object('price_cop', p_payload -> 'price_cop', 'duration_days', p_payload -> 'duration_days')
       else '{}'::jsonb end
    || case when p_type in ('lodging', 'hotel') then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`
    -- rejoint la whitelist des logements. Une clé absente d'ici est SILENCIEUSEMENT jetée — c'est
    -- exactement le rôle de cette whitelist — donc l'oublier ferait disparaître le type de couchage
    -- entre le formulaire du socio et la proposition enregistrée, sans erreur nulle part.
    || case when p_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    || case when p_type in ('activity', 'camp', 'transport') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    || case when p_type = 'hotel' then
         jsonb_build_object('room_types', coalesce(p_payload -> 'room_types', '[]'::jsonb))
       else '{}'::jsonb end
    || case when p_type = 'activity' then
         jsonb_build_object('slot_rules', coalesce(p_payload -> 'slot_rules', '[]'::jsonb))
       else '{}'::jsonb end
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

-- ============================================================================================
-- 2. create_product_from_proposal (verbatim 20260827100000) + lodging_kind
--    ⚠️ le `quantity` de product_room_types reste INTACT dans cette fonction
-- ============================================================================================

create or replace function create_product_from_proposal(
  p_partner_id uuid,
  p_establishment_id uuid,
  p_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_slug_base text;
  v_slug text;
  v_suffix int := 1;
  v_tag_id text;
  v_slot jsonb;
  v_room jsonb;
  v_room_id uuid;
  v_room_photo jsonb;
  v_room_sort int;
  v_photo jsonb;
  v_sort int;
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

  insert into public.products (
    partner_id, establishment_id, type, name, description, slug, sellable,
    price_cop, price_tiers, min_qty, max_qty,
    address, lat, lon,
    check_in_time, check_out_time, capacity, unit_count, lodging_kind, default_capacity, stay_rates,
    duration_days,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url,
    lobby_category_id, lobby_product_id
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
    nullif(p_payload ->> 'default_capacity', '')::int,
    p_payload -> 'stay_rates',
    nullif(p_payload ->> 'duration_days', '')::int,
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
    nullif(p_payload ->> 'lobby_product_id', '')::int
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

  if p_type = 'hotel' and jsonb_typeof(p_payload -> 'room_types') = 'array' then
    for v_room in select * from jsonb_array_elements(p_payload -> 'room_types') loop
      insert into public.product_room_types
        (product_id, kind, name, description, capacity, quantity, price_cop, price_tiers,
         min_qty, max_qty, stay_rates, sort)
      values (
        v_product_id,
        v_room ->> 'kind', v_room -> 'name', v_room -> 'description',
        (v_room ->> 'capacity')::int, nullif(v_room ->> 'quantity', '')::int,
        (v_room ->> 'price_cop')::bigint, v_room -> 'price_tiers',
        nullif(v_room ->> 'min_qty', '')::int, nullif(v_room ->> 'max_qty', '')::int,
        v_room -> 'stay_rates', coalesce((v_room ->> 'sort')::int, 0)
      )
      returning id into v_room_id;

      if jsonb_typeof(v_room -> 'photos') = 'array' then
        v_room_sort := 0;
        for v_room_photo in select * from jsonb_array_elements(v_room -> 'photos') loop
          insert into public.room_media (room_type_id, storage_path, sort)
          values (v_room_id, v_room_photo ->> 'storage_path', v_room_sort);
          v_room_sort := v_room_sort + 1;
        end loop;
      end if;
    end loop;
  end if;

  perform public.log_admin_action(
    'product_proposal.approve_create', 'products', v_product_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'establishment_id', p_establishment_id, 'type', p_type),
    null
  );

  return v_product_id;
end;
$$;

-- ============================================================================================
-- 3. submit_product_proposal (verbatim 20260827100000) + lodging_kind
-- ============================================================================================

create or replace function submit_product_proposal(p_product_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Whitelist par type — miroir exact du bloc `if (isEditing && product)` de ProductForm
  -- (product-form.tsx), jamais tags/photos/slot_rules/room_types (délégués à des blocs séparés à
  -- sauvegarde immédiate côté admin, jamais couverts par ce même submit là non plus).
  v_safe_payload := jsonb_build_object('name', p_payload -> 'name', 'description', p_payload -> 'description')
    || case when v_type in ('activity', 'lodging', 'hotel', 'transport') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    || case when v_type not in ('evento', 'hotel') then
         jsonb_build_object('price_cop', p_payload -> 'price_cop') else '{}'::jsonb end
    || case when v_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_tiers', p_payload -> 'price_tiers', 'min_qty', p_payload -> 'min_qty',
         'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    || case when v_type in ('lodging', 'hotel') then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`,
    -- miroir exact de submit_product_creation_proposal ci-dessus — création et édition doivent
    -- whitelister les MÊMES clés, sinon un champ se remplit à la création et disparaît à la
    -- première modification.
    || case when v_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    || case when v_type in ('activity', 'camp', 'transport') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end;

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ============================================================================================
-- 4. moderate_product_proposal (verbatim 20260827100000) + lodging_kind
-- ============================================================================================

create or replace function moderate_product_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_expected_version int,
  p_corrected_payload jsonb default null,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
  v_photo jsonb;
  v_next_sort int;
  v_new_product_id uuid;
  v_room_types_with_photos jsonb;
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

    if v_proposal.type = 'hotel' and jsonb_typeof(v_final_payload -> 'room_types') = 'array' then
      select jsonb_agg(
               elem.value || jsonb_build_object(
                 'photos',
                 coalesce(v_proposal.payload -> 'room_types' -> (elem.ordinality - 1)::int -> 'photos', '[]'::jsonb)
               )
               order by elem.ordinality
             )
        into v_room_types_with_photos
        from jsonb_array_elements(v_final_payload -> 'room_types') with ordinality as elem;
      v_final_payload := jsonb_set(v_final_payload, '{room_types}', coalesce(v_room_types_with_photos, '[]'::jsonb));
    end if;

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
           default_capacity = nullif(v_final_payload ->> 'default_capacity', '')::int,
           stay_rates = v_final_payload -> 'stay_rates',
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
$$;
