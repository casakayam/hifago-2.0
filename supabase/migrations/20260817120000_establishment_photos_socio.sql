-- Retourne la décision "établissements = 100% admin" (20260815110000_gestion_images.sql:72-75,
-- docs/specs/06-gestion-etablissement.md §2) : confirmé explicitement par Jérôme le 2026-08-17,
-- en session, après qu'un partenaire a signalé l'absence du geste sur /partner/establishment/[id]/
-- edit — fait nouveau au sens de hifago/CLAUDE.md §1.4, pas une remise en cause silencieuse.
-- Symétrique complet au mécanisme produit (kind='photos' de product_proposals,
-- submit_photos_proposal, branche photos de moderate_product_proposal, reorder_gallery socio) :
-- mêmes 3 garde-fous (identité/propriété/capacité), même plafond 6 uniforme, même agrégation d'une
-- proposition 'photos' pending par fiche plutôt qu'une par photo.
--
-- Frontière RLS/RPC-only (CLAUDE.md §3) : inchangée par cette migration — establishment_media reste
-- RLS directe (retrait = geste non capacitaire, non auditable nominativement autrement que par la
-- ligne elle-même) ; establishment_proposals reste RPC-only (déjà tranché, kind='photos' est une
-- variante de payload comme pour product_proposals, pas un nouveau critère de frontière).

-- ============================================================================================
-- 1. establishment_media — policy delete_own pour le socio (absente volontairement jusqu'ici)
-- ============================================================================================

-- Miroir direct de product_media_delete_own, mais sans le join products→establishment_id
-- intermédiaire : establishment_id vit déjà sur la ligne elle-même.
create policy establishment_media_delete_own on establishment_media
  for delete using (
    (select has_capability(auth.uid(), 'operator', establishment_media.establishment_id))
  );

-- ============================================================================================
-- 2. establishment_proposals — kind='photos'
-- ============================================================================================

alter table establishment_proposals drop constraint establishment_proposals_kind_check;
alter table establishment_proposals
  add constraint establishment_proposals_kind_check check (kind in ('create', 'edit', 'photos'));

-- Une proposition 'photos' ne porte jamais sur une fiche pas encore créée (contrairement à
-- 'create') : establishment_id toujours renseigné, aucune contrainte de statut particulière.
alter table establishment_proposals drop constraint establishment_proposals_scope;
alter table establishment_proposals
  add constraint establishment_proposals_scope check (
    (kind = 'edit' and establishment_id is not null)
    or (kind = 'photos' and establishment_id is not null)
    or (kind = 'create' and establishment_id is null and status <> 'approved')
    or (kind = 'create' and establishment_id is not null and status = 'approved')
  );

-- ============================================================================================
-- 3. RPC submit_establishment_photos_proposal — socio, proposition "photos seules"
-- ============================================================================================

-- Copie fidèle de submit_photos_proposal (20260815110000_gestion_images.sql) : la "propriété" ici
-- est directe (establishments.partner_id), pas via un produit intermédiaire — même différence déjà
-- appliquée entre submit_establishment_edit_proposal et submit_product_proposal.
create or replace function submit_establishment_photos_proposal(
  p_establishment_id uuid,
  p_storage_paths text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_existing record;
  v_has_existing boolean;
  v_proposal_id uuid;
  v_existing_count int;
  v_gallery_count int;
  v_new_photos jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_storage_paths is null or array_length(p_storage_paths, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_photos');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  -- Garde-fous 1+2 (identité + propriété), même réponse "introuvable" dans les deux cas — même
  -- raisonnement que submit_establishment_edit_proposal.
  if not exists (
    select 1 from public.establishments
     where id = p_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis.
  if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  select id, payload into v_existing
    from public.establishment_proposals
   where establishment_id = p_establishment_id and kind = 'photos' and status = 'pending'
   for update;
  -- FOUND est écrasé par le prochain SELECT INTO (count(*) renvoie toujours exactement une ligne,
  -- donc FOUND vaudrait toujours true après lui) — capturé ici, juste après la seule requête dont
  -- le résultat nous intéresse réellement (même précaution que submit_photos_proposal).
  v_has_existing := found;

  select count(*) into v_gallery_count
    from public.establishment_media where establishment_id = p_establishment_id;
  v_existing_count := coalesce(jsonb_array_length(v_existing.payload -> 'photos'), 0);

  -- Plafond 6 uniforme : galerie déjà publiée + proposition en attente + nouvel ajout.
  if v_gallery_count + v_existing_count + array_length(p_storage_paths, 1) > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;

  v_new_photos := (
    select jsonb_agg(jsonb_build_object('storage_path', sp)) from unnest(p_storage_paths) as sp
  );

  if v_has_existing then
    update public.establishment_proposals
       set payload = jsonb_set(
             v_existing.payload, '{photos}',
             coalesce(v_existing.payload -> 'photos', '[]'::jsonb) || v_new_photos
           ),
           updated_at = now()
     where id = v_existing.id
    returning id into v_proposal_id;
  else
    -- Plafond de propositions en attente (même valeur littérale que submit_establishment_edit_
    -- proposal), vérifié seulement à la création d'une NOUVELLE ligne pending.
    if (
      select count(*) from public.establishment_proposals
       where partner_id = v_partner_id and status = 'pending'
    ) >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
    end if;

    insert into public.establishment_proposals
      (establishment_id, partner_id, submitted_by, kind, payload)
    values (p_establishment_id, v_partner_id, v_account_id, 'photos',
      jsonb_build_object('photos', v_new_photos))
    returning id into v_proposal_id;
  end if;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

grant execute on function submit_establishment_photos_proposal(uuid, text[]) to authenticated;

-- withdraw_establishment_proposal (20260815170000) fonctionne déjà tel quel sur une proposition
-- kind='photos' — générique sur status/ownership, rien à étendre (même constat déjà fait pour
-- withdraw_product_proposal lors de l'ajout de kind='photos' à product_proposals).

-- ============================================================================================
-- 4. Extension de moderate_establishment_proposal — branche kind='photos'
-- ============================================================================================

-- Signature INCHANGÉE (pas de drop function nécessaire) : le branchement kind se fait entièrement
-- à l'intérieur du corps, même patron que l'extension déjà faite sur moderate_product_proposal.
-- Comportement kind='create'/'edit' repris à l'identique (aucune régression), nouvelle branche
-- kind='photos' qui n'écrit QUE establishment_media — jamais les colonnes de présentation.
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
    -- partenaire avait initialement soumis (même invariant que moderate_product_proposal).
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'address', coalesce(p_corrected_payload -> 'address', v_proposal.payload -> 'address'),
      'lat', coalesce(p_corrected_payload -> 'lat', v_proposal.payload -> 'lat'),
      'lon', coalesce(p_corrected_payload -> 'lon', v_proposal.payload -> 'lon')
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

-- ============================================================================================
-- 5. Extension de reorder_gallery — le socio réordonne aussi SA galerie établissement
-- ============================================================================================

-- Signature INCHANGÉE. Seul le garde-fou socio change : jusqu'ici tout p_entity_type='establishment'
-- non-admin était refusé en bloc (§3f ne couvrait alors que les produits) — la vérification de
-- propriété est directe ici (has_capability sur p_entity_id lui-même), pas via un join products
-- intermédiaire comme pour 'product'.
create or replace function reorder_gallery(
  p_entity_type text,          -- 'product' | 'establishment'
  p_entity_id uuid,
  p_ordered_media_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_owner_ok boolean;
  v_expected_count int;
  v_given_count int;
begin
  if p_entity_type not in ('product', 'establishment') then
    raise exception 'p_entity_type invalide : %', p_entity_type;
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  if not v_is_admin then
    if p_entity_type = 'product' then
      select exists (
        select 1 from public.products p
         where p.id = p_entity_id
           and (select public.has_capability(v_account_id, 'operator', p.establishment_id))
      ) into v_owner_ok;
    else
      v_owner_ok := (select public.has_capability(v_account_id, 'operator', p_entity_id));
    end if;
    if not v_owner_ok then
      return jsonb_build_object('ok', false, 'reason', 'not_authorized');
    end if;
  end if;

  if p_entity_type = 'product' then
    select count(*) into v_expected_count
      from public.product_media where product_id = p_entity_id;
  else
    select count(*) into v_expected_count
      from public.establishment_media where establishment_id = p_entity_id;
  end if;
  v_given_count := coalesce(array_length(p_ordered_media_ids, 1), 0);

  -- Liste incomplète/en trop : refus explicite plutôt qu'un réordonnancement partiel silencieux.
  if v_given_count <> v_expected_count then
    return jsonb_build_object('ok', false, 'reason', 'incomplete_order');
  end if;

  if p_entity_type = 'product' then
    update public.product_media m
       set sort = o.ord - 1
      from unnest(p_ordered_media_ids) with ordinality as o(id, ord)
     where m.id = o.id and m.product_id = p_entity_id;
  else
    update public.establishment_media m
       set sort = o.ord - 1
      from unnest(p_ordered_media_ids) with ordinality as o(id, ord)
     where m.id = o.id and m.establishment_id = p_entity_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
