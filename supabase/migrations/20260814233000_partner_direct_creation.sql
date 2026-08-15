-- Feature 26 (Admin : création directe d'un partenaire) — docs/specs/01-admin-creation-partenaire.md.
-- Comble le manque déjà validé au cahier des charges admin §2 (2026-08-11) : « l'admin gère aussi
-- tous les comptes du système... directement : création, modification, désactivation » — jamais
-- implémenté jusqu'ici, seuls existaient create_partner_invitation (admin crée une invitation) et
-- consume_partner_invitation (le PARTENAIRE crée sa propre ligne partners à l'auto-enregistrement).
--
-- Reprise fidèle du CRM legacy (`crm.json`, src/services/crmService.js), pas une invention : même
-- forme pour `bank` (nombre/bancolombia/nequi/received_at), mêmes champs barrio/address/tags/
-- status/notes/last_contact/last_payment/rdv/lat/lon — simplement remontés en table Postgres au
-- lieu d'un fichier JSON séparé, unifiés dans le même écran de création (décision Jérôme
-- 2026-08-14) plutôt qu'une étape CRM postérieure comme en legacy.

-- 1. partner_crm_profile — 1:1 avec partners. RPC-only (écriture à auditer nominativement,
-- cf. hifago/CLAUDE.md §3 critère 1 — toute écriture admin est déjà un invariant transverse,
-- cahier des charges admin §4) : seule la RPC create_partner_direct y écrit pour l'instant.
-- L'édition d'une fiche déjà existante est hors périmètre de cette feature (spec §2, "out") —
-- une future spec « fiche 360 » ajoutera sa propre RPC de mise à jour le moment venu.
create table partner_crm_profile (
  partner_id uuid primary key references partners(id),
  bank jsonb,                    -- { nombre, bancolombia?:{numero_cuenta,tipo_cuenta}, nequi?:{telefono}, received_at } — même forme que crm.json legacy. Provisoire : non connecté au vrai payout tant qu'establishments.payout_method n'existe pas (spec §10).
  address text,
  barrio text,
  tags text[] not null default '{}',
  commercial_status text not null default 'prospecto'
    check (commercial_status in ('activo', 'inactivo', 'pausa', 'prospecto')),
  notes text,
  last_contact_at timestamptz,
  last_payment_at timestamptz,
  rdv_at timestamptz,
  lat double precision,
  lon double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pas de GRANT explicite nécessaire (ALTER DEFAULT PRIVILEGES de 20260813163456_identity_rls.sql
-- couvre déjà toute table future) ; conservé en clair par cohérence avec le style déjà en usage
-- sur les tables voisines (partner_capabilities, partner_invitations, role_agreements).
grant select on partner_crm_profile to authenticated;
alter table partner_crm_profile enable row level security;
revoke insert, update, delete on partner_crm_profile from authenticated, anon;

create policy partner_crm_profile_select on partner_crm_profile
  for select
  using (
    (select is_admin(auth.uid()))
    or partner_id = (select partner_id_for_account(auth.uid()))
  );

-- 2. partner_invitations.partner_id — nullable : null = comportement inchangé (/newp, /newr,
-- l'invitation pré-crée un code mais pas encore de partenaire, cf. create_partner_invitation) ;
-- non-null = l'admin a déjà créé le partenaire via create_partner_direct et l'invitation ne fait
-- plus que rattacher un compte de connexion (spec §4/§6).
alter table partner_invitations
  add column partner_id uuid references partners(id);

create index partner_invitations_partner_id_idx on partner_invitations(partner_id);

-- 3. create_partner_direct — squelette copié de create_partner_invitation/grant_capability
-- (security definer + search_path vide + contrôle is_admin() interne, pas le squelette
-- anti-survente complet : aucune ressource à capacité limitée n'est touchée par une simple
-- création d'identité, contrairement à une réservation). Un seul aller-retour, toutes les tables
-- écrites dans la même transaction implicite de la fonction.
create or replace function create_partner_direct(
  p_display_name text,
  p_entity_type text,
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
  if p_entity_type not in ('person', 'organization') then
    raise exception 'entity_type invalide : %', p_entity_type;
  end if;
  if v_roles is null or array_length(v_roles, 1) is null then
    raise exception 'au moins un rôle (referrer ou operator) est requis';
  end if;
  if exists (select 1 from unnest(v_roles) r where r not in ('referrer', 'operator')) then
    raise exception 'rôle invalide dans p_roles (seuls referrer/operator sont autorisés ici)';
  end if;
  -- operator ⇒ referrer (invariant Tranche 1, déjà imposé par trigger DB) : on s'assure que la
  -- ligne referrer est insérée en premier si l'appelant n'a demandé qu'operator — même ordre que
  -- consume_partner_invitation/grant_capability.
  if 'operator' = any(v_roles) and not ('referrer' = any(v_roles)) then
    v_roles := array_prepend('referrer', v_roles);
  end if;
  if p_send_invitation and p_code is null then
    raise exception 'un code d''attribution (p_code) est requis pour envoyer une invitation';
  end if;

  insert into public.partners (
    display_name, entity_type, legal_name, identification_type, identification_number,
    partner_city, email, phone
  ) values (
    p_display_name, p_entity_type, p_legal_name, p_identification_type, p_identification_number,
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

  -- Code d'attribution : réutilise un code pré-créé non attribué (whitelist /newp-/newr-style) ou
  -- en crée un neuf — jamais un rattachement en double (même invariant que set_partner_code_active
  -- / cahier des charges admin §5 : un code déjà attribué ne se renomme pas librement).
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

  -- Profil commercial optionnel (spec §10 : décision Jérôme, champs commerciaux unifiés dans
  -- l'écran de création plutôt qu'une étape CRM séparée comme en legacy).
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

  -- Invitation de connexion optionnelle (spec §4/§10) : réutilise l'infrastructure
  -- partner_invitations/consume_partner_invitation déjà éprouvée (token haché, TTL, usage unique)
  -- plutôt qu'un mot de passe posé par l'admin. partner_id déjà renseigné : consume_partner_invitation
  -- (étendue ci-dessous) rattache un compte au lieu de créer un nouveau partenaire.
  if p_send_invitation then
    v_onboarding_path := case when 'operator' = any(v_roles) then 'provider' else 'referrer' end;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

    insert into public.partner_invitations (
      token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by, partner_id
    ) values (
      v_token_hash, p_code, v_onboarding_path,
      jsonb_build_object('display_name', p_display_name, 'entity_type', p_entity_type, 'partner_city', p_partner_city),
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

grant execute on function create_partner_direct(
  text, text, text[], text, text, text, text, text, text, uuid, text, boolean, jsonb, boolean, int
) to authenticated;

-- 4. consume_partner_invitation étendue — si l'invitation porte déjà un partner_id (créée par
-- create_partner_direct ci-dessus), on rattache le compte au partenaire existant au lieu d'en
-- insérer un nouveau. Comportement inchangé quand partner_id est null (flux /newp, /newr existant,
-- create_partner_invitation) : verrouillage, contrôles de statut/expiration et insertion des
-- capacités/role_agreements restent identiques à hifago/supabase/migrations/
-- 20260813171334_consume_partner_invitation_rpc.sql, seule la branche marquée ci-dessous change.
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

  -- Seule branche nouvelle : un partenaire déjà créé par l'admin (create_partner_direct) ne se
  -- recrée pas ici, on rattache simplement le compte qui consomme l'invitation.
  if v_invitation.partner_id is not null then
    v_partner_id := v_invitation.partner_id;
  else
    insert into public.partners (display_name, entity_type, partner_city)
    values (
      coalesce(v_invitation.partner_hint->>'display_name', p_signer_name),
      coalesce(v_invitation.partner_hint->>'entity_type', 'organization'),
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

  -- Capacités déjà posées par create_partner_direct dans le cas rattaché : ne pas les recréer
  -- (contrainte unique partner_capabilities_partner_role_idx lèverait sinon une erreur).
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
-- Grant execute déjà posé par 20260813171334_consume_partner_invitation_rpc.sql (CREATE OR REPLACE
-- conserve les privilèges existants sur une fonction de même signature) — rien à re-déclarer.
