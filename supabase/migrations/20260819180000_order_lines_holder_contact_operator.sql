-- Décision Jérôme (2026-08-19, refonte vue prestataire) — lève la restriction "PII minimale"
-- documentée en 20260817180000 (order_lines.holder_name seul, jamais téléphone/email exposés au
-- prestataire). Le prestataire a désormais besoin de contacter son client et de filtrer sa liste de
-- réservations par email. order_lines_select_operator (20260817170000) donne déjà un accès ligne
-- complète au prestataire sur son propre scope établissement — aucun GRANT/REVOKE colonne
-- restrictif n'existe sur order_lines (vérifié par grep, contrairement à
-- establishments.lobby_api_token) — ajouter les colonnes suffit, AUCUNE nouvelle policy RLS.
--
-- Duplication depuis orders (même patron que holder_name) — les DEUX colonnes restent NULLABLES,
-- à la différence de holder_name (2026-08-19, correctif après coup) : orders.holder_email est bien
-- NOT NULL (source de vérité, contrainte 20260817190000), mais order_lines n'en est qu'un miroir de
-- confort pour l'operator, écrit UNIQUEMENT par create_order/modify_order_line/
-- create_manual_order_line — de nombreux autres inserts directs dans order_lines existent ailleurs
-- (seed.sql, et les fixtures de availability_orders_rls/cancel_order/ledger_entries/
-- modify_order_line/payments/pms_reconciliation/set_order_line_status.test.sql) qui ne connaissent
-- pas cette colonne : une contrainte NOT NULL les aurait tous cassés silencieusement.
alter table order_lines add column holder_phone text;
alter table order_lines add column holder_email text;

update order_lines ol set holder_phone = o.holder_phone, holder_email = o.holder_email
  from orders o where o.id = ol.order_id;

-- set_order_line_status (dernière version : 20260818180000) N'A PAS besoin d'être touchée : elle ne
-- fait qu'un UPDATE du statut en place sur la ligne existante (jamais d'insert de remplacement) —
-- holder_phone/holder_email y restent donc intacts sans aucune modification.

-- create_order (dernière version : 20260819130000_create_order_pms_backed.sql) — signature
-- inchangée, un seul bloc insert order_lines étendu.
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
  v_line_idx int;
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
  v_products_type text[];
  v_products_sellable boolean[];
  v_products_price_cop bigint[];
  v_products_price_tiers jsonb[];
  v_products_establishment_id uuid[];
  v_products_duration_days int[];
  v_products_partner_id uuid[];
  v_products_calendar_default_open boolean[];
  v_products_stay_rates jsonb[];
  v_products_lobby_category_id int[];
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

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(p_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_line_room_type_id uuid := (v_line->>'room_type_id')::uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_room_product_id uuid;
      v_room_min_qty int;
      v_room_max_qty int;
      v_room_price_tiers jsonb;
      v_p_sellable boolean;
      v_p_price_cop bigint;
      v_p_establishment_id uuid;
      v_p_duration_days int;
      v_p_partner_id uuid;
      v_p_calendar_default_open boolean;
      v_p_stay_rates jsonb;
      v_p_lobby_category_id int;
    begin
      select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates, lobby_category_id
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates, v_p_lobby_category_id
        from public.products where id = (v_line->>'product_id')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
      end if;

      v_products_type[v_line_idx] := v_product_type;
      v_products_sellable[v_line_idx] := v_p_sellable;
      v_products_price_cop[v_line_idx] := v_p_price_cop;
      v_products_price_tiers[v_line_idx] := v_price_tiers;
      v_products_establishment_id[v_line_idx] := v_p_establishment_id;
      v_products_duration_days[v_line_idx] := v_p_duration_days;
      v_products_partner_id[v_line_idx] := v_p_partner_id;
      v_products_calendar_default_open[v_line_idx] := v_p_calendar_default_open;
      v_products_stay_rates[v_line_idx] := v_p_stay_rates;
      v_products_lobby_category_id[v_line_idx] := v_p_lobby_category_id;

      v_price_tiers := public.normalize_price_tiers(v_price_tiers);

      if v_line_room_type_id is not null then
        if v_product_type <> 'hotel' then
          return jsonb_build_object('ok', false, 'reason', 'room_type_mismatch', 'line', v_line);
        end if;
        if v_line_end_date is null then
          return jsonb_build_object('ok', false, 'reason', 'end_date_required', 'line', v_line);
        end if;
        select product_id, min_qty, max_qty, price_tiers
          into v_room_product_id, v_room_min_qty, v_room_max_qty, v_room_price_tiers
          from public.product_room_types where id = v_line_room_type_id;
        if not found or v_room_product_id <> (v_line->>'product_id')::uuid then
          return jsonb_build_object('ok', false, 'reason', 'room_type_not_found', 'line', v_line);
        end if;
        v_room_price_tiers := public.normalize_price_tiers(v_room_price_tiers);
        if v_line_qty < coalesce(v_room_min_qty, 1) then
          return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
        end if;
        if v_line_qty > coalesce(v_room_max_qty, 20) then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        if v_room_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_room_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
        end if;
      elsif v_product_type = 'hotel' then
        return jsonb_build_object('ok', false, 'reason', 'room_type_required', 'line', v_line);
      end if;

      if v_line_end_date is not null and v_line_room_type_id is null and v_product_type <> 'lodging' then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_date_range', 'line', v_line);
      end if;
      if v_line_end_date is not null and v_line_end_date <= (v_line->>'date')::date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_date_range', 'line', v_line);
      end if;

      if v_line_slot_start_time is not null then
        if v_line_room_type_id is not null or v_line_end_date is not null then
          return jsonb_build_object('ok', false, 'reason', 'unsupported_slot_combination', 'line', v_line);
        end if;
      elsif v_line_room_type_id is null and v_line_end_date is null and exists (
        select 1 from public.product_slot_rules where product_id = (v_line->>'product_id')::uuid
      ) then
        return jsonb_build_object('ok', false, 'reason', 'slot_required', 'line', v_line);
      end if;

      if v_product_type in ('lodging', 'hotel') then
        v_lodging_lines := v_lodging_lines + 1;
        v_lodging_units := v_lodging_units + v_line_qty;
      else
        v_prestation_lines := v_prestation_lines + 1;
        if v_line_qty < v_min_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
        end if;
        if v_line_qty > v_max_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
        end if;
      end if;
    end;
  end loop;
  if v_lodging_lines > 4 or v_lodging_units > 12 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 20 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  insert into public.product_availability (product_id, date, capacity, booked)
  select distinct p.id, (elem->>'date')::date, p.default_capacity, 0
    from jsonb_array_elements(p_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
   where elem->>'end_date' is null
     and elem->>'room_type_id' is null
     and p.default_capacity is not null
  on conflict (product_id, date) do nothing;

  insert into public.product_slot_availability (
    product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
  )
  select distinct p.id, (elem->>'date')::date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
    from jsonb_array_elements(p_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
    cross join lateral public.expand_product_slots(p.id, (elem->>'date')::date) v
   where elem->>'slot_start_time' is not null
     and v.slot_start_time = (elem->>'slot_start_time')::time
  on conflict (product_id, slot_date, slot_start_time) do nothing;

  for v_avail in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date
         from jsonb_array_elements(p_lines) elem
        where elem->>'end_date' is null
       union
       select (elem->>'product_id')::uuid, (elem->>'date')::date + gs
         from jsonb_array_elements(p_lines) elem
         join public.products p2 on p2.id = (elem->>'product_id')::uuid
         cross join lateral generate_series(0, ((elem->>'end_date')::date - (elem->>'date')::date) - 1) as gs
        where elem->>'end_date' is not null and elem->>'room_type_id' is null
          and p2.lobby_category_id is null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

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

  for v_avail in
    select rta.room_type_id, rta.date
      from public.room_type_availability rta
     where (rta.room_type_id, rta.date) in (
       select (elem->>'room_type_id')::uuid, (elem->>'date')::date + gs
         from jsonb_array_elements(p_lines) elem
         cross join lateral generate_series(0, ((elem->>'end_date')::date - (elem->>'date')::date) - 1) as gs
        where elem->>'room_type_id' is not null
     )
     order by rta.room_type_id, rta.date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select psa.product_id, psa.slot_date, psa.slot_start_time
      from public.product_slot_availability psa
     where (psa.product_id, psa.slot_date, psa.slot_start_time) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date, (elem->>'slot_start_time')::time
         from jsonb_array_elements(p_lines) elem
        where elem->>'slot_start_time' is not null
     )
     order by psa.product_id, psa.slot_date, psa.slot_start_time
     for update
  loop
    null;
  end loop;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(p_lines) with ordinality as t(elem, ord)
  loop
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
      v_line_room_type_id uuid := (v_line->>'room_type_id')::uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_cart_qty int;
      v_night_row record;
    begin
      if v_line_room_type_id is not null then
        v_sellable := v_products_sellable[v_line_idx];
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        for v_gs in 0..((v_line_end_date - (v_line->>'date')::date) - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          select capacity, booked into v_capacity, v_booked
            from public.room_type_availability
           where room_type_id = v_line_room_type_id and date = v_night;
          if not found then
            return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line, 'date', v_night);
          end if;
          select coalesce(sum((l->>'qty')::int), 0) into v_cart_qty
            from jsonb_array_elements(p_lines) l
           where (l->>'room_type_id')::uuid = v_line_room_type_id
             and v_night >= (l->>'date')::date
             and v_night < (l->>'end_date')::date;
          if v_booked + v_cart_qty > v_capacity then
            return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line, 'date', v_night);
          end if;
        end loop;

      elsif v_line_end_date is not null then
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if v_line_price_tiers is null and v_line_price_cop is null then
          return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
        end if;
        if v_products_lobby_category_id[v_line_idx] is null then
          for v_night_row in
            select gs.night::date as night,
                   coalesce(pc.open, v_products_calendar_default_open[v_line_idx]) as calendar_open,
                   pa.capacity as capacity,
                   pa.booked as booked,
                   (select coalesce(sum((l->>'qty')::int), 0)
                      from jsonb_array_elements(p_lines) l
                     where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
                       and l->>'room_type_id' is null
                       and l->>'end_date' is not null
                       and gs.night::date >= (l->>'date')::date
                       and gs.night::date < (l->>'end_date')::date
                   ) as cart_qty
              from generate_series(
                     (v_line->>'date')::date::timestamp,
                     v_line_end_date::timestamp - interval '1 day',
                     interval '1 day'
                   ) as gs(night)
              left join public.product_calendar pc
                on pc.product_id = (v_line->>'product_id')::uuid and pc.date = gs.night::date
              left join public.product_availability pa
                on pa.product_id = (v_line->>'product_id')::uuid and pa.date = gs.night::date
             order by gs.night
          loop
            if not v_night_row.calendar_open then
              return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.capacity is null then
              return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.booked + v_night_row.cart_qty > v_night_row.capacity then
              return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line, 'date', v_night_row.night);
            end if;
          end loop;
        end if;

      elsif v_line_slot_start_time is not null then
        v_sellable := v_products_sellable[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        select capacity, booked into v_capacity, v_booked
          from public.product_slot_availability
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;
        if not found then
          return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
        end if;

        if v_booked + (
          select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(p_lines) l
           where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
             and (l->>'date')::date = (v_line->>'date')::date
             and (l->>'slot_start_time')::time = v_line_slot_start_time
        ) > v_capacity then
          return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
        end if;

      else
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;

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
      end if;
    end;
  end loop;

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

  insert into public.orders (
    account_id, holder_name, holder_email, holder_phone, marketing_consent,
    referrer_partner_id, attribution_code, attribution_source
  )
  values (
    v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent,
    v_referrer_partner_id, v_attribution_code, v_attribution_source
  )
  returning id into v_order_id;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(p_lines) with ordinality as t(elem, ord)
  loop
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
      v_line_room_type_id uuid := (v_line->>'room_type_id')::uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_gs int;
      v_nights int;
      v_sum_nightly bigint;
      v_tier_price bigint;
      v_stay_rates jsonb;
    begin
      if v_line_room_type_id is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        select public.resolve_tier_price(price_tiers, price_cop, v_line_qty), stay_rates
          into v_tier_price, v_stay_rates
          from public.product_room_types where id = v_line_room_type_id;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price(v_line_room_type_id, null, v_night, v_tier_price, v_stay_rates);
        end loop;
        update public.room_type_availability set booked = booked + v_line_qty
         where room_type_id = v_line_room_type_id
           and date >= (v_line->>'date')::date and date < v_line_end_date;
        v_total_cop := v_sum_nightly * v_line_qty;
        v_line_price_cop := round(v_total_cop::numeric / v_line_qty);
        v_line_type := 'hotel';

      elsif v_line_end_date is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_stay_rates := v_products_stay_rates[v_line_idx];
        select public.resolve_tier_price(v_line_price_tiers, v_line_price_cop, v_line_qty) into v_tier_price;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price(null, (v_line->>'product_id')::uuid, v_night, v_tier_price, v_stay_rates);
        end loop;
        if v_products_lobby_category_id[v_line_idx] is null then
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid
             and date >= (v_line->>'date')::date and date < v_line_end_date;
        end if;
        v_total_cop := v_sum_nightly;
        v_line_price_cop := v_sum_nightly;

      elsif v_line_slot_start_time is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

        if v_line_price_tiers is not null then
          select t.price_cop into v_line_price_cop
            from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
           limit 1;
        end if;

        v_total_cop := v_line_price_cop * v_line_qty;

        update public.product_slot_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;

      else
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

        if v_line_price_tiers is not null then
          select t.price_cop into v_line_price_cop
            from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
           limit 1;
        end if;

        v_total_cop := v_line_price_cop * v_line_qty;

        update public.product_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
      end if;

      if v_referrer_partner_id is null then
        v_commission_case := 'direct';        v_referrer_pct := 0;    v_app_pct := 0.17;
      elsif v_referrer_partner_id = v_line_partner_id then
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.07;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.10; v_app_pct := 0.07;
      end if;
      v_acompte_pct := v_referrer_pct + v_app_pct;

      -- Ajout de cette migration : holder_phone, holder_email dans la liste de colonnes et de
      -- valeurs (jusqu'ici seul holder_name était dupliqué depuis p_holder_name/p_holder_email/
      -- p_holder_phone déjà disponibles comme paramètres de cette fonction).
      insert into public.order_lines (
        order_id, account_id, product_id, date, end_date, room_type_id, slot_start_time, qty,
        referrer_partner_id, holder_name, holder_phone, holder_email, price_cop, total_cop,
        commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
        app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_room_type_id, v_line_slot_start_time, v_line_qty,
        v_referrer_partner_id, p_holder_name, p_holder_phone, p_holder_email,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      if v_commission_case = 'external_referrer' then
        insert into public.ledger_entries (
          order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status
        )
        values (
          v_order_line_id, 'referrer', v_referrer_partner_id, 'referral_earned',
          round(v_total_cop * v_referrer_pct), 'estimated'
        );
      end if;

      if v_line_type = 'camp' then
        update public.provider_resource_calendar
           set booked = booked + v_line_qty
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

-- modify_order_line (dernière version : 20260818250000_fix_lodging_price_double_qty.sql) — signature
-- inchangée, 3 blocs insert de remplacement (room_type/alojamiento/date-unique) étendus avec
-- holder_phone/holder_email, copiés depuis v_old_line (la ligne remplacée). Sans cet ajout, annuler
-- puis modifier une réservation (statut 'superseded' -> nouvelle ligne 'reserved') aurait effacé
-- silencieusement le téléphone/email sur la ligne active.
create or replace function modify_order_line(
  p_order_line_id uuid, p_new_date date, p_new_qty int, p_reason text, p_new_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_line record;
  v_product record;
  v_lock_row record;
  v_same_slot boolean;
  v_calendar_open boolean;
  v_capacity int;
  v_booked int;
  v_effective_booked int;
  v_new_price_cop bigint;
  v_new_total_cop bigint;
  v_new_line_id uuid;
  v_old_nights date[];
  v_new_nights date[];
  v_night date;
  v_bound_min_qty int;
  v_bound_max_qty int;
  v_bound_price_tiers jsonb;
  v_bound_price_cop bigint;
  v_tier_price bigint;
  v_sum_nightly bigint;
  v_stay_rates jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier une réservation';
  end if;
  if p_new_qty is null or p_new_qty < 1 then
    raise exception 'quantité cible invalide : %', p_new_qty;
  end if;

  select ol.*, p.establishment_id as establishment_id
    into v_old_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id
   for update of ol;
  if not found then
    raise exception 'ligne de commande introuvable';
  end if;

  if not (select public.is_admin(auth.uid())) then
    if not (select public.has_capability(auth.uid(), 'operator', v_old_line.establishment_id)) then
      raise exception
        'modify_order_line réservé au rôle admin (ou à l''operator du même établissement)'
        using errcode = '42501';
    end if;
  end if;

  if v_old_line.status <> 'reserved' then
    raise exception 'seule une ligne au statut reserved peut être modifiée (statut actuel : %)', v_old_line.status;
  end if;

  if (v_old_line.room_type_id is not null or v_old_line.end_date is not null) then
    if p_new_end_date is null then
      raise exception 'p_new_end_date obligatoire pour modifier une ligne à plage (chambre/alojamiento)';
    end if;
  elsif p_new_end_date is not null then
    raise exception 'p_new_end_date doit rester null pour une ligne à date unique — transformer une ligne à date unique en ligne à plage (ou l''inverse) est hors périmètre';
  end if;

  if v_old_line.slot_start_time is not null then
    raise exception 'modify_order_line ne gère pas encore les réservations par créneau horaire — annuler puis recréer manuellement';
  end if;

  if v_old_line.room_type_id is not null then
    ------------------------------------------------------------------------------------------
    -- Branche chambre d'hôtel par plage (room_type_id non null) ------------------------------
    ------------------------------------------------------------------------------------------
    if p_new_end_date <= p_new_date then
      raise exception 'la date de check-out doit être postérieure à la date de check-in';
    end if;

    select min_qty, max_qty, price_tiers, price_cop, stay_rates
      into v_bound_min_qty, v_bound_max_qty, v_bound_price_tiers, v_bound_price_cop, v_stay_rates
      from public.product_room_types where id = v_old_line.room_type_id;
    v_bound_price_tiers := public.normalize_price_tiers(v_bound_price_tiers);

    if p_new_qty < coalesce(v_bound_min_qty, 1) or p_new_qty > coalesce(v_bound_max_qty, 20) then
      raise exception 'quantité % hors bornes [%, %] pour cette chambre',
        p_new_qty, coalesce(v_bound_min_qty, 1), coalesce(v_bound_max_qty, 20);
    end if;
    if v_bound_price_tiers is not null and not exists (
      select 1 from jsonb_to_recordset(v_bound_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_new_qty between t.min_qty and t.max_qty
    ) then
      raise exception 'aucun palier de prix ne couvre la quantité % pour cette chambre', p_new_qty;
    end if;

    v_old_nights := array(
      select v_old_line.date + gs from generate_series(0, (v_old_line.end_date - v_old_line.date) - 1) as gs
    );
    v_new_nights := array(
      select p_new_date + gs from generate_series(0, (p_new_end_date - p_new_date) - 1) as gs
    );

    for v_lock_row in
      select date from public.room_type_availability
       where room_type_id = v_old_line.room_type_id and date = any(v_old_nights || v_new_nights)
       order by date
       for update
    loop
      null;
    end loop;

    foreach v_night in array v_new_nights loop
      select capacity, booked into v_capacity, v_booked
        from public.room_type_availability
       where room_type_id = v_old_line.room_type_id and date = v_night;
      if not found then
        raise exception 'aucune disponibilité définie pour la nuit %', v_night;
      end if;
      v_effective_booked := v_booked - (case when v_night = any(v_old_nights) then v_old_line.qty else 0 end);
      if v_effective_booked + p_new_qty > v_capacity then
        raise exception 'capacité insuffisante pour la nuit % (% déjà réservé(s) sur %)',
          v_night, v_effective_booked, v_capacity;
      end if;
    end loop;

    select public.resolve_tier_price(v_bound_price_tiers, v_bound_price_cop, p_new_qty) into v_tier_price;
    v_sum_nightly := 0;
    foreach v_night in array v_new_nights loop
      v_sum_nightly := v_sum_nightly + public.resolve_date_price(v_old_line.room_type_id, null, v_night, v_tier_price, v_stay_rates);
    end loop;
    v_new_total_cop := v_sum_nightly * p_new_qty;
    v_new_price_cop := round(v_new_total_cop::numeric / p_new_qty);

    foreach v_night in array v_old_nights loop
      if not (v_night = any(v_new_nights)) then
        update public.room_type_availability set booked = booked - v_old_line.qty
         where room_type_id = v_old_line.room_type_id and date = v_night;
      end if;
    end loop;
    foreach v_night in array v_new_nights loop
      update public.room_type_availability
         set booked = booked - (case when v_night = any(v_old_nights) then v_old_line.qty else 0 end) + p_new_qty
       where room_type_id = v_old_line.room_type_id and date = v_night;
    end loop;

    update public.order_lines set status = 'superseded' where id = p_order_line_id;

    insert into public.order_lines (
      order_id, account_id, product_id, date, end_date, room_type_id, qty, status,
      referrer_partner_id, holder_name, holder_phone, holder_email, replaces_order_line_id,
      price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
      acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_end_date,
      v_old_line.room_type_id, p_new_qty, 'reserved',
      v_old_line.referrer_partner_id, v_old_line.holder_name, v_old_line.holder_phone,
      v_old_line.holder_email, p_order_line_id,
      v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
      v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
      round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
      round(v_new_total_cop * v_old_line.app_pct)
    ) returning id into v_new_line_id;

  elsif v_old_line.end_date is not null then
    ------------------------------------------------------------------------------------------
    -- Branche alojamiento par plage (room_type_id null, end_date non null) -------------------
    ------------------------------------------------------------------------------------------
    if p_new_end_date <= p_new_date then
      raise exception 'la date de check-out doit être postérieure à la date de check-in';
    end if;

    select min_qty, max_qty, price_tiers, price_cop, stay_rates
      into v_bound_min_qty, v_bound_max_qty, v_bound_price_tiers, v_bound_price_cop, v_stay_rates
      from public.products where id = v_old_line.product_id;
    v_bound_price_tiers := public.normalize_price_tiers(v_bound_price_tiers);

    if p_new_qty < coalesce(v_bound_min_qty, 1) or p_new_qty > coalesce(v_bound_max_qty, 20) then
      raise exception 'quantité % hors bornes [%, %] pour ce produit',
        p_new_qty, coalesce(v_bound_min_qty, 1), coalesce(v_bound_max_qty, 20);
    end if;
    if v_bound_price_tiers is not null and not exists (
      select 1 from jsonb_to_recordset(v_bound_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_new_qty between t.min_qty and t.max_qty
    ) then
      raise exception 'aucun palier de prix ne couvre la quantité %', p_new_qty;
    end if;

    v_old_nights := array(
      select v_old_line.date + gs from generate_series(0, (v_old_line.end_date - v_old_line.date) - 1) as gs
    );
    v_new_nights := array(
      select p_new_date + gs from generate_series(0, (p_new_end_date - p_new_date) - 1) as gs
    );

    for v_lock_row in
      select date from public.product_availability
       where product_id = v_old_line.product_id and date = any(v_old_nights || v_new_nights)
       order by date
       for update
    loop
      null;
    end loop;

    foreach v_night in array v_new_nights loop
      select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
        from public.products p
        left join public.product_calendar pc on pc.product_id = p.id and pc.date = v_night
       where p.id = v_old_line.product_id;
      if not v_calendar_open then
        raise exception 'nuit % fermée pour ce produit', v_night;
      end if;

      select capacity, booked into v_capacity, v_booked
        from public.product_availability
       where product_id = v_old_line.product_id and date = v_night;
      if not found then
        raise exception 'aucune disponibilité définie pour la nuit %', v_night;
      end if;
      v_effective_booked := v_booked - (case when v_night = any(v_old_nights) then v_old_line.qty else 0 end);
      if v_effective_booked + p_new_qty > v_capacity then
        raise exception 'capacité insuffisante pour la nuit % (% déjà réservé(s) sur %)',
          v_night, v_effective_booked, v_capacity;
      end if;
    end loop;

    select public.resolve_tier_price(v_bound_price_tiers, v_bound_price_cop, p_new_qty) into v_tier_price;
    v_sum_nightly := 0;
    foreach v_night in array v_new_nights loop
      v_sum_nightly := v_sum_nightly + public.resolve_date_price(null, v_old_line.product_id, v_night, v_tier_price, v_stay_rates);
    end loop;
    v_new_total_cop := v_sum_nightly;
    v_new_price_cop := v_sum_nightly;

    foreach v_night in array v_old_nights loop
      if not (v_night = any(v_new_nights)) then
        update public.product_availability set booked = booked - v_old_line.qty
         where product_id = v_old_line.product_id and date = v_night;
      end if;
    end loop;
    foreach v_night in array v_new_nights loop
      update public.product_availability
         set booked = booked - (case when v_night = any(v_old_nights) then v_old_line.qty else 0 end) + p_new_qty
       where product_id = v_old_line.product_id and date = v_night;
    end loop;

    update public.order_lines set status = 'superseded' where id = p_order_line_id;

    insert into public.order_lines (
      order_id, account_id, product_id, date, end_date, room_type_id, qty, status,
      referrer_partner_id, holder_name, holder_phone, holder_email, replaces_order_line_id,
      price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
      acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_end_date,
      null, p_new_qty, 'reserved',
      v_old_line.referrer_partner_id, v_old_line.holder_name, v_old_line.holder_phone,
      v_old_line.holder_email, p_order_line_id,
      v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
      v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
      round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
      round(v_new_total_cop * v_old_line.app_pct)
    ) returning id into v_new_line_id;

  else
    ------------------------------------------------------------------------------------------
    -- Branche existante (date unique, tous types dont camp) — fallback default_capacity
    ------------------------------------------------------------------------------------------
    select type, min_qty, max_qty, price_tiers, default_capacity into v_product
      from public.products where id = v_old_line.product_id;
    if v_product.type = 'camp' then
      raise exception 'modify_order_line ne gère pas encore les camps (ressource partagée multi-jours) — annuler puis recréer manuellement';
    end if;
    if p_new_qty < coalesce(v_product.min_qty, 1) or p_new_qty > coalesce(v_product.max_qty, 20) then
      raise exception 'quantité % hors bornes [%, %] pour ce produit', p_new_qty, coalesce(v_product.min_qty, 1), coalesce(v_product.max_qty, 20);
    end if;

    v_same_slot := (v_old_line.date = p_new_date);

    if v_product.default_capacity is not null and not v_same_slot then
      insert into public.product_availability (product_id, date, capacity, booked)
      values (v_old_line.product_id, p_new_date, v_product.default_capacity, 0)
      on conflict (product_id, date) do nothing;
    end if;

    for v_lock_row in
      select product_id, date from public.product_availability
       where product_id = v_old_line.product_id and date in (v_old_line.date, p_new_date)
       order by date for update
    loop
      null;
    end loop;

    select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
      from public.products p left join public.product_calendar pc
        on pc.product_id = p.id and pc.date = p_new_date
     where p.id = v_old_line.product_id;
    if not v_calendar_open then
      raise exception 'date cible fermée pour ce produit';
    end if;

    select capacity, booked into v_capacity, v_booked
      from public.product_availability where product_id = v_old_line.product_id and date = p_new_date;
    if not found then
      raise exception 'aucune disponibilité définie pour la date cible';
    end if;

    v_effective_booked := v_booked - (case when v_same_slot then v_old_line.qty else 0 end);
    if v_effective_booked + p_new_qty > v_capacity then
      raise exception 'capacité insuffisante à la date cible (% déjà réservé(s) sur %)', v_effective_booked, v_capacity;
    end if;

    v_bound_price_tiers := public.normalize_price_tiers(v_product.price_tiers);

    v_new_price_cop := v_old_line.price_cop;
    if v_bound_price_tiers is not null then
      select t.price_cop into v_new_price_cop
        from jsonb_to_recordset(v_bound_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_new_qty between t.min_qty and t.max_qty limit 1;
      if v_new_price_cop is null then
        raise exception 'aucun palier de prix ne couvre la quantité %', p_new_qty;
      end if;
    end if;
    v_new_total_cop := v_new_price_cop * p_new_qty;

    update public.product_availability set booked = booked - v_old_line.qty
     where product_id = v_old_line.product_id and date = v_old_line.date;
    update public.product_availability set booked = booked + p_new_qty
     where product_id = v_old_line.product_id and date = p_new_date;
    update public.order_lines set status = 'superseded' where id = p_order_line_id;

    insert into public.order_lines (
      order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
      holder_phone, holder_email, replaces_order_line_id, price_cop, total_cop, commission_case,
      acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_qty,
      'reserved', v_old_line.referrer_partner_id, v_old_line.holder_name, v_old_line.holder_phone,
      v_old_line.holder_email, p_order_line_id,
      v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
      v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
      round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
      round(v_new_total_cop * v_old_line.app_pct)
    ) returning id into v_new_line_id;
  end if;

  update public.pms_reconciliation_entries set order_line_id = v_new_line_id
   where order_line_id = p_order_line_id and status in ('open', 'retrying');

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    (select auth.uid()), 'order_line.modify', 'order_lines', p_order_line_id,
    jsonb_build_object('date', v_old_line.date, 'qty', v_old_line.qty)
      || case when v_old_line.end_date is not null
              then jsonb_build_object('end_date', v_old_line.end_date) else '{}'::jsonb end,
    jsonb_build_object('date', p_new_date, 'qty', p_new_qty, 'new_order_line_id', v_new_line_id)
      || case when p_new_end_date is not null
              then jsonb_build_object('end_date', p_new_end_date) else '{}'::jsonb end,
    p_reason
  );

  return jsonb_build_object('ok', true, 'order_line_id', v_new_line_id);
end;
$$;

grant execute on function modify_order_line(uuid, date, int, text, date) to authenticated;

-- create_manual_order_line (dernière version : 20260818190000) — signature INCHANGÉE (pas de
-- nouveau paramètre p_holder_email : créerait un second overload Postgres coexistant avec
-- l'ancien, bug silencieux). p_holder_phone (paramètre déjà existant) désormais propagé vers
-- order_lines.holder_phone ; order_lines.holder_email reçoit la même sentinelle que orders
-- ('reserva-manual@hifago.local') puisqu'aucun email réel n'est collecté pour un walk-in.
create or replace function create_manual_order_line(
  p_product_id uuid,
  p_date date,
  p_qty int,
  p_holder_name text,
  p_slot_start_time time default null,
  p_holder_phone text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_product_type text;
  v_establishment_id uuid;
  v_sellable boolean;
  v_calendar_open boolean;
  v_min_qty int;
  v_max_qty int;
  v_price_tiers jsonb;
  v_price_cop bigint;
  v_default_capacity int;
  v_capacity int;
  v_booked int;
  v_line_price_cop bigint;
  v_total_cop bigint;
  v_order_id uuid;
  v_order_line_id uuid;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_qty is null or p_qty < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_qty');
  end if;
  if p_holder_name is null or btrim(p_holder_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'holder_name_required');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  select type, establishment_id, sellable, min_qty, max_qty, price_tiers, price_cop, default_capacity
    into v_product_type, v_establishment_id, v_sellable, v_min_qty, v_max_qty, v_price_tiers,
         v_price_cop, v_default_capacity
    from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if jsonb_typeof(v_price_tiers) is distinct from 'array' then
    v_price_tiers := null;
  end if;

  if not v_is_admin and not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if v_product_type in ('hotel', 'lodging', 'camp') then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_product_type');
  end if;
  if not v_sellable then
    return jsonb_build_object('ok', false, 'reason', 'not_sellable');
  end if;
  if p_qty < coalesce(v_min_qty, 1) then
    return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum');
  end if;
  if p_qty > coalesce(v_max_qty, 20) then
    return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded');
  end if;
  if v_price_tiers is not null and not exists (
    select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
     where p_qty between t.min_qty and t.max_qty
  ) then
    return jsonb_build_object('ok', false, 'reason', 'no_matching_tier');
  end if;

  if p_slot_start_time is null and exists (
    select 1 from public.product_slot_rules where product_id = p_product_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot_required');
  end if;

  if p_slot_start_time is not null then
    ----------------------------------------------------------------------------------------------
    -- Branche créneau horaire (spec 18) --------------------------------------------------------
    ----------------------------------------------------------------------------------------------
    insert into public.product_slot_availability (
      product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
    )
    select p_product_id, p_date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
      from public.expand_product_slots(p_product_id, p_date) v
     where v.slot_start_time = p_slot_start_time
    on conflict (product_id, slot_date, slot_start_time) do nothing;

    select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
      from public.products p
      left join public.product_calendar pc on pc.product_id = p.id and pc.date = p_date
     where p.id = p_product_id;
    if not v_calendar_open then
      return jsonb_build_object('ok', false, 'reason', 'date_closed');
    end if;

    select capacity, booked into v_capacity, v_booked
      from public.product_slot_availability
     where product_id = p_product_id and slot_date = p_date and slot_start_time = p_slot_start_time
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_booked + p_qty > v_capacity then
      return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
    end if;

    v_line_price_cop := v_price_cop;
    if v_price_tiers is not null then
      select t.price_cop into v_line_price_cop
        from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_qty between t.min_qty and t.max_qty limit 1;
    end if;
    v_total_cop := v_line_price_cop * p_qty;

    update public.product_slot_availability set booked = booked + p_qty
     where product_id = p_product_id and slot_date = p_date and slot_start_time = p_slot_start_time;

  else
    ----------------------------------------------------------------------------------------------
    -- Branche date unique (default_capacity), même garde-fou que create_order Phase 2 -----------
    ----------------------------------------------------------------------------------------------
    if v_default_capacity is not null then
      insert into public.product_availability (product_id, date, capacity, booked)
      values (p_product_id, p_date, v_default_capacity, 0)
      on conflict (product_id, date) do nothing;
    end if;

    select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
      from public.products p
      left join public.product_calendar pc on pc.product_id = p.id and pc.date = p_date
     where p.id = p_product_id;
    if not v_calendar_open then
      return jsonb_build_object('ok', false, 'reason', 'date_closed');
    end if;
    if v_price_tiers is null and v_price_cop is null then
      return jsonb_build_object('ok', false, 'reason', 'price_missing');
    end if;

    select capacity, booked into v_capacity, v_booked
      from public.product_availability
     where product_id = p_product_id and date = p_date
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_booked + p_qty > v_capacity then
      return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
    end if;

    v_line_price_cop := v_price_cop;
    if v_price_tiers is not null then
      select t.price_cop into v_line_price_cop
        from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_qty between t.min_qty and t.max_qty limit 1;
    end if;
    v_total_cop := v_line_price_cop * p_qty;

    update public.product_availability set booked = booked + p_qty
     where product_id = p_product_id and date = p_date;
  end if;

  insert into public.orders (account_id, holder_name, holder_email, holder_phone, marketing_consent)
  values (null, p_holder_name, 'reserva-manual@hifago.local', p_holder_phone, false)
  returning id into v_order_id;

  insert into public.order_lines (
    order_id, account_id, product_id, date, slot_start_time, qty, holder_name,
    holder_phone, holder_email,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    v_order_id, null, p_product_id, p_date, p_slot_start_time, p_qty, p_holder_name,
    p_holder_phone, 'reserva-manual@hifago.local',
    v_line_price_cop, v_total_cop, 'operator_manual', 0, 0, 0, 0, 0, 0
  ) returning id into v_order_line_id;

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    v_account_id, 'order_line.create_manual', 'order_lines', v_order_line_id, null,
    jsonb_build_object(
      'product_id', p_product_id, 'date', p_date, 'slot_start_time', p_slot_start_time, 'qty', p_qty
    ),
    p_note
  );

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_line_id', v_order_line_id);
end;
$$;

grant execute on function create_manual_order_line(uuid, date, int, text, time, text, text) to authenticated;
