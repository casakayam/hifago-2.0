-- Retour Jérôme (2026-08-20) — revirement assumé d'une décision de la veille
-- (20260818110000_product_creation_review_ux.sql : "geste de publication volontairement séparé",
-- sellable=false à la création + modale "¿Publicar esta ficha ahora?" dans
-- ModerateProductCreationProposalForm.tsx). Modèle cible reposé explicitement le 2026-08-20 :
-- "quand jerome accepte la nouvelle activité ou établissement c'est publié direct, mais jerome
-- depuis l'admin peut dépublier" — même principe déjà vrai côté établissement
-- (create_establishment n'a jamais eu besoin de ce correctif, son statut par défaut est déjà
-- 'active'). Un seul champ change : sellable=false → true à la création depuis une proposition
-- approuvée. set_product_sellable reste le levier de dépublication, inchangé.
--
-- Règle du projet : jamais éditer une migration déjà appliquée — corps copié VERBATIM depuis la
-- dernière définition existante (20260818170000_camp_tags_and_room_photos.sql), seule la valeur
-- littérale `false` du champ sellable (position 7 de la liste values, ligne "false," juste après
-- v_slug) devient `true`. Signature inchangée.
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
