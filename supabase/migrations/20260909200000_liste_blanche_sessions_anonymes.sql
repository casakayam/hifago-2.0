-- Socle de la LISTE BLANCHE des sessions anonymes, et sa première application.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI CE SOCLE EXISTE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Décision de Jérôme (2026-09-09, entretien spec « identité anonyme ») : quand un visiteur aura un
-- auth.uid(), une RPC le REFUSE par défaut et ne l'accepte que si elle le dit nommément. C'est
-- l'échec fermé du §4.4 appliqué à l'identité : une RPC écrite dans six mois est fermée aux
-- visiteurs tant que personne ne l'ouvre, plutôt qu'ouverte tant que personne n'y pense.
--
-- Le socle manquait : `is_anonymous` n'apparaissait NULLE PART dans le projet (vérifié le
-- 2026-09-09 — les 100 occurrences trouvées sont des bundles .next/ de @supabase/auth-js).
--
-- ⚠️ POURQUOI LIRE auth.users ET NON LE CLAIM JWT. `auth.jwt() ->> 'is_anonymous'` fonctionne
-- (vérifié) et le JWT est signé, donc non falsifiable. Mais un jeton émis AVANT la conversion d'un
-- invité (le moment où il lie enfin son email) porte encore is_anonymous = true jusqu'à son
-- rafraîchissement : la garde refuserait alors quelqu'un qui vient précisément de cesser d'être
-- anonyme. La table est la source de vérité, et la lecture est une recherche par clé primaire.
--
-- Le repli est `false` : « aucune session » n'est PAS « session anonyme ». C'est voulu — la garde
-- `auth.uid() is null` de chaque RPC traite ce cas-là, avant celle-ci, et avec son propre message.
--
-- Checklist (CLAUDE.md §3) : STABLE (§3.3), SECURITY DEFINER + SET search_path = '' parce qu'elle
-- lit auth.users qu'un appelant ne peut pas lire lui-même (§3.3), auth.uid() enveloppé en
-- (select auth.uid()) (§3.4). Aucune table du schéma public touchée, aucune policy, aucun grant
-- modifié. Exécutable par tous : elle ne révèle que la nature de la session de l'appelant lui-même.

create or replace function public.is_anonymous_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_anonymous from auth.users u where u.id = (select auth.uid())),
    false
  );
$$;

comment on function public.is_anonymous_session() is
  'true si l''appelant est une session anonyme Supabase (auth.users.is_anonymous), false sinon — y '
  'compris quand il n''y a aucune session. Socle de la liste blanche décidée le 2026-09-09 : une RPC '
  'refuse un visiteur anonyme sauf mention explicite du contraire.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- PREMIÈRE APPLICATION : consume_partner_invitation
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Corps repris de pg_get_functiondef sur la base locale (ce qui tourne réellement) ; seul le bloc
-- commenté « 2026-09-09 » est ajouté.

CREATE OR REPLACE FUNCTION public.consume_partner_invitation(p_token text, p_signer_name text, p_document_version text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- 2026-09-09 — PREMIÈRE APPLICATION DE LA LISTE BLANCHE (décision Jérôme du même jour : une RPC
  -- refuse un visiteur anonyme SAUF si elle l'autorise nommément ; échec fermé, CLAUDE.md §4.4).
  --
  -- Devenir partenaire est l'exemple type de ce qu'une identité jetable ne doit pas pouvoir faire.
  -- Reproduit en réel avant correctif, sous une session anonyme (is_anonymous vrai, aucun email)
  -- détenant un lien d'invitation : retour {"ok": true, "roles": ["referrer"]}, capacité `referrer`
  -- ACTIVE, et surtout des `role_agreements` avec explicit_consent = true signés par un compte non
  -- ré-identifiable — un consentement contractuel sans personne derrière. La garde d'origine était
  -- `auth.uid() is null` en entier : elle disait « quelqu'un est connecté », ce qui cessera de
  -- vouloir dire « quelqu'un existe » le jour où les sessions anonymes s'ouvriront.
  --
  -- Placée APRÈS not_authenticated et AVANT toute lecture de l'invitation, volontairement : un
  -- anonyme ne doit pas non plus apprendre si un jeton est valide (le refus serait sinon un oracle).
  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
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
$function$;
