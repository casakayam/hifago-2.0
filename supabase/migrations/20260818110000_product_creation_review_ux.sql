-- Retour Jérôme (2026-08-18, usage réel) sur le parcours de proposition de création de produit :
--   1. Le plafond "1 création pending PAR ÉTABLISSEMENT" bloquait un socio qui voulait proposer une
--      2e fiche pendant qu'une 1re attendait encore la revue admin — gênant en pratique, à retirer.
--      Aucun autre invariant ne s'appuie sur cette limite (product_proposals_scope n'impose aucune
--      borne de nombre ; PendingProductCreationsList.tsx rend déjà une LISTE, pas un singleton — la
--      pluralité était déjà anticipée côté UI). Seul le plafond générique 10 pending/partenaire
--      (tous kinds confondus, inchangé ici) reste une vraie barrière anti-abus.
--   2. Quand l'admin approuve une proposition de création, le produit résultant est toujours créé
--      sellable=false (create_product_from_proposal, geste de publication volontairement séparé,
--      cf. feature 4) — mais l'écran de modération n'a jusqu'ici aucun moyen de le publier dans la
--      foulée, ni même de savoir l'id du produit fraîchement créé. moderate_product_proposal
--      renvoie désormais ce product_id (uniquement non-null pour la branche approve+kind='create'),
--      pour qu'ModerateProductCreationProposalForm.tsx puisse proposer "¿Publicar también?" tout de
--      suite après approbation.
--
-- Règle du projet (hifago/CLAUDE.md) : jamais éditer une migration déjà appliquée en place — les 2
-- fonctions ci-dessous sont recréées ici via `create or replace function`, corps copié VERBATIM
-- depuis leur dernière définition existante (20260818093000_product_default_capacity_proposal_parity.sql,
-- seule source de vérité actuelle pour ces deux fonctions), plus le seul changement ciblé par point
-- ci-dessus. Signatures inchangées.

-- ============================================================================================
-- 1. submit_product_creation_proposal — retrait du plafond "1 pending par établissement"
--    (dernière définition : 20260818093000_product_default_capacity_proposal_parity.sql)
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
       ) else '{}'::jsonb end;

  insert into public.product_proposals
    (product_id, establishment_id, partner_id, submitted_by, kind, type, payload)
  values (null, p_establishment_id, v_partner_id, v_account_id, 'create', p_type, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ============================================================================================
-- 2. moderate_product_proposal — renvoie désormais product_id (non-null seulement pour
--    approve+kind='create') pour qu'ModerateProductCreationProposalForm.tsx puisse proposer une
--    publication immédiate. Seul le `return` final change ; les 4 branches elles-mêmes sont
--    inchangées au mot près (dernière définition : 20260818093000_product_default_capacity_proposal_parity.sql).
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
