-- Refonte parcours partenaire ↔ LobbyPMS (retour Jérôme 2026-08-25, en testant le connecteur en
-- staging) : aujourd'hui lier Lobby est un geste 100% admin-only, fait APRÈS coup sur un
-- établissement déjà créé (set_establishment_pms_connector, 20260819110000) — jamais dans le
-- parcours normal d'un partenaire qui rejoint la plateforme. Cette migration permet à un socio
-- d'inclure son token Lobby directement dans sa proposition d'établissement (création OU édition),
-- que l'admin teste ("Probar conexión", réutilisé tel quel) et active à l'approbation.
--
-- Sécurité : establishment_proposals.payload est un jsonb générique, sans la protection
-- column-level extrême dont bénéficie establishments.lobby_api_token (jamais relisible via
-- PostgREST une fois sauvegardé, cf. 20260819110000). Le token proposé par le socio reste donc en
-- clair UNIQUEMENT tant que status='pending' (l'admin doit le lire pour le tester) — dès que
-- moderate_establishment_proposal tranche (approve OU reject) ou que
-- withdraw_establishment_proposal retire la proposition, le token est retiré du jsonb stocké et
-- remplacé par un simple booléen lobby_api_token_provided. Les 3 chemins sont traités, pas
-- seulement l'approbation : un socio qui saisit un vrai token puis se rétracte ne doit jamais le
-- laisser traîner en clair.
--
-- Activation du connecteur = décision explicite de l'admin (p_activate_pms_connector, jamais
-- déduite automatiquement) — set_establishment_pms_connector n'est appelée que si un token est
-- réellement présent dans le payload final, dans la même transaction que la création/mise à jour
-- de l'établissement (rollback conjoint si le connecteur échoue à se poser).

-- ================================================================================================
-- 1. submit_establishment_creation_proposal — whitelist + lobby_api_token optionnel
-- ================================================================================================
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
  v_lobby_token text;
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

  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
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

  v_lobby_token := nullif(btrim(p_payload ->> 'lobby_api_token'), '');

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
      'photos', v_safe_photos
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end;

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ================================================================================================
-- 2. submit_establishment_edit_proposal — même whitelist étendue
-- ================================================================================================
create or replace function submit_establishment_edit_proposal(p_establishment_id uuid, p_payload jsonb)
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
  v_lobby_token text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  if not exists (
    select 1 from public.establishments
     where id = p_establishment_id and partner_id = v_partner_id
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
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  v_lobby_token := nullif(btrim(p_payload ->> 'lobby_api_token'), '');

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end;

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (p_establishment_id, v_partner_id, v_account_id, 'edit', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ================================================================================================
-- 3. withdraw_establishment_proposal — rédaction du token avant retrait
-- ================================================================================================
create or replace function withdraw_establishment_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_partner_id uuid;
  v_status text;
  v_payload jsonb;
  v_redacted_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select partner_id, status, payload into v_proposal_partner_id, v_status, v_payload
    from public.establishment_proposals where id = p_proposal_id for update;

  if not found or v_proposal_partner_id is distinct from v_partner_id then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  -- Rédaction du token avant retrait (cf. commentaire de tête) : un socio qui se rétracte après
  -- avoir collé un vrai token ne doit jamais le laisser traîner en clair.
  v_redacted_payload := case when v_payload ? 'lobby_api_token'
    then (v_payload - 'lobby_api_token') || jsonb_build_object('lobby_api_token_provided', true)
    else v_payload end;

  update public.establishment_proposals
     set status = 'withdrawn', payload = v_redacted_payload, updated_at = now()
   where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ================================================================================================
-- 4. moderate_establishment_proposal — active le connecteur PMS + rédaction du token
-- ================================================================================================
-- Nouveau paramètre p_activate_pms_connector en fin de liste (default false). `create or replace`
-- ne remplace une fonction en place QUE si la liste de types de paramètres D'ENTRÉE est identique
-- — ajouter un paramètre, même avec un default, crée une SURCHARGE séparée plutôt que de remplacer
-- l'ancienne (piège déjà rencontré dans ce repo, cf. 20260824100000_fix_create_partner_invitation_
-- overload.sql) : `moderate_establishment_proposal(uuid, unknown, integer, unknown, unknown)`
-- devient ambigu entre les deux signatures dès qu'un appelant omet le nouveau paramètre. DROP
-- explicite de l'ancienne arité avant le CREATE OR REPLACE, seule façon fiable d'éviter ça.
drop function if exists moderate_establishment_proposal(uuid, text, int, jsonb, text);

create or replace function moderate_establishment_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_expected_version int,
  p_corrected_payload jsonb default null,
  p_rejection_reason text default null,
  p_activate_pms_connector boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_stored_payload jsonb;
  v_reviewer_email text;
  v_current_operated_directly boolean;
  v_new_establishment_id uuid;
  v_photo jsonb;
  v_next_sort int;
  v_submitted_by uuid;
  v_submitted_by_email text;
  v_entity_name text;
  v_subject text;
  v_body text;
  v_lobby_token text;
  v_target_establishment_id uuid;
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
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'address', coalesce(p_corrected_payload -> 'address', v_proposal.payload -> 'address'),
      'lat', coalesce(p_corrected_payload -> 'lat', v_proposal.payload -> 'lat'),
      'lon', coalesce(p_corrected_payload -> 'lon', v_proposal.payload -> 'lon'),
      'photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb)
    );
    v_lobby_token := nullif(btrim(coalesce(
      p_corrected_payload ->> 'lobby_api_token', v_proposal.payload ->> 'lobby_api_token'
    )), '');

    if v_proposal.kind = 'create' then
      select public.create_establishment(
        v_proposal.partner_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        false
      ) into v_new_establishment_id;

      if jsonb_typeof(v_final_payload -> 'photos') = 'array' then
        v_next_sort := 0;
        for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos') loop
          insert into public.establishment_media (establishment_id, storage_path, sort)
          values (v_new_establishment_id, v_photo ->> 'storage_path', v_next_sort);
          v_next_sort := v_next_sort + 1;
        end loop;
      end if;

      v_target_establishment_id := v_new_establishment_id;

      if v_lobby_token is not null then
        perform public.set_establishment_pms_connector(
          v_new_establishment_id, v_lobby_token, p_activate_pms_connector,
          'Aprobado desde propuesta ' || p_proposal_id
        );
      end if;

      v_stored_payload := v_final_payload - 'lobby_api_token';
      if v_lobby_token is not null then
        v_stored_payload := v_stored_payload || jsonb_build_object('lobby_api_token_provided', true);
      end if;

      update public.establishment_proposals
         set status = 'approved', establishment_id = v_new_establishment_id, payload = v_stored_payload,
             reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    else
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

      v_target_establishment_id := v_proposal.establishment_id;

      if v_lobby_token is not null then
        perform public.set_establishment_pms_connector(
          v_proposal.establishment_id, v_lobby_token, p_activate_pms_connector,
          'Aprobado desde propuesta ' || p_proposal_id
        );
      end if;

      v_stored_payload := v_final_payload - 'lobby_api_token';
      if v_lobby_token is not null then
        v_stored_payload := v_stored_payload || jsonb_build_object('lobby_api_token_provided', true);
      end if;

      update public.establishment_proposals
         set status = 'approved', payload = v_stored_payload, reviewed_by = auth.uid(),
             reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    end if;
  else
    -- Rejet : rédaction du token avant stockage, même invariant que l'approbation/le retrait.
    v_stored_payload := case when v_proposal.payload ? 'lobby_api_token'
      then (v_proposal.payload - 'lobby_api_token') || jsonb_build_object('lobby_api_token_provided', true)
      else v_proposal.payload end;

    update public.establishment_proposals
       set status = 'rejected', payload = v_stored_payload, rejection_reason = p_rejection_reason,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.reject', 'establishment_proposals',
      p_proposal_id, null, null, p_rejection_reason);
  end if;

  -- Spec 23 §0/§7 — notification partenaire du verdict, isolée (§8.1).
  begin
    select submitted_by into v_submitted_by from public.establishment_proposals where id = p_proposal_id;
    select email into v_submitted_by_email from auth.users where id = v_submitted_by;
    v_entity_name := coalesce(v_proposal.payload -> 'name' ->> 'es', 'Establecimiento sin nombre');

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
      'establishment_proposals', p_proposal_id
    );
  exception
    when query_canceled then
      raise warning 'moderate_establishment_proposal: notification annulée (query_canceled) pour % — %', p_proposal_id, sqlerrm;
    when others then
      raise warning 'moderate_establishment_proposal: échec notification pour % — %', p_proposal_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true);
end;
$$;

-- Nouvelle arité (6 paramètres, p_activate_pms_connector ajouté) : l'ancienne signature à 5
-- paramètres n'existe plus après ce CREATE OR REPLACE (PL/pgSQL remplace la fonction identifiée par
-- son nom + ses types de paramètres d'ENTRÉE ; un appelant qui omettrait ce 6e paramètre continue
-- de fonctionner grâce au default false, donc aucun call site existant ne casse).
grant execute on function moderate_establishment_proposal(uuid, text, int, jsonb, text, boolean) to authenticated;
