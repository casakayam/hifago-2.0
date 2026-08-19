-- Deux retours Jérôme (2026-08-18, usage réel) :
--   1. Un camp a aussi des "servicios incluidos" (desayuno, transporte, guía…) qui doivent être des
--      tags comme pour les autres types, pour pouvoir un jour trier/filtrer dessus — camp reste
--      exclu d'hasLocationAndTags (pas d'adresse propre), un nouveau booléen hasTags côté client
--      (apps/admin/lib/products/useProductTypeFieldsState.ts) porte ce gating séparément. Ici, seul
--      le whitelist SERVEUR de submit_product_creation_proposal doit suivre : `tag_ids` passe d'un
--      seul bloc partagé avec address/lat/lon à deux blocs indépendants, le 2e incluant 'camp'.
--   2. "Les chambres et dortoirs n'ont toujours pas la possibilité d'avoir des images" côté
--      proposition socio (le mécanisme admin-direct, lui, fonctionne déjà pleinement depuis
--      20260816130000_room_media_and_room_stay_rates.sql) — apps/admin/components/product-form.tsx
--      masquait l'éditeur de photos de chambre pour variant="socio-proposal"
--      (hidePhotosInHotelRooms), et même une fois démasqué, ni le payload de proposition ni
--      create_product_from_proposal ne transportaient/persistaient ces photos. Corrigé aux 3
--      niveaux : buildProductCreationPayload (apps/admin/lib/products/productCreationPayload.ts)
--      ajoute désormais `photos` par chambre ; create_product_from_proposal les insère dans
--      room_media après avoir créé chaque chambre ; moderate_product_proposal les réinjecte depuis
--      la proposition ORIGINALE (jamais depuis une correction admin, qui ne les transporte jamais —
--      ModerateProductCreationProposalForm.tsx garde hidePhotosInHotelRooms=true, même raisonnement
--      déjà en place pour les photos au niveau produit juste au-dessus dans cette même fonction).
--
-- Règle du projet (hifago/CLAUDE.md) : jamais éditer une migration déjà appliquée en place — les 3
-- fonctions ci-dessous sont recréées ici via `create or replace function`, corps copié VERBATIM
-- depuis leur dernière définition existante (create_product_from_proposal :
-- 20260818093000_product_default_capacity_proposal_parity.sql ; submit_product_creation_proposal
-- et moderate_product_proposal : 20260818110000_product_creation_review_ux.sql), plus les seuls
-- changements ciblés décrits ci-dessus. Signatures inchangées partout.

-- ============================================================================================
-- 1. create_product_from_proposal — insère room_media pour les photos de chaque chambre.
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
    check_in_time, check_out_time, capacity, default_capacity, stay_rates,
    duration_days,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url
  )
  values (
    p_partner_id, p_establishment_id, p_type,
    p_payload -> 'name', p_payload -> 'description', v_slug,
    false,
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
    nullif(p_payload ->> 'external_booking_url', '')
  )
  returning id into v_product_id;

  if jsonb_typeof(p_payload -> 'tag_ids') = 'array' then
    for v_tag_id in select * from jsonb_array_elements_text(p_payload -> 'tag_ids') loop
      insert into public.product_tag_assignments (product_id, tag_id) values (v_product_id, v_tag_id::uuid);
    end loop;
  end if;

  -- Photos : même mécanique que la branche kind='photos' de moderate_product_proposal (sort
  -- continu depuis 0, product_media n'a encore aucune ligne pour un produit tout juste créé).
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

      -- Photos de la chambre (retour Jérôme 2026-08-18) : même mécanique que les photos produit
      -- ci-dessus — storage_path déjà uploadé (HotelRoomsEditor), sort continu depuis 0 POUR CETTE
      -- chambre (room_media n'a encore aucune ligne pour une chambre tout juste créée).
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
-- 2. submit_product_creation_proposal — tag_ids séparé d'address/lat/lon, inclut désormais 'camp'.
--    (dernière définition : 20260818110000_product_creation_review_ux.sql)
-- ============================================================================================

create or replace function submit_product_creation_proposal(
  p_establishment_id uuid,
  p_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_safe_photos jsonb;
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

  -- Photos : plafond 6, uniforme avec submit_photos_proposal (§9) — pas de garde de galerie
  -- existante à cumuler ici, le produit n'existe pas encore. Ne conserve que des entrées
  -- {storage_path: text} valides, jamais un champ hors forme.
  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description', 'photos', v_safe_photos
    )
    || case when p_type in ('activity', 'lodging', 'hotel', 'transport') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    -- Séparé du bloc address/lat/lon ci-dessus (retour Jérôme 2026-08-18) : camp a des tags
    -- ("servicios incluidos") sans avoir d'adresse propre — même raisonnement que le split côté
    -- apps/admin/lib/products/productCreationPayload.ts (hasTags ≠ hasLocationAndTags).
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
    || case when p_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    || case when p_type in ('activity', 'camp', 'transport') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- room_types transporté tel quel (déjà whitelisté champ par champ côté client,
    -- toRoomTypeRow/hotelRooms.ts) — photos par chambre (retour Jérôme 2026-08-18) désormais
    -- incluses dans chaque élément par apps/admin/lib/products/productCreationPayload.ts, aucun
    -- filtrage supplémentaire nécessaire ici : coalesce(...) transporte le tableau intact, photos
    -- comprises.
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
       ) else '{}'::jsonb end;

  insert into public.product_proposals
    (product_id, establishment_id, partner_id, submitted_by, kind, type, payload)
  values (null, p_establishment_id, v_partner_id, v_account_id, 'create', p_type, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ============================================================================================
-- 3. moderate_product_proposal — réinjecte les photos de chambre depuis la proposition ORIGINALE
--    (jamais depuis une correction admin, qui ne les transporte jamais). Seule la branche
--    approve+kind='create' change ; les 3 autres branches sont inchangées au mot près (dernière
--    définition : 20260818110000_product_creation_review_ux.sql).
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

    -- Chambres (retour Jérôme 2026-08-18) : même raisonnement que "photos" ci-dessus —
    -- ModerateProductCreationProposalForm.tsx masque toujours l'éditeur de photos de chambre
    -- (hidePhotosInHotelRooms=true), donc p_corrected_payload reconstruit toujours room_types avec
    -- photos=[] pour chaque chambre. Réinjectées ici depuis la proposition ORIGINALE
    -- (v_proposal.payload, jamais modifiée par l'admin), par position dans le tableau — le
    -- formulaire de modération ne réordonne/ajoute/retire jamais de chambre aujourd'hui, seuls les
    -- champs d'une chambre existante sont corrigibles.
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

  -- product_id : non-null uniquement pour approve+kind='create' (seule branche qui matérialise un
  -- nouveau produit) — permet à ModerateProductCreationProposalForm.tsx de proposer "¿Publicar
  -- también?" tout de suite après approbation, sans recharger la proposition pour retrouver l'id.
  return jsonb_build_object('ok', true, 'product_id', v_new_product_id);
end;
$$;
