-- Retour Jérôme (2026-08-19, refonte vue prestataire) : "Proponer un nuevo establecimiento" n'a
-- jamais eu de champ photo, contrairement à "Proponer una nueva ficha" (produit, révisé le
-- 2026-08-17 par 20260817140000_product_creation_proposal_photos.sql) et contrairement à l'écran
-- d'édition d'établissement (PhotosSocioBlock, 20260817120000_establishment_photos_socio.sql) —
-- incohérence entre les deux formulaires établissement, signalée après capture d'écran. Comble le
-- gap en répliquant EXACTEMENT le patron déjà éprouvé pour la création de produit : photos
-- uploadées en Storage au recadrage (StagedEstablishmentPhotos, avant que l'établissement existe),
-- rattachées à establishment_media UNIQUEMENT à l'approbation admin, jamais depuis
-- p_corrected_payload (le formulaire de modération n'édite jamais les photos).

-- ============================================================================================
-- 1. Extension de submit_establishment_creation_proposal — whitelist + plafond 6 photos
-- ============================================================================================

create or replace function submit_establishment_creation_proposal(p_payload jsonb)
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

  v_partner_id := (select public.partner_id_for_account(v_account_id));
  if v_partner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_partner');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if exists (
    select 1 from public.establishment_proposals
     where partner_id = v_partner_id and kind = 'create' and status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pending_creation_exists');
  end if;

  -- Photos : plafond 6, même invariant que submit_product_creation_proposal (révision
  -- 20260817140000) — le lieu n'existe pas encore, aucune galerie existante à cumuler.
  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  -- Whitelist explicite : jamais operated_directly (classification métier/plateforme, cf.
  -- commentaire de tête de 20260815170000_gestion_etablissement.sql), jamais un champ hors
  -- présentation.
  v_safe_payload := jsonb_build_object(
    'name', p_payload -> 'name', 'description', p_payload -> 'description',
    'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
    'photos', v_safe_photos
  );

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ============================================================================================
-- 2. Extension de moderate_establishment_proposal — branche kind='create' rattache les photos
-- ============================================================================================

-- Signature INCHANGÉE (reprise intégrale de 20260817120000_establishment_photos_socio.sql, aucune
-- régression sur les branches kind='photos'/'edit'/reject) — seule la branche kind='create' change :
-- après create_establishment, les photos proposées (TOUJOURS depuis v_proposal.payload, jamais
-- p_corrected_payload qui ne les porte pas) sont rattachées à establishment_media, même boucle sort
-- continu que la branche kind='photos' juste au-dessus.
create or replace function moderate_establishment_proposal(
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
  v_current_operated_directly boolean;
  v_new_establishment_id uuid;
  v_photo jsonb;
  v_next_sort int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_establishment_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, establishment_id, partner_id, kind, payload, status, version, reviewed_by
    into v_proposal
    from public.establishment_proposals where id = p_proposal_id for update;

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

  if p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.establishment_media where establishment_id = v_proposal.establishment_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.establishment_media (establishment_id, storage_path, sort)
      values (v_proposal.establishment_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.establishment_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.approve_photos', 'establishment_media',
      v_proposal.establishment_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    -- Le payload CORRIGÉ par l'admin prime, jamais silencieusement remplacé par ce que le
    -- partenaire avait initialement soumis (même invariant que moderate_product_proposal) — les
    -- photos, elles, ne sont jamais corrigibles ici (formulaire de modération lecture seule sur ce
    -- champ, cf. commentaire de tête), toujours reprises depuis la soumission originale.
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'address', coalesce(p_corrected_payload -> 'address', v_proposal.payload -> 'address'),
      'lat', coalesce(p_corrected_payload -> 'lat', v_proposal.payload -> 'lat'),
      'lon', coalesce(p_corrected_payload -> 'lon', v_proposal.payload -> 'lon'),
      'photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb)
    );

    if v_proposal.kind = 'create' then
      -- operated_directly forcé à false : jamais proposable par le socio (cf. commentaire de tête
      -- de 20260815170000_gestion_etablissement.sql).
      select public.create_establishment(
        v_proposal.partner_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        false
      ) into v_new_establishment_id;

      -- Photos : même mécanique que la branche kind='photos' ci-dessus (sort continu depuis 0,
      -- establishment_media n'a encore aucune ligne pour un établissement tout juste créé).
      if jsonb_typeof(v_final_payload -> 'photos') = 'array' then
        v_next_sort := 0;
        for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos') loop
          insert into public.establishment_media (establishment_id, storage_path, sort)
          values (v_new_establishment_id, v_photo ->> 'storage_path', v_next_sort);
          v_next_sort := v_next_sort + 1;
        end loop;
      end if;

      update public.establishment_proposals
         set status = 'approved', establishment_id = v_new_establishment_id, payload = v_final_payload,
             reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    else
      -- operated_directly relu depuis la ligne existante et repassé tel quel : update_establishment
      -- remplace tous les champs, jamais un patch partiel.
      select operated_directly into v_current_operated_directly
        from public.establishments where id = v_proposal.establishment_id;

      perform public.update_establishment(
        v_proposal.establishment_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        v_current_operated_directly,
        'Aprobado desde propuesta ' || p_proposal_id
      );

      update public.establishment_proposals
         set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
             reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    end if;
  else
    update public.establishment_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.reject', 'establishment_proposals',
      p_proposal_id, null, null, p_rejection_reason);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
