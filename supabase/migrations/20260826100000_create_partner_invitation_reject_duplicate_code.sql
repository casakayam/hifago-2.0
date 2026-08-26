-- Demande Jérôme (2026-08-26) : un code déjà attribué à un autre socio pouvait être réutilisé en
-- silence à la création d'une invitation (`insert ... on conflict (code) do nothing`, pensé pour
-- le cas légitime d'un code pré-créé/whitelisté AVANT que le partenaire n'existe, cahier des
-- charges socio §3b) — sans distinguer "code encore libre" de "code déjà pris par quelqu'un
-- d'autre". Un admin qui tape par erreur (ou par méconnaissance) le code d'un socio déjà actif ne
-- recevait aucune erreur ; le code restait attribué à l'ancien partenaire jusqu'à la consommation
-- de cette nouvelle invitation, qui le réattribuerait alors silencieusement au nouveau socio
-- (`consume_partner_invitation` réécrit `partner_codes.partner_id` sans condition).
--
-- Correctif : même garde que `create_partner_direct` (20260819160000_remove_partner_entity_type.sql,
-- déjà correcte sur ce point) — verrouille la ligne du code, rejette si elle existe déjà avec un
-- partner_id non nul. Un code encore non attribué (pré-créé/whitelisté, ou tout simplement
-- inexistant) reste réutilisable tel quel, comportement inchangé.
--
-- Base de cette CREATE OR REPLACE : le corps LIVE de la fonction (pg_get_functiondef), qui inclut
-- déjà l'email optionnel (spec 23, `<ts>_partner_invitation_email.sql`) absent du fichier de
-- migration d'origine — évite de régresser cette évolution comme cela avait déjà été fait par
-- erreur une première fois cette semaine sur consume_partner_invitation (leçon retenue, cf.
-- hifago/CLAUDE.md §11 pièges empiriques). Signature strictement inchangée.
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
  v_email text;
  v_app_base_url text;
  v_existing_code_partner uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_partner_invitation réservé au rôle admin' using errcode = '42501';
  end if;
  if p_onboarding_path not in ('referrer', 'provider') then
    raise exception 'onboarding_path invalide : %', p_onboarding_path;
  end if;

  -- Verrouille la ligne du code (si elle existe) le temps de la vérification + de l'écriture —
  -- évite qu'un second appel concurrent sur le même code passe entre la lecture et l'écriture.
  select partner_id into v_existing_code_partner
    from public.partner_codes where code = p_code for update;

  if found and v_existing_code_partner is not null then
    raise exception 'Ese código ya está asignado a otro socio' using errcode = '23505';
  end if;

  insert into public.partner_codes (code) values (p_code) on conflict (code) do nothing;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_email := nullif(btrim(p_email), '');

  insert into public.partner_invitations (
    token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by, email
  ) values (
    v_token_hash, p_code, p_onboarding_path, p_partner_hint,
    now() + (p_expires_days || ' days')::interval, auth.uid(), v_email
  )
  returning id into v_invitation_id;

  perform public.log_admin_action(
    'partner_invitation.create', 'partner_invitations', v_invitation_id,
    null, jsonb_build_object('code', p_code, 'onboarding_path', p_onboarding_path), null
  );

  -- Isolation (spec 23 §8.1) : un email cassé ne doit jamais faire échouer la création de
  -- l'invitation elle-même — le jeton reste utilisable via le lien affiché à l'écran même si
  -- l'enqueue échoue. when others seul ne suffit pas (query_canceled en est exclu par construction).
  if v_email is not null then
    begin
      -- Base URL publique de apps/admin, seedée par environnement (jamais une valeur en dur, elle
      -- diffère local/preprod/prod) — même mécanisme Vault que pms_functions_base_url
      -- (20260819140000_pms_jobs_cron.sql), secret distinct car sémantiquement différent (URL
      -- publique cliquable par un humain, pas un endpoint Edge Function interne).
      select decrypted_secret into v_app_base_url
        from vault.decrypted_secrets where name = 'admin_app_public_url';
      if v_app_base_url is null then
        raise warning 'create_partner_invitation: secret Vault admin_app_public_url manquant — email non enqueue (lien affiché à l''écran reste la seule voie)';
      else
        perform public.enqueue_notification_email(
          'partner_invitation',
          v_email,
          null,
          'Invitación a unirte a Hifago',
          '<p>Has recibido una invitación para unirte a Hifago.</p>'
            || '<p><a href="' || v_app_base_url || '/partner/join?token=' || v_token || '">Aceptar invitación</a></p>'
            || '<p>Este enlace es de un solo uso y expira pronto.</p>',
          'partner_invitations',
          v_invitation_id
        );
      end if;
    exception
      when query_canceled then
        raise warning 'create_partner_invitation: enqueue annulé (query_canceled) pour % — %', v_invitation_id, sqlerrm;
      when others then
        raise warning 'create_partner_invitation: échec enqueue pour % — %', v_invitation_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'invitation_id', v_invitation_id, 'token', v_token);
end;
$$;

grant execute on function create_partner_invitation(text, text, jsonb, int, text) to authenticated;
