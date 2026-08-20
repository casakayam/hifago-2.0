-- Retour Jérôme (2026-08-19, suite refonte vue prestataire) — après explication du statut
-- 'onboarding' (default de partner_capabilities.status à la création, sur tous les chemins :
-- invitation, create_establishment, admin direct), Jérôme : "enleve ce onboarding qui ne sert a
-- rien". Constat qui motive le retrait, pas une simple préférence : la seule logique métier jamais
-- documentée pour ce statut (docs/02-cahier-des-charges-socio.md §3a, Décision 2026-08-11 —
-- acceptation de contrat horodatée avant activation) n'a JAMAIS été câblée — seuls deux writers
-- existent pour cette colonne dans tout le dépôt (set_capability_status, l'offboarding qui ne pose
-- jamais que 'suspended'), et role_agreements s'insère bien à l'inscription mais ne déclenche
-- jamais de passage à 'active'. Aucun code ne distingue non plus 'onboarding' de 'pending_review'
-- (mêmes gardes partout, cf. has_capability qui n'exige que 'active'). Dans les faits :
-- 'onboarding' == 'pending_review' avec un nom different, jamais automatisé, statut par défaut
-- bloquant sans aucun mécanisme pour en sortir hors action admin manuelle — exactement ce qui a
-- coincé gmiro46@hifago (établissement actif réel, capacité operator restée 'onboarding').
--
-- Choix : collapse dans 'pending_review' (garde le geste d'activation manuelle admin déjà en place
-- et déjà accepté par Jérôme — l'auto-activation avait été explicitement déclinée dans un échange
-- précédent de cette session), pas un 5e état ni une suppression du contrôle admin. 3 statuts
-- restants : pending_review / active / suspended.

-- 1. Données existantes : toute ligne 'onboarding' devient 'pending_review' (comportement inchangé
--    pour ces lignes — toujours bloquées par has_capability(), toujours débloquées seulement par
--    set_capability_status). Fait AVANT de resserrer la contrainte (l'ordre inverse échouerait).
update public.partner_capabilities set status = 'pending_review' where status = 'onboarding';

-- 2. Contrainte + défaut de colonne.
alter table public.partner_capabilities drop constraint partner_capabilities_status_check;
alter table public.partner_capabilities
  add constraint partner_capabilities_status_check
  check (status in ('pending_review', 'active', 'suspended'));
alter table public.partner_capabilities alter column status set default 'pending_review';

-- 3. onboarding_completed_at : colonne posée avec la table (20260813161117) pour porter
--    l'horodatage d'acceptation de contrat jamais implémenté — jamais lue ni écrite nulle part
--    dans le dépôt (vérifié par grep avant cette migration), même feature morte que le statut lui-
--    même. Retirée avec lui plutôt que laissée en jachère.
alter table public.partner_capabilities drop column onboarding_completed_at;

-- 4. create_establishment (dernière définition : 20260815110000_gestion_images.sql) — seul champ
--    modifié, 'onboarding' → 'pending_review' à la création de la capacité operator quand elle
--    n'existe pas déjà. Signature strictement inchangée.
create or replace function public.create_establishment(
  p_partner_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_establishment_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_establishment réservé au rôle admin' using errcode = '42501';
  end if;

  insert into public.establishments (
    partner_id, name, description, address, lat, lon, operated_directly
  )
  values (
    p_partner_id, p_name, p_description, p_address, p_lat, p_lon, p_operated_directly
  )
  returning id into v_establishment_id;

  update public.partner_capabilities
     set establishment_id = v_establishment_id
   where partner_id = p_partner_id
     and role = 'operator'
     and establishment_id is null;

  if not found then
    insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
    values (p_partner_id, v_establishment_id, 'operator', 'admin', 'pending_review');
  end if;

  perform public.log_admin_action(
    'establishment.create', 'establishments', v_establishment_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'name', p_name), null
  );

  return v_establishment_id;
end;
$$;

-- 5. grant_capability (20260814150000_partner_registry_rpc.sql) — 2 inserts, même changement.
create or replace function public.grant_capability(
  p_partner_id uuid, p_role text, p_establishment_id uuid default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capability_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'grant_capability réservé au rôle admin' using errcode = '42501';
  end if;
  if p_role not in ('referrer', 'operator') then
    raise exception 'rôle invalide : %', p_role;
  end if;
  if exists (
    select 1 from public.partner_capabilities
     where partner_id = p_partner_id and role = p_role
       and establishment_id is not distinct from p_establishment_id
  ) then
    raise exception 'cette capacité existe déjà pour ce partenaire/établissement';
  end if;

  if p_role = 'operator' and not exists (
    select 1 from public.partner_capabilities where partner_id = p_partner_id and role = 'referrer'
  ) then
    insert into public.partner_capabilities (partner_id, role, source, status)
    values (p_partner_id, 'referrer', 'admin', 'pending_review');
  end if;

  insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
  values (p_partner_id, p_establishment_id, p_role, 'admin', 'pending_review')
  returning id into v_capability_id;

  perform public.log_admin_action(
    'partner_capability.grant', 'partner_capabilities', v_capability_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'role', p_role, 'establishment_id', p_establishment_id),
    p_note
  );
  return jsonb_build_object('ok', true, 'capability_id', v_capability_id);
end;
$$;

-- 6. set_capability_status (même fichier source) — retire 'onboarding' de la liste de statuts
--    cibles valides (un admin ne peut plus reposer une capacité sur ce statut disparu).
create or replace function public.set_capability_status(
  p_capability_id uuid, p_new_status text, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_status text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_capability_status réservé au rôle admin' using errcode = '42501';
  end if;
  if p_new_status not in ('pending_review', 'active', 'suspended') then
    raise exception 'statut invalide : %', p_new_status;
  end if;

  select status into v_before_status from public.partner_capabilities
   where id = p_capability_id for update;
  if not found then
    raise exception 'capacité introuvable';
  end if;

  update public.partner_capabilities set status = p_new_status, updated_at = now()
   where id = p_capability_id;

  perform public.log_admin_action(
    'partner_capability.set_status', 'partner_capabilities', p_capability_id,
    jsonb_build_object('status', v_before_status), jsonb_build_object('status', p_new_status), p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- 7. list_audience_members (20260814230000_campaign_engine.sql) — p_include_incomplete visait
--    'onboarding'/'pending_review' ensemble ; un seul état "pas encore actif" reste désormais.
create or replace function public.list_audience_members(
  p_audience text, p_include_incomplete boolean default false
)
returns table (account_id uuid, email text, phone text, reachable boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_audience_members réservé au rôle admin' using errcode = '42501';
  end if;
  if p_audience not in ('clients', 'referrers', 'providers', 'partners', 'all') then
    raise exception 'audience invalide : %', p_audience;
  end if;

  return query
  select pa.id, au.email::text, au.phone,
    (au.email is not null or au.phone is not null) as reachable
  from public.partner_accounts pa
  join auth.users au on au.id = pa.id
  where p_audience = 'all'
     or (p_audience = 'clients' and exists (
           select 1 from public.orders o where o.account_id = pa.id))
     or (p_audience = 'referrers'
           and exists (select 1 from public.partner_capabilities pc
                        where pc.partner_id = pa.partner_id and pc.role = 'referrer'
                          and (pc.status = 'active' or (p_include_incomplete and pc.status = 'pending_review')))
           and not exists (select 1 from public.partner_capabilities pc
                            where pc.partner_id = pa.partner_id and pc.role = 'operator' and pc.status = 'active'))
     or (p_audience = 'providers' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role = 'operator'
              and (pc.status = 'active' or (p_include_incomplete and pc.status = 'pending_review'))))
     or (p_audience = 'partners' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role in ('referrer', 'operator')
              and (pc.status = 'active' or (p_include_incomplete and pc.status = 'pending_review'))));
end;
$$;
