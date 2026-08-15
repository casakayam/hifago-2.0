-- Feature 25 (Admin : audiences serveur + moteur de campagne, envoi simulé) — dernière feature du
-- backlog de 25. Portée très réduite par rapport au titre du cahier des charges admin §3e/§3f :
-- fiche CRM, carte/géocodage, export Habeas Data, distinction établissement direct/partenaire — non
-- construits ici, aucun fournisseur tranché pour aucun d'eux (signalé, pas un oubli silencieux).
-- Envoi SIMULÉ : aucun fournisseur WhatsApp/email réel branché (360dialog, Resend/Postmark restent
-- non configurés) — même posture que le connecteur PMS (feature 22), adaptateur log-only.

-- list_audience_members : les 5 audiences calculées côté serveur, jamais par l'interface (admin
-- §3f). Un seul WHERE en chaîne de OR (jamais une UNION) — garantit une seule ligne par account_id
-- par construction, satisfait « une identité multi-codes ne reçoit jamais deux fois le même
-- message » sans déduplication additionnelle. Mutuelle exclusivité referrers/providers :
-- 'providers' ne filtre que sur operator actif ; 'referrers' exclut explicitement quiconque a
-- aussi operator actif — jamais les deux à la fois pour la même identité (invariant operator⇒
-- referrer, correctif Tranche 1 / feature 23).
create or replace function list_audience_members(
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

  -- au.email::text : gap constaté en écrivant cette migration, pas dans la version en prose du
  -- plan — auth.users.email est character varying(255), pas text ; RETURN QUERY exige une
  -- correspondance de type exacte avec la colonne déclarée (email text), un cast implicite ne
  -- suffit pas ici contrairement à une simple comparaison. au.phone est déjà text, aucun cast
  -- nécessaire pour cette colonne.
  return query
  select pa.id, au.email::text, au.phone,
    (au.email is not null or au.phone is not null) as reachable   -- « joignable ≠ membre »
  from public.partner_accounts pa
  join auth.users au on au.id = pa.id
  where p_audience = 'all'
     or (p_audience = 'clients' and exists (
           select 1 from public.orders o where o.account_id = pa.id))
     or (p_audience = 'referrers'
           and exists (select 1 from public.partner_capabilities pc
                        where pc.partner_id = pa.partner_id and pc.role = 'referrer'
                          and (pc.status = 'active' or (p_include_incomplete and pc.status in ('onboarding','pending_review'))))
           and not exists (select 1 from public.partner_capabilities pc
                            where pc.partner_id = pa.partner_id and pc.role = 'operator' and pc.status = 'active'))
     or (p_audience = 'providers' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role = 'operator'
              and (pc.status = 'active' or (p_include_incomplete and pc.status in ('onboarding','pending_review')))))
     or (p_audience = 'partners' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role in ('referrer', 'operator')
              and (pc.status = 'active' or (p_include_incomplete and pc.status in ('onboarding','pending_review')))));
end;
$$;

grant execute on function list_audience_members(text, boolean) to authenticated;

-- comm_campaigns / comm_campaign_targets — RPC-only (écriture nominative auditable).
create table comm_campaigns (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('clients', 'referrers', 'providers', 'partners', 'all')),
  channel text not null check (channel in ('whatsapp', 'email')),
  include_incomplete boolean not null default false,
  message_template text not null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'completed')),
  created_by uuid not null references partner_accounts(id),
  created_at timestamptz not null default now()
);
create table comm_campaign_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references comm_campaigns(id),
  account_id uuid not null references partner_accounts(id),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped_unreachable', 'skipped_ineligible', 'skipped_no_consent')),
  sent_at timestamptz,
  unique (campaign_id, account_id)
);
alter table comm_campaigns enable row level security;
alter table comm_campaign_targets enable row level security;
revoke insert, update, delete on comm_campaigns from authenticated, anon;
revoke insert, update, delete on comm_campaign_targets from authenticated, anon;
create policy comm_campaigns_select_admin on comm_campaigns for select using ((select is_admin(auth.uid())));
create policy comm_campaign_targets_select_admin on comm_campaign_targets for select using ((select is_admin(auth.uid())));

-- create_campaign : snapshote les cibles au moment de la création (statut initial dépendant de
-- reachable seul — l'éligibilité elle-même sera revalidée à l'envoi, cf. process_campaign_batch).
create or replace function create_campaign(
  p_audience text, p_channel text, p_message_template text, p_include_incomplete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_member record;
  v_count int := 0;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_campaign réservé au rôle admin' using errcode = '42501';
  end if;
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'canal invalide : %', p_channel;
  end if;

  insert into public.comm_campaigns (audience, channel, include_incomplete, message_template, created_by)
  values (p_audience, p_channel, p_include_incomplete, p_message_template, auth.uid())
  returning id into v_campaign_id;

  for v_member in select * from public.list_audience_members(p_audience, p_include_incomplete) loop
    insert into public.comm_campaign_targets (campaign_id, account_id, status)
    values (v_campaign_id, v_member.account_id,
            case when v_member.reachable then 'pending' else 'skipped_unreachable' end);
    v_count := v_count + 1;
  end loop;

  perform public.log_admin_action(
    'campaign.create', 'comm_campaigns', v_campaign_id, null,
    jsonb_build_object('audience', p_audience, 'channel', p_channel, 'targets', v_count), null
  );
  return jsonb_build_object('ok', true, 'campaign_id', v_campaign_id, 'targets', v_count);
end;
$$;

grant execute on function create_campaign(text, text, text, boolean) to authenticated;

-- process_campaign_batch : status='pending' EST le curseur de position, pas de curseur séparé à
-- maintenir — rappeler cette RPC plus tard reprend exactement là où elle s'était arrêtée,
-- gratuitement. Pour chaque cible : (1) revalide l'éligibilité au moment de l'envoi, jamais
-- seulement à la préparation ; (2) filtre Habeas Data — s'applique à TOUT compte ayant au moins une
-- commande (donc un « client » au sens strict), quelle que soit l'audience choisie pour la
-- campagne ; referrers/providers purs (aucune commande) n'y sont jamais soumis ; (3) sinon, envoi
-- simulé (adaptateur log-only, aucun appel réseau réel).
create or replace function process_campaign_batch(p_campaign_id uuid, p_batch_size int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience text;
  v_include_incomplete boolean;
  v_target record;
  v_still_eligible boolean;
  v_has_consent boolean;
  v_sent_count int := 0;
  v_skipped_count int := 0;
  v_remaining int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'process_campaign_batch réservé au rôle admin' using errcode = '42501';
  end if;

  select audience, include_incomplete into v_audience, v_include_incomplete
    from public.comm_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'campagne introuvable';
  end if;

  for v_target in
    select id, account_id from public.comm_campaign_targets
     where campaign_id = p_campaign_id and status = 'pending'
     order by id limit p_batch_size for update
  loop
    -- Revalide l'audience au moment de l'envoi, jamais seulement à la préparation (admin §5,
    -- cas limite explicite) — ré-exécute list_audience_members pour ce compte précis.
    select exists (
      select 1 from public.list_audience_members(v_audience, v_include_incomplete) m
       where m.account_id = v_target.account_id
    ) into v_still_eligible;

    if not v_still_eligible then
      update public.comm_campaign_targets set status = 'skipped_ineligible' where id = v_target.id;
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    -- Consentement Habeas Data : s'applique à TOUT compte ayant au moins une commande (donc un
    -- « client » au sens strict), quelle que soit l'audience choisie pour la campagne — pas
    -- seulement quand l'audience s'appelle littéralement 'clients'. Referrers/providers purs
    -- (aucune commande) n'y sont jamais soumis (« relation contractuelle déjà établie »,
    -- admin §3f). Boucle le fil laissé ouvert par l'audit mi-parcours qui avait ajouté
    -- orders.marketing_consent (feature 6) sans encore de consommateur.
    if exists (select 1 from public.orders o where o.account_id = v_target.account_id) then
      select o.marketing_consent into v_has_consent from public.orders o
       where o.account_id = v_target.account_id order by o.created_at desc limit 1;
      if coalesce(v_has_consent, false) = false then
        update public.comm_campaign_targets set status = 'skipped_no_consent' where id = v_target.id;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;
    end if;

    -- Envoi simulé (adaptateur log-only, même posture que le fournisseur email déjà noté
    -- « stubbable » dans les points ouverts) — aucun appel réseau réel.
    update public.comm_campaign_targets set status = 'sent', sent_at = now() where id = v_target.id;
    v_sent_count := v_sent_count + 1;
  end loop;

  select count(*) into v_remaining from public.comm_campaign_targets
   where campaign_id = p_campaign_id and status = 'pending';
  update public.comm_campaigns set status = case when v_remaining = 0 then 'completed' else 'sending' end
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'sent', v_sent_count, 'skipped', v_skipped_count, 'remaining', v_remaining);
end;
$$;

grant execute on function process_campaign_batch(uuid, int) to authenticated;
