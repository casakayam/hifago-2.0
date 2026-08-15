-- Spec dédiée "gestion d'un établissement" (docs/specs/06-gestion-etablissement.md) — comble le
-- gap admin (présentation d'établissement éditable après création, décision cahier admin §3c déjà
-- validée mais jamais construite) et l'absence totale côté socio (aucune création/édition,
-- vérifié exhaustivement). Deux décisions Jérôme : création ET édition côté partenaire passent
-- toujours par proposition modérée, jamais d'écriture directe — symétrique au mécanisme déjà en
-- place pour les photos (20260815110000_gestion_images.sql, product_proposals.kind).
--
-- Frontière RLS/RPC-only (CLAUDE.md §3) :
-- - establishments reste RLS-directe admin, inchangée par cette migration.
-- - establishment_proposals : RPC-only — écriture cross-identité auditable (l'admin doit voir les
--   propositions de tous les partenaires), verrou optimiste sur l'approbation, même classification
--   que product_proposals (20260813234500).
--
-- Point d'implémentation critique (spec §3) : moderate_establishment_proposal, branche kind='edit',
-- doit relire operated_directly depuis la ligne establishments existante et le repasser tel quel à
-- update_establishment (remplacement complet, pas un patch) — sinon une approbation d'édition
-- écraserait silencieusement ce champ à sa valeur par défaut (false). operated_directly n'est
-- jamais dans le payload socio (classification métier/plateforme, pas un champ de présentation,
-- cahier admin §3e) — filtré explicitement, jamais lu depuis p_payload.

-- ============================================================================================
-- 1. establishment_proposals
-- ============================================================================================

create table establishment_proposals (
  id uuid primary key default gen_random_uuid(),
  -- null tant que kind='create' n'est pas encore approuvée (l'établissement n'existe pas encore) ;
  -- back-fillé par moderate_establishment_proposal au moment de l'approbation, jamais nul après.
  establishment_id uuid references establishments(id),
  partner_id uuid not null references partners(id),
  submitted_by uuid not null references partner_accounts(id),
  kind text not null check (kind in ('create', 'edit')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  -- {name, description?, address?, lat?, lon?} — jamais operated_directly (cf. commentaire de tête).
  payload jsonb not null,
  rejection_reason text,
  version int not null default 1,  -- verrou optimiste, même patron que product_proposals
  reviewed_by uuid references partner_accounts(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint establishment_proposals_scope check (
    (kind = 'edit' and establishment_id is not null)
    or (kind = 'create' and establishment_id is null and status <> 'approved')
    or (kind = 'create' and establishment_id is not null and status = 'approved')
  )
);

-- Pas de GRANT explicite : couverte par ALTER DEFAULT PRIVILEGES (20260813163456_identity_rls.sql).
alter table establishment_proposals enable row level security;
revoke insert, update, delete on establishment_proposals from authenticated, anon;

create policy establishment_proposals_select_own on establishment_proposals
  for select using (partner_id = (select partner_id_for_account(auth.uid())));
create policy establishment_proposals_select_admin on establishment_proposals
  for select using ((select is_admin(auth.uid())));

create index establishment_proposals_partner_status_idx
  on establishment_proposals(partner_id, status);
create index establishment_proposals_establishment_status_idx
  on establishment_proposals(establishment_id, status) where establishment_id is not null;

-- ============================================================================================
-- 2. RPC update_establishment — admin, écriture directe auditée
-- ============================================================================================

-- security invoker, pas definer : establishments est RLS-directe admin (establishments_write_admin),
-- un admin y a déjà un accès direct — même raisonnement que transfer_establishment
-- (20260814150000_partner_registry_rpc.sql). `if not found` évalué APRÈS l'update : sous RLS, une
-- écriture refusée affecte silencieusement 0 ligne, jamais une exception automatique.
--
-- Toutes les références sont qualifiées `public.` (contrairement à transfer_establishment, qui ne
-- l'est pas) : cette RPC est aussi appelée EN NESTED depuis moderate_establishment_proposal
-- (`set search_path = ''`) — un nom non qualifié y résoudrait sur un search_path vide et
-- échouerait ("relation does not exist"), constaté en testant directement la RPC avant de
-- construire l'écran. Sans effet sur l'appel direct (déjà qualifié = déjà correct dans les deux cas).
create or replace function update_establishment(
  p_establishment_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_before public.establishments%rowtype;
begin
  select * into v_before from public.establishments where id = p_establishment_id;

  update public.establishments
     set name = p_name,
         description = p_description,
         address = p_address,
         lat = p_lat,
         lon = p_lon,
         operated_directly = p_operated_directly,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    raise exception 'établissement introuvable ou non autorisé';
  end if;

  perform public.log_admin_action(
    'establishment.update', 'establishments', p_establishment_id,
    jsonb_build_object(
      'name', v_before.name, 'description', v_before.description, 'address', v_before.address,
      'lat', v_before.lat, 'lon', v_before.lon, 'operated_directly', v_before.operated_directly
    ),
    jsonb_build_object(
      'name', p_name, 'description', p_description, 'address', p_address,
      'lat', p_lat, 'lon', p_lon, 'operated_directly', p_operated_directly
    ),
    p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function update_establishment(
  uuid, jsonb, jsonb, text, double precision, double precision, boolean, text
) to authenticated;

-- ============================================================================================
-- 3. RPC submit_establishment_creation_proposal — socio, proposition de création
-- ============================================================================================

-- Aucune vérification de capacité préexistante (miroir de la permissivité déjà présente dans
-- create_establishment côté admin — un partenaire sans aucune capacité operator peut recevoir un
-- premier établissement). Couvre indifféremment le tout premier établissement d'un partenaire et
-- un établissement supplémentaire : create_establishment (appelée à l'approbation) gère déjà les
-- deux cas identiquement (rattache la capacité operator en attente si elle existe, sinon en crée
-- une nouvelle), cf. spec §1.
create or replace function submit_establishment_creation_proposal(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));
  if v_partner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_partner');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  -- Plafond dédié (1, pas le plafond générique 10) : une création est une action rare/lourde,
  -- empêche un double-clic de générer deux fiches fantômes pour le même lieu.
  if exists (
    select 1 from public.establishment_proposals
     where partner_id = v_partner_id and kind = 'create' and status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pending_creation_exists');
  end if;

  -- Whitelist explicite : jamais operated_directly (classification métier/plateforme, cf.
  -- commentaire de tête de cette migration), jamais un champ hors présentation.
  v_safe_payload := jsonb_build_object(
    'name', p_payload -> 'name', 'description', p_payload -> 'description',
    'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
  );

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

grant execute on function submit_establishment_creation_proposal(jsonb) to authenticated;

-- ============================================================================================
-- 4. RPC submit_establishment_edit_proposal — socio, proposition d'édition
-- ============================================================================================

-- Même 3 garde-fous que submit_product_proposal (identité/propriété/capacité) — sauf que la
-- "propriété" ici est directe (establishments.partner_id), pas via un produit intermédiaire.
-- Garde-fou capacité : operator ACTIF pour cet établissement précis — un partenaire dont la
-- capacité vient d'être créée par l'approbation d'une proposition de création (statut onboarding
-- par défaut) ne peut pas encore proposer d'édition tant que l'admin n'a pas activé sa capacité
-- (set_capability_status). Comportement hérité assumé (même invariant que submit_product_proposal/
-- submit_photos_proposal), pas une restriction nouvelle inventée ici — cf. spec §3/§9.
create or replace function submit_establishment_edit_proposal(p_establishment_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  -- Garde-fous 1+2 (identité + propriété) : établissement inexistant ou d'un autre partenaire →
  -- même réponse "introuvable" dans les deux cas, jamais de fuite d'existence d'un tiers.
  if not exists (
    select 1 from public.establishments
     where id = p_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis.
  if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  -- Plafond générique 10 (même valeur littérale que submit_product_proposal), compté séparément
  -- sur establishment_proposals (jamais mélangé avec product_proposals).
  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  v_safe_payload := jsonb_build_object(
    'name', p_payload -> 'name', 'description', p_payload -> 'description',
    'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
  );

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (p_establishment_id, v_partner_id, v_account_id, 'edit', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

grant execute on function submit_establishment_edit_proposal(uuid, jsonb) to authenticated;

-- ============================================================================================
-- 5. RPC withdraw_establishment_proposal — socio
-- ============================================================================================

-- Copie fidèle de withdraw_product_proposal (20260813234500) : ownership + status='pending' →
-- withdrawn, générique sur kind (create ou edit).
create or replace function withdraw_establishment_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_partner_id uuid;
  v_status text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select partner_id, status into v_proposal_partner_id, v_status
    from public.establishment_proposals where id = p_proposal_id for update;

  if not found or v_proposal_partner_id is distinct from v_partner_id then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  update public.establishment_proposals set status = 'withdrawn', updated_at = now()
   where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function withdraw_establishment_proposal(uuid) to authenticated;

-- ============================================================================================
-- 6. RPC moderate_establishment_proposal — admin
-- ============================================================================================

-- select...for update + verrou optimiste version (patron identique à moderate_product_proposal,
-- 20260813240500). Un seul point d'écriture Postgres pour "insérer/mettre à jour un établissement"
-- : cette RPC réutilise create_establishment/update_establishment plutôt que de dupliquer leur
-- logique. SECURITY DEFINER n'affecte pas auth.uid() : le garde-fou is_admin() interne de
-- create_establishment reste correct même appelé depuis ici. update_establishment (security
-- invoker) appelée en nested depuis une fonction security definer s'exécute avec les privilèges du
-- propriétaire de CETTE fonction (contourne RLS comme le ferait le propriétaire de table) — sans
-- risque : is_admin() est déjà vérifié explicitement au tout début de cette fonction, avant tout
-- accès aux données.
--
-- Pas de log_admin_action séparé pour la branche approve : create_establishment/update_establishment
-- logguent déjà 'establishment.create'/'establishment.update' — dupliquer l'entrée d'audit serait
-- redondant. La branche reject, elle, n'a aucune RPC à réutiliser (aucune mutation d'établissement) :
-- elle logue explicitement, comme moderate_product_proposal.
create or replace function moderate_establishment_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_expected_version int,
  p_corrected_payload jsonb default null,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
  v_current_operated_directly boolean;
  v_new_establishment_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_establishment_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, establishment_id, partner_id, kind, payload, status, version, reviewed_by
    into v_proposal
    from public.establishment_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  if p_decision = 'approve' then
    -- Le payload CORRIGÉ par l'admin prime, jamais silencieusement remplacé par ce que le
    -- partenaire avait initialement soumis (même invariant que moderate_product_proposal).
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'address', coalesce(p_corrected_payload -> 'address', v_proposal.payload -> 'address'),
      'lat', coalesce(p_corrected_payload -> 'lat', v_proposal.payload -> 'lat'),
      'lon', coalesce(p_corrected_payload -> 'lon', v_proposal.payload -> 'lon')
    );

    if v_proposal.kind = 'create' then
      -- operated_directly forcé à false : jamais proposable par le socio (cf. commentaire de tête).
      select public.create_establishment(
        v_proposal.partner_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        false
      ) into v_new_establishment_id;

      update public.establishment_proposals
         set status = 'approved', establishment_id = v_new_establishment_id, payload = v_final_payload,
             reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    else
      -- operated_directly relu depuis la ligne existante et repassé tel quel : update_establishment
      -- remplace tous les champs, jamais un patch partiel — sinon cette approbation écraserait
      -- silencieusement operated_directly à sa valeur par défaut (false), cf. commentaire de tête.
      select operated_directly into v_current_operated_directly
        from public.establishments where id = v_proposal.establishment_id;

      perform public.update_establishment(
        v_proposal.establishment_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        v_current_operated_directly,
        'Aprobado desde propuesta ' || p_proposal_id
      );

      update public.establishment_proposals
         set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
             reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    end if;
  else
    update public.establishment_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.reject', 'establishment_proposals',
      p_proposal_id, null, null, p_rejection_reason);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function moderate_establishment_proposal(uuid, text, int, jsonb, text) to authenticated;
