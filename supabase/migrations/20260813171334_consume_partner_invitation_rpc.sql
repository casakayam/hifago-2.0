-- Tranche 1 (identité composable) — RPC critique consume_partner_invitation.
-- Squelette copié de hifago/docs/05-reference-technique.md §1 (verrouillage explicite,
-- security definer, search_path vide, un seul aller-retour). La « ressource à capacité limitée »
-- ici est l'invitation elle-même : exactement une consommation doit réussir par token, jamais deux
-- sous concurrence réelle (double-clic, double onglet, race sur un lien partagé).

create or replace function consume_partner_invitation(
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

  -- Verrouillage explicite : bloque toute autre transaction visant la même invitation jusqu'au
  -- commit/rollback de celle-ci. C'est ce verrou, pas une vérification applicative préalable, qui
  -- garantit qu'un seul appelant peut consommer un token donné sous concurrence réelle.
  select id, promo_code, onboarding_path, status, expires_at, partner_hint
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

  insert into public.partners (display_name, entity_type, partner_city)
  values (
    coalesce(v_invitation.partner_hint->>'display_name', p_signer_name),
    coalesce(v_invitation.partner_hint->>'entity_type', 'organization'),
    v_invitation.partner_hint->>'partner_city'
  )
  returning id into v_partner_id;

  update public.partner_accounts
     set partner_id = v_partner_id
   where id = v_account_id;

  update public.partner_codes
     set partner_id = v_partner_id
   where code = v_invitation.promo_code;

  v_roles := case v_invitation.onboarding_path
    when 'provider' then array['referrer', 'operator']
    else array['referrer']
  end;

  -- referrer inséré avant operator (ordre du tableau) : l'invariant operator ⇒ referrer (0002)
  -- exige que la ligne referrer existe déjà au moment de l'insertion operator.
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

  update public.partner_invitations
     set status = 'consumed',
         consumed_at = now(),
         consumed_by_account_id = v_account_id
   where id = v_invitation.id;

  return jsonb_build_object('ok', true, 'partner_id', v_partner_id, 'roles', v_roles);
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (même constat empirique que pour les tables, cf. 0003_identity_rls) — accordé
-- explicitement au seul rôle authenticated (anon n'a de toute façon pas d'auth.uid()).
grant execute on function consume_partner_invitation(text, text, text, text, text) to authenticated;

