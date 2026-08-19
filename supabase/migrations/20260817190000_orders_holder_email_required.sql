-- Décision Jérôme (2026-08-17) : l'email d'un client passe d'optionnel à requis, au même titre que
-- le nom et le WhatsApp — cf. docs/01-cahier-des-charges-client.md §2 point 6 / §3e (révisées dans
-- le même commit). N'ajoute rien au périmètre de la spec 17 (calendrier) elle-même, mais touche le
-- même fichier RPC (create_order) travaillé aujourd'hui.
--
-- 88 commandes existantes sur cette instance locale ont toutes holder_email = null (vérifié avant
-- d'écrire cette migration — la règle n'a jamais été appliquée avant aujourd'hui). Backfill par un
-- placeholder explicitement reconnaissable plutôt qu'une valeur plausible : ce sont des données de
-- dev/test, jamais de vraies coordonnées client, la valeur ne doit jamais pouvoir être confondue
-- avec un email réel.
update orders set holder_email = 'sin-email-migrado@hifago.local' where holder_email is null;
alter table orders alter column holder_email set not null;

-- create_order (dernière version : 20260817180000_order_lines_holder_name.sql) — Phase 1, garde
-- ajoutée juste après empty_cart (avant tout verrou, même discipline que les autres plafonds de
-- cette phase) : email requis et grossièrement valide (présence d'un @ et d'un point après —
-- validation de forme, pas RFC 5322 complète, même calibrage que la normalisation téléphone déjà
-- faite côté front uniquement). Reste du corps identique mot pour mot.
create or replace function create_order(
  p_lines jsonb,
  p_holder_name text,
  p_holder_email text default null,
  p_holder_phone text default null,
  p_marketing_consent boolean default false,
  p_attribution_code text default null,
  p_attribution_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_order_id uuid;
  v_line jsonb;
  v_product_type text;
  v_min_qty int;
  v_max_qty int;
  v_price_tiers jsonb;
  v_lodging_lines int := 0;
  v_lodging_units int := 0;
  v_prestation_lines int := 0;
  v_avail record;
  v_attribution_code text;
  v_attribution_source text;
  v_referrer_partner_id uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;

  if p_holder_email is null or btrim(p_holder_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_required');
  end if;
  if p_holder_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email_invalid');
  end if;

  -- Phase 1 : plafonds (AUCUN verrou pris).
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers
      into v_product_type, v_min_qty, v_max_qty, v_price_tiers
      from public.products where id = (v_line->>'product_id')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
    end if;
    if v_product_type = 'lodging' then
      v_lodging_lines := v_lodging_lines + 1;
      v_lodging_units := v_lodging_units + (v_line->>'qty')::int;
    else
      v_prestation_lines := v_prestation_lines + 1;
      if (v_line->>'qty')::int < v_min_qty then
        return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
      end if;
      if (v_line->>'qty')::int > v_max_qty then
        return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
      end if;
      if v_price_tiers is not null and not exists (
        select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
         where (v_line->>'qty')::int between t.min_qty and t.max_qty
      ) then
        return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
      end if;
    end if;
  end loop;
  if v_lodging_lines > 4 or v_lodging_units > 12 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 20 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  -- Phase 2 : verrouillage, ordre stable (product_id, date), toutes ressources en une requête.
  for v_avail in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date
         from jsonb_array_elements(p_lines) elem
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  -- Phase 2b (feature 20) : verrouillage de la ressource partagée, camps uniquement.
  for v_avail in
    select prc.establishment_id, prc.slot_date
      from public.provider_resource_calendar prc
     where (prc.establishment_id, prc.slot_date) in (
       select p.establishment_id, (elem->>'date')::date + gs
         from jsonb_array_elements(p_lines) elem
         join public.products p on p.id = (elem->>'product_id')::uuid
         cross join generate_series(0, p.duration_days - 1) as gs
        where p.type = 'camp'
     )
     order by prc.establishment_id, prc.slot_date
     for update
  loop
    null;
  end loop;

  -- Phase 3 : validation par ligne, aucune écriture.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    declare
      v_sellable boolean;
      v_calendar_open boolean;
      v_capacity int;
      v_booked int;
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_gs int;
      v_resource_capacity int;
      v_resource_booked int;
      v_line_price_cop bigint;
      v_line_price_tiers jsonb;
    begin
      select p.sellable, coalesce(pc.open, p.calendar_default_open),
             p.type, p.establishment_id, p.duration_days, p.price_cop, p.price_tiers
        into v_sellable, v_calendar_open, v_line_type, v_line_establishment_id, v_line_duration_days,
             v_line_price_cop, v_line_price_tiers
        from public.products p
        left join public.product_calendar pc
          on pc.product_id = p.id and pc.date = (v_line->>'date')::date
       where p.id = (v_line->>'product_id')::uuid;

      if not v_sellable then
        return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
      end if;
      if not v_calendar_open then
        return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
      end if;

      if v_line_price_tiers is null and v_line_price_cop is null then
        return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
      end if;

      select capacity, booked into v_capacity, v_booked
        from public.product_availability
       where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
      end if;

      if v_booked + (
        select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(p_lines) l
         where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
           and (l->>'date')::date = (v_line->>'date')::date
      ) > v_capacity then
        return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
      end if;

      if v_line_type = 'camp' then
        for v_gs in 0..(v_line_duration_days - 1) loop
          select capacity, booked into v_resource_capacity, v_resource_booked
            from public.provider_resource_calendar
           where establishment_id = v_line_establishment_id
             and slot_date = (v_line->>'date')::date + v_gs;
          if not found or v_resource_booked + (v_line->>'qty')::int > v_resource_capacity then
            return jsonb_build_object('ok', false, 'reason', 'resource_unavailable', 'line', v_line);
          end if;
        end loop;
      end if;
    end;
  end loop;

  -- Résolution d'attribution (inchangé) : code présenté cette session > code sauvegardé du compte
  -- enregistré > direct.
  if p_attribution_code is not null then
    v_attribution_code := p_attribution_code;
    v_attribution_source := p_attribution_source;
  elsif v_account_id is not null then
    select saved_attribution_code into v_attribution_code
      from public.partner_accounts where id = v_account_id;
    v_attribution_source := 'account';
  end if;

  if v_attribution_code is not null then
    select partner_id into v_referrer_partner_id
      from public.partner_codes
     where code = v_attribution_code and active = true;
  end if;

  if v_referrer_partner_id is null then
    v_attribution_code := null;
    v_attribution_source := null;
  end if;

  if v_account_id is not null and p_attribution_code is not null and v_referrer_partner_id is not null then
    update public.partner_accounts set saved_attribution_code = p_attribution_code
     where id = v_account_id;
  end if;

  -- Phase 4 : écriture, tout le panier a été validé.
  insert into public.orders (
    account_id, holder_name, holder_email, holder_phone, marketing_consent,
    referrer_partner_id, attribution_code, attribution_source
  )
  values (
    v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent,
    v_referrer_partner_id, v_attribution_code, v_attribution_source
  )
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    declare
      v_line_partner_id uuid;
      v_line_price_cop bigint;
      v_line_price_tiers jsonb;
      v_total_cop bigint;
      v_commission_case text;
      v_referrer_pct numeric(5, 4);
      v_app_pct numeric(5, 4);
      v_acompte_pct numeric(5, 4);
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_order_line_id uuid;
    begin
      select partner_id, price_cop, price_tiers, type, establishment_id, duration_days
        into v_line_partner_id, v_line_price_cop, v_line_price_tiers, v_line_type,
             v_line_establishment_id, v_line_duration_days
        from public.products where id = (v_line->>'product_id')::uuid;

      if v_line_price_tiers is not null then
        select t.price_cop into v_line_price_cop
          from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
         where (v_line->>'qty')::int between t.min_qty and t.max_qty
         limit 1;
      end if;

      v_total_cop := v_line_price_cop * (v_line->>'qty')::int;

      if v_referrer_partner_id is null then
        v_commission_case := 'direct';        v_referrer_pct := 0;    v_app_pct := 0.17;
      elsif v_referrer_partner_id = v_line_partner_id then
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.07;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.10; v_app_pct := 0.07;
      end if;
      v_acompte_pct := v_referrer_pct + v_app_pct;

      update public.product_availability set booked = booked + (v_line->>'qty')::int
       where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
      insert into public.order_lines (
        order_id, account_id, product_id, date, qty, referrer_partner_id, holder_name,
        price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
        acompte_cop, referrer_commission_cop, app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date, (v_line->>'qty')::int,
        v_referrer_partner_id, p_holder_name,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      if v_line_type = 'camp' then
        update public.provider_resource_calendar
           set booked = booked + (v_line->>'qty')::int
         where establishment_id = v_line_establishment_id
           and slot_date between (v_line->>'date')::date
                              and (v_line->>'date')::date + v_line_duration_days - 1;

        insert into public.availability_blocks (
          establishment_id, start_date, end_date, source_order_line_id
        )
        values (
          v_line_establishment_id,
          (v_line->>'date')::date,
          (v_line->>'date')::date + v_line_duration_days - 1,
          v_order_line_id
        );
      end if;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$$;

grant execute on function create_order(jsonb, text, text, text, boolean, text, text) to authenticated, anon;
