-- Bug remonté par Jérôme (2026-08-25) : le nom saisi dans le formulaire d'invitation
-- (/partner/join, JoinForm.tsx, p_signer_name) n'apparaissait jamais sur "Mi cuenta". Root cause :
-- consume_partner_invitation écrivait p_signer_name dans partners.display_name (l'organisation,
-- seulement à la création) et role_agreements.signer_name (audit du consentement), jamais dans
-- partner_accounts.full_name (le profil du compte de connexion individuel, colonne ajoutée après
-- coup par 20260819100000_partner_account_self_profile.sql, jamais synchronisée en retour ici).
--
-- Base de cette CREATE OR REPLACE : le corps LIVE de la fonction tel que défini par
-- 20260819160000_remove_partner_entity_type.sql (dernière migration à l'avoir touchée — pas le
-- corps de la toute première migration 20260813171334, qui référence encore partners.entity_type,
-- retiré depuis, et qui n'a pas la branche invitation "partner_id déjà attaché" de
-- create_partner_direct). Signature strictement inchangée (cf. piège #13 CLAUDE.md — une signature
-- différente ne remplace jamais l'ancienne fonction).
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
  v_full_name text := nullif(btrim(coalesce(p_signer_name, '')), '');
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

  -- full_name : seulement si pas déjà renseigné (ex. via "Mi cuenta" avant cette invitation) —
  -- jamais écraser silencieusement une valeur que le compte a lui-même choisie, même invraisemblable
  -- dans ce parcours (même invariant que update_my_account_profile).
  update public.partner_accounts
     set partner_id = v_partner_id,
         full_name = coalesce(partner_accounts.full_name, v_full_name)
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

grant execute on function consume_partner_invitation(text, text, text, text, text) to authenticated;
