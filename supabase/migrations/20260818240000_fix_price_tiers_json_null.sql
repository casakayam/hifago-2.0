-- Correctif — même motif que 20260818190000 (create_manual_order_line), étendu ici aux 3 autres
-- points d'entrée qui lisent products.price_tiers / product_room_types.price_tiers : resolve_tier_price,
-- create_order, modify_order_line. Constaté en usage réel (pas en test) : products.price_tiers peut
-- porter le littéral JSON `null` (11 produits dans la base locale au moment du premier correctif,
-- au lieu d'un vrai NULL SQL). `v_xxx is not null` reste VRAI pour cette valeur en PL/pgSQL, donc
-- `jsonb_to_recordset('null'::jsonb)` lève "cannot call jsonb_to_recordset on a non-array" — exactement
-- l'erreur déjà corrigée pour la réservation manuelle, ici reproduite sur le vrai checkout client
-- (create_order) en réservant un alojamiento portant ce littéral.
--
-- Signalé au moment du premier correctif comme risque non traité sur ces 3 fonctions (cf. journal
-- 2026-08-18, spec 20 §10 point 13) — tranché maintenant : Jérôme a choisi de corriger le code
-- plutôt qu'un simple patch de données, pour couvrir tous les produits concernés, pas seulement
-- celui qui bloquait sa demande de test.
--
-- Signatures INCHANGÉES pour les 3 fonctions : create or replace seul suffit. Un seul motif de
-- correctif, appliqué à chaque site qui lit price_tiers avant de le tester "is not null" :
--   if jsonb_typeof(v_xxx) is distinct from 'array' then v_xxx := null; end if;
-- (jsonb_typeof(NULL) renvoie NULL, et NULL is distinct from 'array' est vrai — donc un vrai NULL
-- SQL est réaffecté à null, sans effet ; un littéral JSON `null` (jsonb_typeof = 'null') est aussi
-- normalisé à null ; seul un vrai tableau jsonb passe inchangé.)

-- normalize_price_tiers — le même garde-fou 3 lignes (`if jsonb_typeof(v_xxx) is distinct from
-- 'array' then v_xxx := null; end if;`) était copié-collé 7 fois dans create_order/modify_order_line
-- ci-dessous (une variable procédurale à la fois, jamais réutilisable telle quelle). Factorisé ici en
-- une fonction SQL pure, aux côtés de resolve_tier_price/resolve_date_price : chaque site devient
-- `v_xxx := normalize_price_tiers(v_xxx);`.
create or replace function normalize_price_tiers(p_price_tiers jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when jsonb_typeof(p_price_tiers) is distinct from 'array' then null else p_price_tiers end
$$;

-- resolve_tier_price : fonction SQL pure, le correctif se fait directement dans la condition du CASE
-- (pas de variable procédurale à normaliser).
create or replace function resolve_tier_price(p_price_tiers jsonb, p_base_price_cop bigint, p_qty int)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case
    when p_price_tiers is null or jsonb_typeof(p_price_tiers) is distinct from 'array' then p_base_price_cop
    else coalesce(
      (select t.price_cop from jsonb_to_recordset(p_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
        where p_qty between t.min_qty and t.max_qty limit 1),
      p_base_price_cop
    )
  end
$$;

-- create_order (dernière version : 20260818140000_create_order_ledger_entry.sql) — 4 sites normalisés :
-- Phase 1 (v_price_tiers, v_room_price_tiers, avant les tests "is not null" qui décident
-- no_matching_tier) et Phase 4 (v_line_price_tiers, branches créneau et date unique/camp — les
-- branches chambre/alojamiento passent déjà par resolve_tier_price, corrigé ci-dessus, donc rien à
-- changer sur ces deux-là). Tout le reste de la fonction reste au mot près identique.
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
    declare
      v_line_room_type_id uuid := (v_line->>'room_type_id')::uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_room_product_id uuid;
      v_room_min_qty int;
      v_room_max_qty int;
      v_room_price_tiers jsonb;
    begin
      select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers
        from public.products where id = (v_line->>'product_id')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
      end if;
      -- Correctif : price_tiers peut porter le littéral JSON `null` (cf. entête de migration).
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
        -- Correctif : même normalisation côté product_room_types.price_tiers.
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

  -- Phase 2 (avant verrouillage) : matérialise une ligne product_availability par défaut pour toute
  -- ligne à DATE UNIQUE (room_type_id et end_date tous deux null) dont le produit porte un
  -- default_capacity et n'a encore AUCUNE ligne pour cette date précise. Idempotent (on conflict do
  -- nothing) — cf. 20260818090000 pour la justification complète.
  insert into public.product_availability (product_id, date, capacity, booked)
  select distinct p.id, (elem->>'date')::date, p.default_capacity, 0
    from jsonb_array_elements(p_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
   where elem->>'end_date' is null
     and elem->>'room_type_id' is null
     and p.default_capacity is not null
  on conflict (product_id, date) do nothing;

  -- Phase 2 (spec 18 Tranche 1, avant verrouillage) : matérialise product_slot_availability depuis
  -- expand_product_slots pour toute ligne à créneau — même garde-fou de concurrence déjà justifié
  -- et testé pour default_capacity ci-dessus (on conflict do nothing, DOIT précéder la boucle de
  -- verrouillage).
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

  -- Phase 2 : verrouillage, ordre stable (product_id, date), toutes ressources en une requête.
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
         cross join lateral generate_series(0, ((elem->>'end_date')::date - (elem->>'date')::date) - 1) as gs
        where elem->>'end_date' is not null and elem->>'room_type_id' is null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  -- Phase 2b (feature 20) : verrouillage de la ressource partagée, camps uniquement. Inchangé.
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

  -- Phase 2c (Tranche 2) : verrouillage room_type_availability, chaque nuit de chaque ligne
  -- chambre — même ordre déterministe (entité, date), pas de croisement avec Phase 2/2b.
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

  -- Phase 2d (spec 18 Tranche 1) : verrouillage product_slot_availability, une ligne par
  -- (product_id, slot_date, slot_start_time) — table disjointe des trois autres.
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
      v_line_room_type_id uuid := (v_line->>'room_type_id')::uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_cart_qty int;
    begin
      if v_line_room_type_id is not null then
        select sellable into v_sellable from public.products where id = (v_line->>'product_id')::uuid;
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
        select p.sellable, p.type, p.price_cop, p.price_tiers
          into v_sellable, v_line_type, v_line_price_cop, v_line_price_tiers
          from public.products p where p.id = (v_line->>'product_id')::uuid;
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if v_line_price_tiers is null and v_line_price_cop is null then
          return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
        end if;
        for v_gs in 0..((v_line_end_date - (v_line->>'date')::date) - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
            from public.products p
            left join public.product_calendar pc on pc.product_id = p.id and pc.date = v_night
           where p.id = (v_line->>'product_id')::uuid;
          if not v_calendar_open then
            return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line, 'date', v_night);
          end if;
          select capacity, booked into v_capacity, v_booked
            from public.product_availability
           where product_id = (v_line->>'product_id')::uuid and date = v_night;
          if not found then
            return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line, 'date', v_night);
          end if;
          select coalesce(sum((l->>'qty')::int), 0) into v_cart_qty
            from jsonb_array_elements(p_lines) l
           where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
             and l->>'room_type_id' is null
             and l->>'end_date' is not null
             and v_night >= (l->>'date')::date
             and v_night < (l->>'end_date')::date;
          if v_booked + v_cart_qty > v_capacity then
            return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line, 'date', v_night);
          end if;
        end loop;

      elsif v_line_slot_start_time is not null then
        select p.sellable, coalesce(pc.open, p.calendar_default_open)
          into v_sellable, v_calendar_open
          from public.products p
          left join public.product_calendar pc on pc.product_id = p.id and pc.date = (v_line->>'date')::date
         where p.id = (v_line->>'product_id')::uuid;
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
        select partner_id into v_line_partner_id from public.products where id = (v_line->>'product_id')::uuid;
        select public.resolve_tier_price(price_tiers, price_cop, v_line_qty), stay_rates
          into v_tier_price, v_stay_rates
          from public.product_room_types where id = v_line_room_type_id;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price(v_line_room_type_id, null, v_night, v_tier_price, v_stay_rates);
          update public.room_type_availability set booked = booked + v_line_qty
           where room_type_id = v_line_room_type_id and date = v_night;
        end loop;
        v_total_cop := v_sum_nightly * v_line_qty;
        v_line_price_cop := round(v_total_cop::numeric / v_line_qty);
        v_line_type := 'hotel';

      elsif v_line_end_date is not null then
        select partner_id, price_cop, price_tiers, type, establishment_id, stay_rates
          into v_line_partner_id, v_line_price_cop, v_line_price_tiers, v_line_type, v_line_establishment_id, v_stay_rates
          from public.products where id = (v_line->>'product_id')::uuid;
        select public.resolve_tier_price(v_line_price_tiers, v_line_price_cop, v_line_qty) into v_tier_price;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price(null, (v_line->>'product_id')::uuid, v_night, v_tier_price, v_stay_rates);
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid and date = v_night;
        end loop;
        v_total_cop := v_sum_nightly * v_line_qty;
        v_line_price_cop := round(v_total_cop::numeric / v_line_qty);

      elsif v_line_slot_start_time is not null then
        select partner_id, price_cop, price_tiers, type, establishment_id, duration_days
          into v_line_partner_id, v_line_price_cop, v_line_price_tiers, v_line_type,
               v_line_establishment_id, v_line_duration_days
          from public.products where id = (v_line->>'product_id')::uuid;
        -- Correctif : price_tiers peut porter le littéral JSON `null` (cf. entête de migration).
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
        select partner_id, price_cop, price_tiers, type, establishment_id, duration_days
          into v_line_partner_id, v_line_price_cop, v_line_price_tiers, v_line_type,
               v_line_establishment_id, v_line_duration_days
          from public.products where id = (v_line->>'product_id')::uuid;
        -- Correctif : même normalisation que ci-dessus.
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

      insert into public.order_lines (
        order_id, account_id, product_id, date, end_date, room_type_id, slot_start_time, qty,
        referrer_partner_id, holder_name, price_cop, total_cop, commission_case, acompte_pct,
        referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_room_type_id, v_line_slot_start_time, v_line_qty,
        v_referrer_partner_id, p_holder_name,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      -- Spec 19 §0 Tranche 0 : écriture ledger initiale, uniquement pour un référent externe (les
      -- deux autres cas ont referrer_pct = 0, rien à devoir à personne — la part app n'est jamais
      -- une ligne de ledger_entries, cf. spec 19 §0 invariants). Même formule que
      -- referrer_commission_cop ci-dessus (round(v_total_cop * v_referrer_pct)) — pas une seconde
      -- lecture, une recomposition identique dans la même transaction.
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

-- modify_order_line (dernière version : 20260818180000_order_line_operator_actions.sql) — 3 sites
-- normalisés : v_bound_price_tiers dans les branches chambre et alojamiento (couvre à la fois le
-- test "is not null" inline et l'appel resolve_tier_price un peu plus bas, corrigé ci-dessus par
-- surcroît) ; v_bound_price_tiers réutilisé aussi dans la branche date unique/camp, à la place de
-- v_product.price_tiers (un champ de record ne peut pas être réaffecté directement). Tout le reste
-- de la fonction reste au mot près identique.
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

  -- Cohérence p_new_end_date / forme de la ligne (Tranche 2) : jamais de conversion plage <-> date
  -- unique dans cette RPC, refus explicite plutôt qu'une corruption silencieuse (cf. entête).
  if (v_old_line.room_type_id is not null or v_old_line.end_date is not null) then
    if p_new_end_date is null then
      raise exception 'p_new_end_date obligatoire pour modifier une ligne à plage (chambre/alojamiento)';
    end if;
  elsif p_new_end_date is not null then
    raise exception 'p_new_end_date doit rester null pour une ligne à date unique — transformer une ligne à date unique en ligne à plage (ou l''inverse) est hors périmètre';
  end if;

  -- Nouveau (spec 18 Tranche 1) : une ligne à créneau horaire n'est pas encore modifiable par cette
  -- RPC (hors périmètre explicite, spec 18 §2 Portée-Out, confirmé hors périmètre pour l'operator
  -- aussi par la spec 20 §10 point 8) — même traitement que le camp aujourd'hui (raise exception
  -- nommée, "annuler puis recréer manuellement"), pas un trou silencieux.
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
    -- Correctif : price_tiers peut porter le littéral JSON `null` (cf. entête de migration).
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

    -- Verrouillage déterministe de toutes les nuits concernées (union ancien/nouveau intervalle),
    -- même discipline que create_order Phase 2c — avant toute lecture de décision.
    for v_lock_row in
      select date from public.room_type_availability
       where room_type_id = v_old_line.room_type_id and date = any(v_old_nights || v_new_nights)
       order by date
       for update
    loop
      null;
    end loop;

    -- Validation : uniquement les nuits du NOUVEL intervalle (une libération pure ne peut jamais
    -- échouer). v_effective_booked généralise le v_same_slot de la branche historique, nuit par
    -- nuit : on ne crédite l'ancienne qty que si CETTE nuit précise appartenait déjà à l'ancien
    -- intervalle.
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

    -- Prix re-résolu nuit par nuit, même patron que create_order Phase 4 (branche chambre) :
    -- resolve_tier_price d'abord (palier de quantité), puis resolve_date_price par nuit.
    select public.resolve_tier_price(v_bound_price_tiers, v_bound_price_cop, p_new_qty) into v_tier_price;
    v_sum_nightly := 0;
    foreach v_night in array v_new_nights loop
      v_sum_nightly := v_sum_nightly + public.resolve_date_price(v_old_line.room_type_id, null, v_night, v_tier_price, v_stay_rates);
    end loop;
    v_new_total_cop := v_sum_nightly * p_new_qty;
    v_new_price_cop := round(v_new_total_cop::numeric / p_new_qty);

    -- Écriture capacité : nuits sorties de l'intervalle = libération pleine (ancienne qty) ; nuits
    -- du nouvel intervalle = UN SEUL update par nuit portant le delta net — couvre aussi les nuits
    -- communes aux deux intervalles, jamais touchées deux fois (ni double-libérées, ni double-
    -- consommées).
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
      referrer_partner_id, holder_name, replaces_order_line_id,
      price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
      acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_end_date,
      v_old_line.room_type_id, p_new_qty, 'reserved',
      v_old_line.referrer_partner_id, v_old_line.holder_name, p_order_line_id,
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
    -- Correctif : même normalisation que ci-dessus.
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

    -- Validation : calendar_open ET capacité pour chaque nuit du NOUVEL intervalle, même paire de
    -- signaux que create_order Phase 3 (branche alojamiento).
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
    v_new_total_cop := v_sum_nightly * p_new_qty;
    v_new_price_cop := round(v_new_total_cop::numeric / p_new_qty);

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
      referrer_partner_id, holder_name, replaces_order_line_id,
      price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
      acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_end_date,
      null, p_new_qty, 'reserved',
      v_old_line.referrer_partner_id, v_old_line.holder_name, p_order_line_id,
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

    -- Nouveau : matérialise la date cible si le produit porte un default_capacity et qu'aucune
    -- ligne product_availability n'existe encore pour elle — même garde-fou que create_order,
    -- placé AVANT le verrouillage ci-dessous pour que le FOR UPDATE la trouve et la verrouille
    -- normalement (l'unicité (product_id, date) sérialise deux appels concurrents). La date
    -- source (v_old_line.date) n'a jamais besoin de ce traitement : une ligne 'reserved' existante
    -- implique nécessairement qu'une ligne product_availability y a déjà été consommée.
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

    -- Correctif : price_tiers peut porter le littéral JSON `null` — normalisé dans
    -- v_bound_price_tiers (réutilisé, mêmes branches jamais actives en même temps) plutôt que sur
    -- le champ de record v_product.price_tiers, qu'on ne peut pas réaffecter directement.
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
      replaces_order_line_id, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
      acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_qty,
      'reserved', v_old_line.referrer_partner_id, v_old_line.holder_name, p_order_line_id,
      v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
      v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
      round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
      round(v_new_total_cop * v_old_line.app_pct)
    ) returning id into v_new_line_id;
  end if;

  update public.pms_reconciliation_entries set order_line_id = v_new_line_id
   where order_line_id = p_order_line_id and status in ('open', 'retrying');

  -- Audit : insert direct (fix chokepoint, cf. entête 20260818180000) — avant/après enrichis d'un
  -- end_date UNIQUEMENT quand la ligne concernée en porte un, comme avant.
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
