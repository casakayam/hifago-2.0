-- Spec 15 (Socio : proposer la création d'une nouvelle fiche produit) — comble le dernier gap du
-- mécanisme de proposition socio (product_proposals ne couvrait jusqu'ici que l'édition d'un
-- produit déjà créé par l'admin, kind 'content'/'photos') : un socio ne pouvait pas encore
-- proposer une fiche entièrement nouvelle sur un de ses établissements. Symétrique de
-- establishment_proposals (20260815170000_gestion_etablissement.sql) — kind='create',
-- product_id nullable jusqu'à approbation — sauf sur un point : ici l'ÉTABLISSEMENT cible existe
-- déjà (contrairement à un établissement lui-même en cours de création), donc establishment_id
-- est connu et requis DÈS LA SOUMISSION, jamais backfillé.
--
-- Décision Jérôme (cadrage 2026-08-17) : les 6 types de produit sont couverts dès ce lot
-- (activity/evento/camp/lodging/hotel/transport), avec parité totale des champs par rapport au
-- parcours admin (ProductForm) — y compris les sous-structures hôtel (chambres) et logement
-- (tarifs de séjour). Ceci révise la règle du cahier des charges socio §3e ("jamais un
-- hébergement directement") pour la CRÉATION uniquement — cf. révision explicite dans
-- docs/02-cahier-des-charges-socio.md. Aucune photo dans la proposition de création : une fois
-- approuvée, le socio ajoute des photos via le mécanisme déjà existant submit_photos_proposal
-- (kind='photos', qui exige déjà un product_id réel).
--
-- Frontière RLS/RPC-only (hifago/CLAUDE.md §3) : product_proposals reste RPC-only (déjà le cas).
-- products reste RLS-directe admin, inchangée — create_product_from_proposal (security definer)
-- est le seul chemin d'écriture cross-identité, jamais un GRANT direct au socio.

-- ============================================================================================
-- 1. Extension de product_proposals
-- ============================================================================================

alter table product_proposals
  alter column product_id drop not null,
  add column establishment_id uuid references establishments(id),
  -- Restreint aux 6 types couverts par ce mécanisme (miroir strict du ProductType de ProductForm)
  -- — plus étroit que le CHECK de products.type lui-même (qui garde 'tour', legacy, jamais exposé
  -- dans aucun formulaire admin ou socio).
  add column type text check (
    type is null or type in ('activity', 'evento', 'camp', 'lodging', 'hotel', 'transport')
  );

alter table product_proposals drop constraint product_proposals_kind_check;
alter table product_proposals
  add constraint product_proposals_kind_check check (kind in ('content', 'photos', 'create'));

-- Symétrique de establishment_proposals_scope, avec la différence structurelle assumée en tête de
-- fichier : establishment_id n'est jamais backfillé (connu dès la soumission), seul product_id
-- suit le schéma "null jusqu'à approbation".
alter table product_proposals
  add constraint product_proposals_scope check (
    (kind in ('content', 'photos') and product_id is not null)
    or (
      kind = 'create' and establishment_id is not null and type is not null and (
        (product_id is null and status <> 'approved')
        or (product_id is not null and status = 'approved')
      )
    )
  );

create index product_proposals_establishment_status_idx
  on product_proposals(establishment_id, status) where establishment_id is not null;

-- ============================================================================================
-- 2. Utilitaire SQL slugify — équivalent de apps/admin/lib/utils.ts, nécessaire ici car le slug
--    ne peut être calculé qu'à l'approbation (le nom peut avoir été corrigé par l'admin
--    entre-temps), donc côté serveur, jamais côté client pour ce chemin précis.
-- ============================================================================================

create extension if not exists unaccent with schema extensions;

create or replace function slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    lower(extensions.unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g'
  ));
$$;

-- ============================================================================================
-- 3. Fonction interne create_product_from_proposal — appelée uniquement en nested depuis
--    moderate_product_proposal (branche kind='create'), jamais de grant execute direct (même
--    patron que create_establishment appelée depuis moderate_establishment_proposal).
-- ============================================================================================

-- p_payload est déjà dans la forme EXACTE attendue par les colonnes cibles (price_cop/price_tiers
-- déjà résolus côté client via lowestTierPrice/toPriceTiersColumn, stay_rates déjà résolu via
-- toStayRatesColumn, room_types déjà résolu via toRoomTypeRows/toRoomTypeRow, slot_rules déjà
-- résolu via toSlotRuleRows — mêmes fonctions que celles utilisées par ProductForm admin-direct,
-- réutilisées telles quelles par le variant socio-proposal) : cette fonction ne fait AUCUN calcul
-- de prix, elle transpose un jsonb déjà validé/formé vers des colonnes réelles, exactement comme
-- handleSubmit le fait aujourd'hui pour l'admin-direct.
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
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_product_from_proposal réservé au rôle admin' using errcode = '42501';
  end if;

  v_slug_base := public.slugify(coalesce(p_payload -> 'name' ->> 'es', 'producto'));
  if v_slug_base = '' then
    v_slug_base := 'producto';
  end if;
  v_slug := v_slug_base;
  -- Collision de slug : suffixe -2/-3… plutôt que de laisser planter toute la transaction de
  -- modération (contrairement à l'admin-direct, où un 23505 brut reste acceptable — l'admin le
  -- voit immédiatement ; ici l'échec surviendrait après coup, bien après que le socio a soumis).
  while exists (select 1 from public.products where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  insert into public.products (
    partner_id, establishment_id, type, name, description, slug, sellable,
    price_cop, price_tiers, min_qty, max_qty,
    address, lat, lon,
    check_in_time, check_out_time, capacity, stay_rates,
    duration_days,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url
  )
  values (
    p_partner_id, p_establishment_id, p_type,
    p_payload -> 'name', p_payload -> 'description', v_slug,
    -- Toujours false à la création, quel que soit le type — même invariant que ProductForm
    -- admin-direct (feature 4, publication = geste séparé).
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
      );
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
-- Pas de grant execute : appelée uniquement en nested depuis moderate_product_proposal, jamais
-- directement par un client — même patron que create_establishment. Le garde is_admin() interne
-- ci-dessus reste une défense en profondeur (comportement déjà vérifié pour create_establishment).

-- ============================================================================================
-- 4. RPC submit_product_creation_proposal — socio
-- ============================================================================================

-- Mêmes 3 garde-fous que submit_establishment_edit_proposal (identité/propriété/capacité) — pas
-- ceux, plus permissifs, de submit_establishment_creation_proposal : ici l'établissement cible
-- EXISTE déjà et doit être possédé + actif (operator) par le socio, contrairement à la création
-- d'un tout premier établissement.
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
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_type not in ('activity', 'evento', 'camp', 'lodging', 'hotel', 'transport') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  -- Garde-fous 1+2 (identité + propriété) : même réponse "introuvable" dans les deux cas, jamais
  -- de fuite d'existence d'un établissement tiers (cahier des charges socio §3d).
  if v_partner_id is null or not exists (
    select 1 from public.establishments where id = p_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator ACTIF pour CET établissement précis.
  if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  -- Plafond dédié : 1 création pending PAR ÉTABLISSEMENT (pas par partenaire — un socio
  -- multi-établissements peut légitimement proposer une fiche sur chacun en parallèle), même
  -- raisonnement que le plafond "1" de submit_establishment_creation_proposal mais scopé plus
  -- finement puisque, ici, l'établissement cible est toujours connu.
  if exists (
    select 1 from public.product_proposals
     where establishment_id = p_establishment_id and kind = 'create' and status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pending_creation_exists');
  end if;

  -- Plafond générique 10 pending/partenaire (même valeur que submit_product_proposal), compté
  -- toutes propositions produit confondues (content/photos/create).
  if (
    select count(*) from public.product_proposals where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  -- Whitelist stricte PAR TYPE, miroir exact du gating hasLocationAndTags/hasPriceQtyFields/
  -- hasCheckInOut de ProductForm — jamais sellable/commission/mapping PMS (cahier socio §3e
  -- propriété n°2, même discipline que submit_product_proposal/submit_establishment_*_proposal).
  v_safe_payload := jsonb_build_object('name', p_payload -> 'name', 'description', p_payload -> 'description')
    || case when p_type in ('activity', 'lodging', 'hotel', 'transport') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
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

grant execute on function submit_product_creation_proposal(uuid, text, jsonb) to authenticated;

-- withdraw_product_proposal (20260813234500) fonctionne déjà tel quel sur une proposition
-- kind='create' — générique sur status/ownership (partner_id), rien à étendre.

-- ============================================================================================
-- 5. Extension de moderate_product_proposal — nouvelle branche kind='create'
-- ============================================================================================

-- Signature INCHANGÉE (reprise intégrale des branches 'photos'/défaut de 20260815110000, aucune
-- régression) — seule une nouvelle branche kind='create' est ajoutée avant elles.
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
    -- Correction admin = objet COMPLET, pas un merge champ par champ comme la branche 'content' :
    -- le payload d'une création est trop riche/typé par type pour un coalesce fiable clé par clé
    -- (même choix que moderate_establishment_proposal, branche kind='create'). `type` n'est
    -- JAMAIS corrigible à la modération (immuable dès la soumission socio, même invariant que
    -- établissement/type immuables après création admin-direct) — toujours lu depuis
    -- v_proposal.type, jamais depuis p_corrected_payload.
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    v_new_product_id := public.create_product_from_proposal(
      v_proposal.partner_id, v_proposal.establishment_id, v_proposal.type, v_final_payload
    );

    update public.product_proposals
       set status = 'approved', product_id = v_new_product_id, payload = v_final_payload,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    -- Pas de log_admin_action séparé : create_product_from_proposal logue déjà
    -- 'product_proposal.approve_create' (même raisonnement que moderate_establishment_proposal).

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
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'price_cop', coalesce(p_corrected_payload -> 'price_cop', v_proposal.payload -> 'price_cop'),
      'category', coalesce(p_corrected_payload -> 'category', v_proposal.payload -> 'category')
    );

    update public.products
       set name = v_final_payload -> 'name',
           description = v_final_payload -> 'description',
           price_cop = (v_final_payload ->> 'price_cop')::bigint,
           category = v_final_payload ->> 'category',
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

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function moderate_product_proposal(uuid, text, int, jsonb, text) to authenticated;
