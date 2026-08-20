-- Retrait de partners.entity_type (Organización/Persona) — champ audité le 2026-08-19 : jamais lu
-- par aucune logique métier (RLS, commission, facturation), pas même affiché sur la fiche
-- partenaire ni dans la liste, seul effet réel un filtre/tri sur l'écran liste admin. Décision
-- Jérôme : retirer plutôt que garder un champ mort sans logique accrochée dessus.

-- 1. create_partner_direct — signature changée (retrait de p_entity_type, 2e paramètre positionnel
-- d'origine), donc drop explicite de l'ancienne signature avant recréation (create or replace ne
-- couvre pas un changement de liste de paramètres).
drop function if exists public.create_partner_direct(
  text, text, text[], text, text, text, text, text, text, uuid, text, boolean, jsonb, boolean, int
);

create function public.create_partner_direct(
  p_display_name text,
  p_roles text[],
  p_legal_name text default null,
  p_identification_type text default null,
  p_identification_number text default null,
  p_partner_city text default null,
  p_email text default null,
  p_phone text default null,
  p_establishment_id uuid default null,
  p_code text default null,
  p_commission_enabled boolean default true,
  p_crm_profile jsonb default null,
  p_send_invitation boolean default true,
  p_invitation_expires_days int default 14
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid;
  v_roles text[] := p_roles;
  v_role text;
  v_capability_ids uuid[] := '{}';
  v_capability_id uuid;
  v_existing_code_partner uuid;
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_onboarding_path text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_partner_direct réservé au rôle admin' using errcode = '42501';
  end if;
  if v_roles is null or array_length(v_roles, 1) is null then
    raise exception 'au moins un rôle (referrer ou operator) est requis';
  end if;
  if exists (select 1 from unnest(v_roles) r where r not in ('referrer', 'operator')) then
    raise exception 'rôle invalide dans p_roles (seuls referrer/operator sont autorisés ici)';
  end if;
  if 'operator' = any(v_roles) and not ('referrer' = any(v_roles)) then
    v_roles := array_prepend('referrer', v_roles);
  end if;
  if p_send_invitation and p_code is null then
    raise exception 'un code d''attribution (p_code) est requis pour envoyer une invitation';
  end if;

  insert into public.partners (
    display_name, legal_name, identification_type, identification_number,
    partner_city, email, phone
  ) values (
    p_display_name, p_legal_name, p_identification_type, p_identification_number,
    p_partner_city, p_email, p_phone
  )
  returning id into v_partner_id;

  foreach v_role in array v_roles loop
    insert into public.partner_capabilities (
      partner_id, establishment_id, role, source
    ) values (
      v_partner_id,
      case when v_role = 'operator' then p_establishment_id else null end,
      v_role,
      'admin'
    )
    returning id into v_capability_id;
    v_capability_ids := array_append(v_capability_ids, v_capability_id);
  end loop;

  if p_code is not null then
    select partner_id into v_existing_code_partner from public.partner_codes where code = p_code for update;
    if not found then
      insert into public.partner_codes (code, partner_id, commission_enabled)
      values (p_code, v_partner_id, coalesce(p_commission_enabled, true));
    elsif v_existing_code_partner is null then
      update public.partner_codes
         set partner_id = v_partner_id, commission_enabled = coalesce(p_commission_enabled, true), updated_at = now()
       where code = p_code;
    else
      raise exception 'code déjà attribué à un autre partenaire' using errcode = '23505';
    end if;
  end if;

  if p_crm_profile is not null then
    insert into public.partner_crm_profile (
      partner_id, bank, address, barrio, tags, commercial_status, notes, lat, lon
    ) values (
      v_partner_id,
      p_crm_profile->'bank',
      p_crm_profile->>'address',
      p_crm_profile->>'barrio',
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(p_crm_profile->'tags')),
        '{}'
      ),
      coalesce(p_crm_profile->>'commercial_status', 'prospecto'),
      p_crm_profile->>'notes',
      nullif(p_crm_profile->>'lat', '')::double precision,
      nullif(p_crm_profile->>'lon', '')::double precision
    );
  end if;

  if p_send_invitation then
    v_onboarding_path := case when 'operator' = any(v_roles) then 'provider' else 'referrer' end;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

    insert into public.partner_invitations (
      token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by, partner_id
    ) values (
      v_token_hash, p_code, v_onboarding_path,
      jsonb_build_object('display_name', p_display_name, 'partner_city', p_partner_city),
      now() + (p_invitation_expires_days || ' days')::interval, auth.uid(), v_partner_id
    )
    returning id into v_invitation_id;
  end if;

  perform public.log_admin_action(
    'partner.create_direct', 'partners', v_partner_id, null,
    jsonb_build_object('display_name', p_display_name, 'roles', v_roles, 'code', p_code, 'invitation_id', v_invitation_id),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'partner_id', v_partner_id,
    'capability_ids', v_capability_ids,
    'roles', v_roles,
    'code', p_code,
    'invitation_id', v_invitation_id,
    'invitation_token', v_token
  );
end;
$$;

grant execute on function public.create_partner_direct(
  text, text[], text, text, text, text, text, text, uuid, text, boolean, jsonb, boolean, int
) to authenticated;

-- 2. consume_partner_invitation — signature inchangée, seule la branche création (partner_hint sans
-- entity_type, fallback retiré) et l'insert dans partners changent.
create or replace function public.consume_partner_invitation(
  p_token text,
  p_signer_name text,
  p_document_version text,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_invitation record;
  v_existing_partner_id uuid;
  v_partner_id uuid;
  v_roles text[];
  v_role text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select id, promo_code, onboarding_path, status, expires_at, partner_hint, partner_id
    into v_invitation
    from public.partner_invitations
   where token_hash = v_token_hash
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
  end if;

  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_' || v_invitation.status);
  end if;

  if v_invitation.expires_at < now() then
    update public.partner_invitations set status = 'expired' where id = v_invitation.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select partner_id into v_existing_partner_id
    from public.partner_accounts
   where id = v_account_id;

  if v_existing_partner_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_already_has_partner');
  end if;

  if v_invitation.partner_id is not null then
    v_partner_id := v_invitation.partner_id;
  else
    insert into public.partners (display_name, partner_city)
    values (
      coalesce(v_invitation.partner_hint->>'display_name', p_signer_name),
      v_invitation.partner_hint->>'partner_city'
    )
    returning id into v_partner_id;
  end if;

  update public.partner_accounts
     set partner_id = v_partner_id
   where id = v_account_id;

  update public.partner_codes
     set partner_id = v_partner_id
   where code = v_invitation.promo_code;

  if v_invitation.partner_id is null then
    v_roles := case v_invitation.onboarding_path
      when 'provider' then array['referrer', 'operator']
      else array['referrer']
    end;

    foreach v_role in array v_roles loop
      insert into public.partner_capabilities (partner_id, role, source)
      values (
        v_partner_id,
        v_role,
        case v_invitation.onboarding_path when 'provider' then 'newp' else 'newr' end
      );

      insert into public.role_agreements (
        partner_id, account_id, role, document_version, signer_name, explicit_consent, ip, user_agent
      )
      values (
        v_partner_id, v_account_id, v_role, p_document_version, p_signer_name, true, p_ip, p_user_agent
      );
    end loop;
  else
    v_roles := array(select role from public.partner_capabilities where partner_id = v_partner_id);
    foreach v_role in array v_roles loop
      insert into public.role_agreements (
        partner_id, account_id, role, document_version, signer_name, explicit_consent, ip, user_agent
      )
      values (
        v_partner_id, v_account_id, v_role, p_document_version, p_signer_name, true, p_ip, p_user_agent
      );
    end loop;
  end if;

  update public.partner_invitations
     set status = 'consumed',
         consumed_at = now(),
         consumed_by_account_id = v_account_id
   where id = v_invitation.id;

  return jsonb_build_object('ok', true, 'partner_id', v_partner_id, 'roles', v_roles);
end;
$$;

-- 3. Colonne retirée après mise à jour des deux RPC qui y écrivaient — plus aucun writer restant.
alter table public.partners drop column entity_type;
