-- Spec 17 §0 Tranche 2 — moteur unifié chambre d'hôtel + alojamiento par nuits. Points 6/7 de §10
-- tranchés sur prototype réel avant d'ouvrir ce chantier (cf. journal 2026-08-17) ; ce fichier
-- couvre uniquement le socle serveur (tables, resolve_date_price, create_order étendu,
-- set_room_type_availability, set_date_rate) — écrans et RangeCalendar client dans des fichiers
-- séparés (pas de code SQL/TS mélangé dans une même migration).

-- Deux tables dédiées avec FK réelle, PAS une table polymorphe entity_type/entity_id — cf. spec
-- §10 (add_catalog_media est un dispatcher au-dessus de 3 tables physiques distinctes, jamais une
-- polymorphe sans intégrité référentielle ; même raisonnement ici). Clé primaire composite directe
-- (pas de uuid id séparé) : même patron que product_calendar, rien ne référence ces lignes par id.
create table product_date_rates (
  product_id uuid not null references products(id) on delete cascade,
  date date not null,
  price_cop bigint not null check (price_cop > 0),
  note text,
  primary key (product_id, date)
);

create table room_type_date_rates (
  room_type_id uuid not null references product_room_types(id) on delete cascade,
  date date not null,
  price_cop bigint not null check (price_cop > 0),
  note text,
  primary key (room_type_id, date)
);

-- Miroir exact de product_availability (uuid id + unique, pas une clé composite directe : même
-- patron, même table de référence pour ce type précis — capacité mutée ligne par ligne par une
-- RPC verrouillée).
create table room_type_availability (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references product_room_types(id) on delete cascade,
  date date not null,
  capacity int not null,
  booked int not null default 0,
  unique (room_type_id, date)
);

-- RPC-only (écriture) sur les 3 : mêmes critères que product_availability/orders/order_lines
-- (hifago/CLAUDE.md §3) — compteur de capacité (room_type_availability) ou prix nominal à auditer
-- (les deux tables de rate). Lecture publique directe en revanche (mêmes raisons que
-- product_availability_select_public : un visiteur doit voir le prix/la dispo sans RPC dédiée).
alter table product_date_rates enable row level security;
revoke insert, update, delete on product_date_rates from authenticated, anon;
create policy product_date_rates_select_public on product_date_rates for select using (true);

alter table room_type_date_rates enable row level security;
revoke insert, update, delete on room_type_date_rates from authenticated, anon;
create policy room_type_date_rates_select_public on room_type_date_rates for select using (true);

alter table room_type_availability enable row level security;
revoke insert, update, delete on room_type_availability from authenticated, anon;
create policy room_type_availability_select_public on room_type_availability for select using (true);

-- order_lines : room_type_id (chambre réservée — NULL pour tout ce qui n'est pas une chambre
-- d'hôtel), end_date (checkout EXCLUSIF, sémantique [date, end_date[ identique à la v1 — NULL pour
-- une ligne à date unique, comportement inchangé). Aucune contrainte NOT NULL croisée ici : Phase 1
-- de create_order est la seule autorité qui applique "room_type_id non nul ⇒ end_date non nul",
-- même discipline que le reste de cette RPC (jamais une contrainte CHECK dupliquant une validation
-- métier déjà faite en PL/pgSQL, cf. price_missing).
alter table order_lines
  add column room_type_id uuid references product_room_types(id),
  add column end_date date;

-- resolve_date_price — chaîne de priorité confirmée par Jérôme (spec §10 point 5) : override date
-- > stay_rates > price_tiers > prix de base. stay_rates (season/weekend) est un POURCENTAGE de
-- majoration (cf. apps/admin/lib/products/stayRates.ts — jamais un prix absolu), donc "stay_rates
-- > price_tiers" ne peut pas signifier "remplace" : la seule lecture cohérente est que stay_rates
-- MODIFIE le prix déjà résolu par palier/base, l'override date, lui, gagne intégralement (un admin
-- qui fixe un prix pour un jour précis veut ce chiffre exact, pas une majoration en plus dessus).
-- p_tier_base_price_cop est donc calculé par l'appelant (même logique jsonb_to_recordset déjà
-- utilisée ailleurs dans create_order, pas dupliquée ici) et transmis déjà résolu.
--
-- Exactement un des deux (p_room_type_id, p_product_id) est non NULL — l'appelant choisit l'entité
-- tarifée, jamais les deux à la fois.
-- p_stay_rates (ajouté, cf. §10 point ci-dessous) : invariant sur toutes les nuits d'une même ligne
-- panier (season/weekend_days vivent sur product_room_types/products, pas par nuit) — transmis déjà
-- résolu par l'appelant (même patron que p_tier_base_price_cop ci-dessus), qui le lit UNE FOIS par
-- ligne avant la boucle par nuit, plutôt qu'un `select stay_rates from ...` répété à chaque nuit.
create or replace function resolve_date_price(
  p_room_type_id uuid,
  p_product_id uuid,
  p_date date,
  p_tier_base_price_cop bigint,
  p_stay_rates jsonb
)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_override bigint;
  v_multiplier numeric := 1;
  v_month int;
  v_dow int;
begin
  if p_room_type_id is not null then
    select price_cop into v_override from public.room_type_date_rates
     where room_type_id = p_room_type_id and date = p_date;
    if found then
      return v_override;
    end if;
  else
    select price_cop into v_override from public.product_date_rates
     where product_id = p_product_id and date = p_date;
    if found then
      return v_override;
    end if;
  end if;

  if p_stay_rates is not null then
    v_month := extract(month from p_date);
    -- ISO 8601 (1=lundi..7=dimanche), même convention que stayRates.ts — extract(isodow) suit
    -- exactement cette numérotation, contrairement à extract(dow) (0=dimanche).
    v_dow := extract(isodow from p_date);
    if (p_stay_rates->'season'->'months') @> to_jsonb(v_month) then
      v_multiplier := v_multiplier + coalesce((p_stay_rates->'season'->>'surcharge_pct')::numeric, 0);
    end if;
    if (p_stay_rates->'weekend_days') @> to_jsonb(v_dow) then
      v_multiplier := v_multiplier + coalesce((p_stay_rates->>'weekend_surcharge_pct')::numeric, 0);
    end if;
  end if;

  return round(p_tier_base_price_cop * v_multiplier);
end;
$$;

grant execute on function resolve_date_price(uuid, uuid, date, bigint, jsonb) to authenticated, anon;

-- Petit helper factorisant la résolution par palier de quantité — UNIQUEMENT pour les deux
-- nouvelles branches plage de create_order (Phase 4 ci-dessous). Le reste de create_order
-- (branche existante, Phase 1/4) garde son propre jsonb_to_recordset inline, intentionnellement
-- non touché : Phase 1 y distingue "aucun palier ne correspond ⇒ refus" (no_matching_tier), un
-- comportement que ce helper ne reproduit pas (il replie silencieusement sur le prix de base) —
-- les deux fonctions répondent à des besoins différents, pas une négligence.
create or replace function resolve_tier_price(p_price_tiers jsonb, p_base_price_cop bigint, p_qty int)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case
    when p_price_tiers is null then p_base_price_cop
    else coalesce(
      (select t.price_cop from jsonb_to_recordset(p_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
        where p_qty between t.min_qty and t.max_qty limit 1),
      p_base_price_cop
    )
  end
$$;

-- create_order (dernière version : 20260817190000_orders_holder_email_required.sql) — deux
-- nouvelles branches plage ajoutées Phase 1/2/3/4 (chambre d'hôtel via room_type_id, alojamiento
-- via end_date seul) ; la branche existante (date unique, tous types dont camp) reste au mot près
-- inchangée pour ne courir aucun risque sur un chemin déjà testé/en production de fait.
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

      -- Nouveau (Tranche 2) : ligne chambre d'hôtel — room_type_id toujours accompagné d'une plage,
      -- toujours un produit type='hotel', toujours un type de chambre qui lui appartient réellement
      -- (jamais une confiance aveugle dans un id fourni par le client).
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
        -- 'hotel' ne se réserve jamais "en gros" : sans chambre choisie, il n'y a ni prix ni
        -- capacité à décrémenter. Refus explicite plutôt qu'un price_missing accidentel (products
        -- .price_cop est NULL par construction pour ce type, cf. 20260816110000).
        return jsonb_build_object('ok', false, 'reason', 'room_type_required', 'line', v_line);
      end if;

      -- Nouveau (Tranche 2) : ligne alojamiento par plage — end_date sans room_type_id, réservé au
      -- type lodging (les autres types gardent leur propre mécanisme, camp compris — duration_days
      -- + provider_resource_calendar, jamais end_date).
      if v_line_end_date is not null and v_line_room_type_id is null and v_product_type <> 'lodging' then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_date_range', 'line', v_line);
      end if;
      if v_line_end_date is not null and v_line_end_date <= (v_line->>'date')::date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_date_range', 'line', v_line);
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

  -- Phase 2 : verrouillage, ordre stable (product_id, date), toutes ressources en une requête.
  -- Étendu : le second membre de l'UNION verrouille CHAQUE nuit d'une ligne alojamiento par plage
  -- (room_type_id null), pas seulement sa date de check-in — même granularité que product_
  -- availability, jamais provider_resource_calendar (cf. spec §10, ce ne sont pas le même rôle).
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

  -- Phase 2c (Tranche 2, nouveau) : verrouillage room_type_availability, chaque nuit de chaque
  -- ligne chambre — même ordre déterministe (entité, date), pas de croisement avec Phase 2/2b
  -- (tables disjointes, aucun risque d'ordre incohérent entre les trois boucles).
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
      v_night date;
      v_cart_qty int;
    begin
      if v_line_room_type_id is not null then
        -- Chambre d'hôtel par plage : room_type_availability seule fait foi par nuit (pas de
        -- product_calendar pour une chambre — sparse : absence de ligne = pas encore ouverte,
        -- même convention que product_availability, cf. spec §10 "aucune table calendrier
        -- supplémentaire pour les chambres").
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
        -- Alojamiento par plage de nuits (room_type_id null) : même paire de signaux que le
        -- chemin existant (product_calendar pour l'ouverture, product_availability pour la
        -- capacité), simplement répétée nuit par nuit plutôt qu'une seule fois.
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
          -- Champ de recherche volontairement borné aux AUTRES lignes plage du même panier
          -- (room_type_id null, end_date non null) : une ligne à date unique du même produit dans
          -- le même panier reste hors cadre ici (cf. commentaire de tête de fichier, mélange
          -- plage+date unique sur le même produit dans un seul panier jamais produit par l'écran
          -- réel — Phase 2 verrouille déjà toutes les lignes concernées quel que soit ce calcul,
          -- la seule zone grise possible est un sous-comptage intra-panier, pas un trou de
          -- verrouillage inter-transaction).
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

      else
        -- Branche existante (date unique, tous types dont camp) — inchangée au mot près.
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
      v_night date;
      v_gs int;
      v_nights int;
      v_sum_nightly bigint;
      v_tier_price bigint;
      v_stay_rates jsonb;
    begin
      if v_line_room_type_id is not null then
        -- Chambre d'hôtel par plage : prix nuit par nuit (resolve_date_price), qty = lits (dorm)
        -- ou chambres (private) selon product_room_types.kind (spec §10 point 3) — le décompte lui
        -- ne distingue pas les deux, room_type_availability.booked s'incrémente de qty telle
        -- quelle dans les deux cas (la distinction vit dans la capacité définie par
        -- set_room_type_availability, pas ici).
        select partner_id into v_line_partner_id from public.products where id = (v_line->>'product_id')::uuid;
        -- stay_rates lu ici, une fois par ligne (invariant sur toutes ses nuits), et transmis à
        -- resolve_date_price ci-dessous au lieu d'un lookup répété à chaque nuit.
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
        -- Alojamiento par plage de nuits (room_type_id null).
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

      else
        -- Branche existante (date unique, tous types dont camp) — inchangée au mot près.
        select partner_id, price_cop, price_tiers, type, establishment_id, duration_days
          into v_line_partner_id, v_line_price_cop, v_line_price_tiers, v_line_type,
               v_line_establishment_id, v_line_duration_days
          from public.products where id = (v_line->>'product_id')::uuid;

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
        order_id, account_id, product_id, date, end_date, room_type_id, qty, referrer_partner_id,
        holder_name, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
        acompte_cop, referrer_commission_cop, app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_room_type_id, v_line_qty,
        v_referrer_partner_id, p_holder_name,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

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

-- set_room_type_availability — même patron exact que set_product_availability (admin+socio
-- unifiés, cf. 20260813244500), sans le concept d'ouverture séparé (pas de "product_calendar" pour
-- une chambre, cf. commentaire resolve_date_price/create_order plus haut : la présence d'une ligne
-- avec capacity>0 EST le signal d'ouverture, patron sparse assumé). Garde-fou supplémentaire (pas
-- présent dans set_product_availability, ajouté ici parce que la capacité physique réelle est
-- connue) : refuse une capacité qui dépasse quantity×capacity (dortoir) ou quantity (chambre
-- privée) — évite qu'une faute de frappe admin ouvre plus de cupos que de lits/chambres réels.
create or replace function set_room_type_availability(
  p_room_type_id uuid,
  p_date date,
  p_capacity int,
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
  v_partner_id uuid;
  v_establishment_id uuid;
  v_kind text;
  v_quantity int;
  v_room_capacity int;
  v_max_capacity int;
  v_before_capacity int;
  v_before_booked int;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select rt.kind, rt.quantity, rt.capacity, p.establishment_id
    into v_kind, v_quantity, v_room_capacity, v_establishment_id
    from public.product_room_types rt
    join public.products p on p.id = rt.product_id
   where rt.id = p_room_type_id;

  if v_establishment_id is null then
    return jsonb_build_object('ok', false, 'reason', 'room_type_not_found');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  if not v_is_admin then
    v_partner_id := (select public.partner_id_for_account(v_account_id));
    if not exists (
      select 1 from public.establishments
       where id = v_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'room_type_not_found');
    end if;
    if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  if p_capacity < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capacity');
  end if;

  if v_quantity is not null then
    v_max_capacity := case v_kind when 'dorm' then v_quantity * v_room_capacity else v_quantity end;
    if p_capacity > v_max_capacity then
      return jsonb_build_object('ok', false, 'reason', 'capacity_exceeds_physical', 'max', v_max_capacity);
    end if;
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.room_type_availability
   where room_type_id = p_room_type_id and date = p_date
   for update;

  if found and p_capacity < v_before_booked then
    return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_before_booked);
  end if;

  if found then
    update public.room_type_availability set capacity = p_capacity
     where room_type_id = p_room_type_id and date = p_date;
  else
    insert into public.room_type_availability (room_type_id, date, capacity, booked)
    values (p_room_type_id, p_date, p_capacity, 0);
  end if;

  if v_is_admin then
    perform public.log_admin_action(
      'room_type.set_availability', 'room_type_availability', p_room_type_id,
      jsonb_build_object('date', p_date, 'capacity', v_before_capacity, 'booked', v_before_booked),
      jsonb_build_object('date', p_date, 'capacity', p_capacity),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_room_type_availability(uuid, date, int, text) to authenticated;

-- set_date_rate — dispatcher au-dessus des deux tables de rate physiques distinctes, même patron
-- exact que add_catalog_media(p_entity_type, ...) (cf. 20260816130000) : jamais une polymorphe,
-- juste une RPC qui choisit la bonne table selon p_entity_type. p_price_cop NULL = supprime
-- l'override existant (retour à stay_rates/palier/prix de base pour cette date), pas une valeur à
-- refuser.
create or replace function set_date_rate(
  p_entity_type text,       -- 'product' | 'room_type'
  p_entity_id uuid,
  p_date date,
  p_price_cop bigint,
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
  v_partner_id uuid;
  v_establishment_id uuid;
begin
  if p_entity_type not in ('product', 'room_type') then
    raise exception 'p_entity_type invalide : %', p_entity_type;
  end if;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_entity_type = 'product' then
    select establishment_id into v_establishment_id from public.products where id = p_entity_id;
  else
    select p.establishment_id into v_establishment_id
      from public.product_room_types rt join public.products p on p.id = rt.product_id
     where rt.id = p_entity_id;
  end if;
  if v_establishment_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));
  if not v_is_admin then
    v_partner_id := (select public.partner_id_for_account(v_account_id));
    if not exists (
      select 1 from public.establishments where id = v_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  if p_price_cop is not null and p_price_cop <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_price');
  end if;

  if p_entity_type = 'product' then
    if p_price_cop is null then
      delete from public.product_date_rates where product_id = p_entity_id and date = p_date;
    else
      insert into public.product_date_rates (product_id, date, price_cop, note)
      values (p_entity_id, p_date, p_price_cop, p_note)
      on conflict (product_id, date) do update set price_cop = excluded.price_cop, note = excluded.note;
    end if;
  else
    if p_price_cop is null then
      delete from public.room_type_date_rates where room_type_id = p_entity_id and date = p_date;
    else
      insert into public.room_type_date_rates (room_type_id, date, price_cop, note)
      values (p_entity_id, p_date, p_price_cop, p_note)
      on conflict (room_type_id, date) do update set price_cop = excluded.price_cop, note = excluded.note;
    end if;
  end if;

  if v_is_admin then
    perform public.log_admin_action(
      'date_rate.set', p_entity_type || '_date_rates', p_entity_id,
      null, jsonb_build_object('date', p_date, 'price_cop', p_price_cop), p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_date_rate(text, uuid, date, bigint, text) to authenticated;

-- modify_order_line (20260817200000) ne raisonne qu'en product_availability à date unique — une
-- ligne à plage (room_type_id ou end_date non nuls) traitée par cette RPC corromprait
-- silencieusement la capacité (elle ignorerait end_date/room_type_id et ne libérerait/consommerait
-- que la seule "date" comme si c'était une réservation à une nuit). Garde-fou explicite plutôt
-- qu'un mauvais résultat silencieux — réécriture polymorphe déjà annoncée comme travail futur par
-- la spec 17 §0 Tranche 1 point 4 ("réécriture prévue en Tranche 2"), non encore faite ici : ce
-- refus reste donc en place à l'issue de cette migration, ligne à plage = pas encore modifiable
-- par l'écran Modificar.
create or replace function modify_order_line(
  p_order_line_id uuid, p_new_date date, p_new_qty int, p_reason text
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
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'modify_order_line réservé au rôle admin' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier une réservation';
  end if;
  if p_new_qty is null or p_new_qty < 1 then
    raise exception 'quantité cible invalide : %', p_new_qty;
  end if;

  select * into v_old_line from public.order_lines where id = p_order_line_id for update;
  if not found then
    raise exception 'ligne de commande introuvable';
  end if;
  if v_old_line.status <> 'reserved' then
    raise exception 'seule une ligne au statut reserved peut être modifiée (statut actuel : %)', v_old_line.status;
  end if;
  if v_old_line.room_type_id is not null or v_old_line.end_date is not null then
    raise exception 'modify_order_line ne gère pas encore les réservations par plage (chambre/alojamiento) — annuler puis recréer manuellement';
  end if;

  select type, min_qty, max_qty, price_tiers into v_product from public.products where id = v_old_line.product_id;
  if v_product.type = 'camp' then
    raise exception 'modify_order_line ne gère pas encore les camps (ressource partagée multi-jours) — annuler puis recréer manuellement';
  end if;
  if p_new_qty < coalesce(v_product.min_qty, 1) or p_new_qty > coalesce(v_product.max_qty, 20) then
    raise exception 'quantité % hors bornes [%, %] pour ce produit', p_new_qty, coalesce(v_product.min_qty, 1), coalesce(v_product.max_qty, 20);
  end if;

  v_same_slot := (v_old_line.date = p_new_date);

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

  v_new_price_cop := v_old_line.price_cop;
  if v_product.price_tiers is not null then
    select t.price_cop into v_new_price_cop
      from jsonb_to_recordset(v_product.price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
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

  update public.pms_reconciliation_entries set order_line_id = v_new_line_id
   where order_line_id = p_order_line_id and status in ('open', 'retrying');

  perform public.log_admin_action(
    'order_line.modify', 'order_lines', p_order_line_id,
    jsonb_build_object('date', v_old_line.date, 'qty', v_old_line.qty),
    jsonb_build_object('date', p_new_date, 'qty', p_new_qty, 'new_order_line_id', v_new_line_id),
    p_reason
  );

  return jsonb_build_object('ok', true, 'order_line_id', v_new_line_id);
end;
$$;

grant execute on function modify_order_line(uuid, date, int, text) to authenticated;
