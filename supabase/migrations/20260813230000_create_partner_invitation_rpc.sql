-- Feature 13 (Socio : rejoindre via une invitation) — RPC create_partner_invitation.
-- Gap constaté en préparant cette feature (2026-08-13, Jérôme) : consume_partner_invitation
-- (Tranche 1, déjà gatée) exige une ligne partner_invitations existante, mais aucune RPC ni écran
-- ne permet d'en créer une — partner_invitations est RPC-only (revoke insert...,
-- 20260813163456_identity_rls.sql), donc même l'admin ne peut pas en poser une en direct.
--
-- Action admin bas-volume sans compteur de capacité (même calibrage que create_establishment/
-- log_admin_action) : security definer + contrôle is_admin() interne, pas le squelette
-- anti-survente (pas de FOR UPDATE ici, aucune ressource à capacité limitée n'est touchée).
create or replace function create_partner_invitation(
  p_code text,
  p_onboarding_path text,
  p_partner_hint jsonb default null,
  p_expires_days int default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_partner_invitation réservé au rôle admin' using errcode = '42501';
  end if;
  if p_onboarding_path not in ('referrer', 'provider') then
    raise exception 'onboarding_path invalide : %', p_onboarding_path;
  end if;

  -- Code pré-créé s'il n'existe pas encore (cahier des charges socio §3b : un code peut être
  -- « pré-créé/whitelisté » avant que le partenaire n'existe) ; réutilisé tel quel s'il existe déjà.
  insert into public.partner_codes (code) values (p_code) on conflict (code) do nothing;

  -- Jeton opaque à usage unique : seul son hash SHA-256 persiste (cahier des charges socio §3b —
  -- « jamais le code partenaire public seul comme preuve d'autorisation », déjà l'esprit de
  -- consume_partner_invitation). Le jeton brut n'est retourné qu'une fois, à la création.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.partner_invitations (
    token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by
  ) values (
    v_token_hash, p_code, p_onboarding_path, p_partner_hint,
    now() + (p_expires_days || ' days')::interval, auth.uid()
  )
  returning id into v_invitation_id;

  perform public.log_admin_action(
    'partner_invitation.create', 'partner_invitations', v_invitation_id,
    null, jsonb_build_object('code', p_code, 'onboarding_path', p_onboarding_path), null
  );

  return jsonb_build_object('ok', true, 'invitation_id', v_invitation_id, 'token', v_token);
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated (le
-- contrôle d'accès réel est le is_admin() interne ci-dessus, même posture que create_establishment).
grant execute on function create_partner_invitation(text, text, jsonb, int) to authenticated;
