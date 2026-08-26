-- Spec 23 Tranche 1 §7 — invitation partenaire par email.
-- Le lien d'invitation reste transmis manuellement par WhatsApp aujourd'hui
-- (NewInvitationForm.tsx affiche le lien à copier-coller) — cette migration ajoute un canal email
-- optionnel EN PLUS, jamais un remplacement : email nullable, aucun appelant existant cassé.
--
-- L'enqueue lui-même est posé dans la migration suivante (20260824030000, après la création de
-- notification_emails/enqueue_notification_email) — cette migration se limite à la colonne et au
-- paramètre, pour rester testable indépendamment.
alter table partner_invitations add column email text;

-- Signature étendue (nouveau paramètre en dernière position, défaut null) : aucun appelant
-- existant cassé — create or replace seul suffit, pas de drop.
create or replace function create_partner_invitation(
  p_code text,
  p_onboarding_path text,
  p_partner_hint jsonb default null,
  p_expires_days int default 7,
  p_email text default null
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

  insert into public.partner_codes (code) values (p_code) on conflict (code) do nothing;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.partner_invitations (
    token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by, email
  ) values (
    v_token_hash, p_code, p_onboarding_path, p_partner_hint,
    now() + (p_expires_days || ' days')::interval, auth.uid(), nullif(btrim(p_email), '')
  )
  returning id into v_invitation_id;

  perform public.log_admin_action(
    'partner_invitation.create', 'partner_invitations', v_invitation_id,
    null, jsonb_build_object('code', p_code, 'onboarding_path', p_onboarding_path), null
  );

  return jsonb_build_object('ok', true, 'invitation_id', v_invitation_id, 'token', v_token);
end;
$$;

grant execute on function create_partner_invitation(text, text, jsonb, int, text) to authenticated;
