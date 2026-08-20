-- Retour Jérôme (2026-08-20, suite du retrait de 'onboarding' la veille) — modèle cible posé point
-- par point : une capacité issue d'une invitation (rôle déjà choisi par Jérôme dans le lien), d'une
-- proposition d'établissement approuvée, ou d'un octroi direct admin, est **toujours** un geste déjà
-- initié ou validé par un admin — aucun chemin self-service n'existe. "c'est activé de base, si
-- jerome décide de bloquer le compte il peut" : le blocage (`suspended`) est l'exception qu'on pose
-- explicitement, jamais un palier par défaut. `pending_review` n'a donc plus de raison d'être :
-- même sort que `onboarding` la veille, pour la même cause racine (aucun automatisme, aucune
-- distinction jamais faite en pratique avec les 2 autres statuts).

-- 1. Données existantes : toute ligne 'pending_review' devient 'active' — réactivation en masse
--    assumée et explicite (~50 lignes vues la veille, gmiro46 déjà activé manuellement entre-temps
--    par Jérôme), cohérente avec "activé de base". Avant de resserrer la contrainte.
update public.partner_capabilities set status = 'active' where status = 'pending_review';

-- 2. Contrainte + défaut.
alter table public.partner_capabilities drop constraint partner_capabilities_status_check;
alter table public.partner_capabilities
  add constraint partner_capabilities_status_check
  check (status in ('active', 'suspended'));
alter table public.partner_capabilities alter column status set default 'active';

-- 3. create_establishment (dernière définition :
--    20260819230000_partner_capabilities_remove_onboarding_status.sql) — seul le statut de secours
--    change, 'pending_review' → 'active'.
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
    values (p_partner_id, v_establishment_id, 'operator', 'admin', 'active');
  end if;

  perform public.log_admin_action(
    'establishment.create', 'establishments', v_establishment_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'name', p_name), null
  );

  return v_establishment_id;
end;
$$;

-- 4. grant_capability — mêmes 2 inserts, 'active' au lieu de 'pending_review'.
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
    values (p_partner_id, 'referrer', 'admin', 'active');
  end if;

  insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
  values (p_partner_id, p_establishment_id, p_role, 'admin', 'active')
  returning id into v_capability_id;

  perform public.log_admin_action(
    'partner_capability.grant', 'partner_capabilities', v_capability_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'role', p_role, 'establishment_id', p_establishment_id),
    p_note
  );
  return jsonb_build_object('ok', true, 'capability_id', v_capability_id);
end;
$$;

-- 5. set_capability_status — liste de validation resserrée à 2 valeurs.
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
  if p_new_status not in ('active', 'suspended') then
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

-- 6. list_audience_members — 'pending_review' ne pouvant plus jamais exister, les 3 clauses
--    p_include_incomplete se simplifient à une comparaison directe. Signature/paramètre inchangés
--    ici (rendus sans effet, retrait complet fait par la migration suivante de ce lot).
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
                          and pc.status = 'active')
           and not exists (select 1 from public.partner_capabilities pc
                            where pc.partner_id = pa.partner_id and pc.role = 'operator' and pc.status = 'active'))
     or (p_audience = 'providers' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role = 'operator'
              and pc.status = 'active'))
     or (p_audience = 'partners' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role in ('referrer', 'operator')
              and pc.status = 'active'));
end;
$$;
