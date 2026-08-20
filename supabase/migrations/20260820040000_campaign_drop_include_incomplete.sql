-- Retour Jérôme (2026-08-20) — conséquence directe de
-- 20260820010000_partner_capabilities_active_by_default.sql : partner_capabilities.status ne peut
-- plus jamais valoir autre chose que 'active'/'suspended', donc p_include_incomplete (« inclure les
-- identités pas encore pleinement actives ») ne peut plus jamais changer un résultat — il n'existe
-- plus d'état intermédiaire à inclure. Le garder aurait laissé une case à cocher dans
-- NewCampaignForm.tsx qui ne fait plus rien, sans le signaler nulle part : retrait complet plutôt
-- que laissé en jachère, cohérent avec le reste de ce lot.

-- Changement d'arité sur les 3 fonctions (paramètre en moins) : drop explicite avant de recréer,
-- Postgres n'écrase pas silencieusement une signature différente (même précaution que
-- 20260815110000_gestion_images.sql pour create_establishment).
drop function if exists list_audience_members(text, boolean);
drop function if exists create_campaign(text, text, text, boolean);

-- 1. list_audience_members — corps copié depuis 20260820010000 moins p_include_incomplete/les
--    clauses qu'il pilotait (déjà réduites à une comparaison simple par cette même migration).
create or replace function public.list_audience_members(p_audience text)
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

grant execute on function public.list_audience_members(text) to authenticated;

-- 2. comm_campaigns.include_incomplete — plus jamais lue une fois les 3 fonctions de ce fichier
--    recréées.
alter table public.comm_campaigns drop column include_incomplete;

-- 3. create_campaign — corps copié depuis 20260814230000_campaign_engine.sql moins
--    p_include_incomplete/include_incomplete.
create or replace function public.create_campaign(
  p_audience text, p_channel text, p_message_template text
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

  insert into public.comm_campaigns (audience, channel, message_template, created_by)
  values (p_audience, p_channel, p_message_template, auth.uid())
  returning id into v_campaign_id;

  for v_member in select * from public.list_audience_members(p_audience) loop
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

grant execute on function public.create_campaign(text, text, text) to authenticated;

-- 4. process_campaign_batch — signature propre inchangée (p_campaign_id, p_batch_size), juste
--    v_include_incomplete/son usage retirés du corps.
create or replace function public.process_campaign_batch(p_campaign_id uuid, p_batch_size int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience text;
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

  select audience into v_audience
    from public.comm_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'campagne introuvable';
  end if;

  for v_target in
    select id, account_id from public.comm_campaign_targets
     where campaign_id = p_campaign_id and status = 'pending'
     order by id limit p_batch_size for update
  loop
    select exists (
      select 1 from public.list_audience_members(v_audience) m
       where m.account_id = v_target.account_id
    ) into v_still_eligible;

    if not v_still_eligible then
      update public.comm_campaign_targets set status = 'skipped_ineligible' where id = v_target.id;
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    if exists (select 1 from public.orders o where o.account_id = v_target.account_id) then
      select o.marketing_consent into v_has_consent from public.orders o
       where o.account_id = v_target.account_id order by o.created_at desc limit 1;
      if coalesce(v_has_consent, false) = false then
        update public.comm_campaign_targets set status = 'skipped_no_consent' where id = v_target.id;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;
    end if;

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

grant execute on function public.process_campaign_batch(uuid, int) to authenticated;
