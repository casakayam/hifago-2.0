-- Correctif — surfacturation réelle constatée en usage (pas en test) : réserver "Alojamiento 1"
-- (4 nuits, 2 personnes, price_cop = 200 000/nuit) facturait 1 600 000 au lieu de 800 000. Root
-- cause : `qty` sur une ligne `lodging` = nombre de personnes, pas un nombre d'unités facturables
-- (spec 12 §0 ligne 76 — « qty sur une ligne de commande lodging = nombre de personnes » ; §3 —
-- les paliers de prix par nombre de personnes réutilisent `price_tiers`, exactement comme
-- `stayService.js` en V1 où `tiers[].price_cop` est déjà le tarif TOTAL de la nuit pour la tranche
-- d'occupants, jamais un prix par personne). `resolve_tier_price` sélectionne donc déjà le bon
-- tarif nocturne selon `qty` — mais `create_order`/`modify_order_line` multipliaient ENCORE ce
-- total par `qty` en fin de calcul, comptant les personnes deux fois.
--
-- Explicitement PAS le même bug que la branche chambre d'hôtel (`room_type_id`) : là, `qty` désigne
-- un nombre de lits/chambres réellement distincts et facturables un par un (dortoir : prix par lit ;
-- chambre privée : prix par chambre) — multiplier par `qty` y reste correct, aucune branche chambre
-- n'est touchée par cette migration.
--
-- Signatures INCHANGÉES : create or replace seul suffit. Un seul site modifié par fonction, dans la
-- branche alojamiento uniquement (`elsif v_line_end_date is not null` sans room_type_id) :
--   v_total_cop := v_sum_nightly;       -- au lieu de v_sum_nightly * v_line_qty
--   v_line_price_cop := v_sum_nightly;  -- au lieu de round(v_total_cop::numeric / v_line_qty)
-- (une seule unité facturable — le logement entier — donc price_cop = total_cop, même convention
-- que "prix par unité facturable pour tout le séjour" déjà utilisée par la branche chambre).

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
  -- Capture Phase 1 des colonnes `products` réutilisées en Phase 3/4 (finding "produits requêtés
  -- jusqu'à 3 fois par ligne, alors que products n'est jamais écrite/verrouillée dans cette
  -- fonction") — un tableau par colonne, indexé par v_line_idx (ordinalité de jsonb_array_elements
  -- sur p_lines, stable d'un passage à l'autre : p_lines ne change jamais pendant l'exécution).
  -- price_tiers est stocké TEL QUEL (avant normalize_price_tiers) : Phase 3 teste sa nullité SQL
  -- brute sans jamais lui appliquer jsonb_to_recordset (cf. son propre code, inchangé), Phase 4 la
  -- normalise elle-même juste avant usage exactement comme avant ce correctif — stocker la version
  -- déjà normalisée ici changerait silencieusement le résultat du test "is null" de Phase 3 pour un
  -- price_tiers portant le littéral JSON `null` (jsonb_typeof('null') est distinct de SQL NULL),
  -- un changement de comportement qu'on ne veut PAS introduire au passage.
  v_products_type text[];
  v_products_sellable boolean[];
  v_products_price_cop bigint[];
  v_products_price_tiers jsonb[];
  v_products_establishment_id uuid[];
  v_products_duration_days int[];
  v_products_partner_id uuid[];
  v_products_calendar_default_open boolean[];
  v_products_stay_rates jsonb[];
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

  -- Phase 1 : plafonds (AUCUN verrou pris). `with ordinality` fournit v_line_idx (position 1-based
  -- dans p_lines) — capture ci-dessous les colonnes products dont Phase 3/4 ont aussi besoin, pour
  -- ne plus les rejouer à chaque phase.
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
    begin
      select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates
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

      -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : price_tiers peut porter
      -- le littéral JSON `null` — normalisation LOCALE à Phase 1 uniquement (v_price_tiers, utilisé
      -- juste en dessous pour la branche prestation), après la capture ci-dessus (cf. commentaire
      -- de déclaration de v_products_price_tiers).
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
        -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : même normalisation
        -- côté product_room_types.price_tiers.
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
        -- Correctif (finding "3 requêtes × N nuits") : une seule requête set-based par ligne
        -- (generate_series LEFT JOIN product_calendar/product_availability), au lieu de 3 requêtes
        -- séparées PAR NUIT (calendar_open, capacité/booked, somme du panier). Mêmes conditions de
        -- refus, mêmes messages, même ordre de vérification (calendar_open puis capacité puis
        -- plein) nuit par nuit dans l'ordre croissant — seule la façon de récupérer les données
        -- change, jamais ce qui est validé.
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
        end loop;
        -- Compteur de capacité incrémenté UNE FOIS pour toute la plage (même delta à chaque nuit)
        -- au lieu d'un update par nuit dans la boucle ci-dessus (finding "booked incrémenté par
        -- nuit alors que la valeur ne dépend pas de la nuit") — seul resolve_date_price reste par
        -- nuit, lui, dépend réellement de la date. Sûr : Phase 2c a déjà verrouillé et Phase 3 a
        -- déjà validé une ligne room_type_availability pour CHAQUE nuit de cette plage (sinon
        -- slot_not_found), donc cet update touche exactement les mêmes lignes qu'un update par nuit
        -- l'aurait fait, une fois chacune (unique (room_type_id, date)).
        update public.room_type_availability set booked = booked + v_line_qty
         where room_type_id = v_line_room_type_id
           and date >= (v_line->>'date')::date and date < v_line_end_date;
        -- Branche chambre : qty = nombre de lits/chambres réellement distincts, chacun facturable —
        -- la multiplication par v_line_qty reste correcte ici, PAS TOUCHÉE par cette migration.
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
        -- Même correctif "booked incrémenté par nuit" que la branche chambre ci-dessus : un seul
        -- update pour toute la plage (même raisonnement de sûreté — Phase 2/Phase 3 garantissent une
        -- ligne product_availability par nuit de cette plage).
        update public.product_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid
           and date >= (v_line->>'date')::date and date < v_line_end_date;
        -- Correctif (2026-08-19, cf. entête de migration) : v_sum_nightly porte déjà le tarif de la
        -- nuit pour le logement ENTIER (resolve_tier_price a choisi le palier selon v_line_qty) —
        -- multiplier encore par v_line_qty comptait les personnes deux fois. Un alojamiento reste
        -- UNE seule unité facturable quel que soit le nombre d'occupants (contrairement à la branche
        -- chambre ci-dessus, où qty désigne des lits/chambres réellement distincts).
        v_total_cop := v_sum_nightly;
        v_line_price_cop := v_sum_nightly;

      elsif v_line_slot_start_time is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : price_tiers peut
        -- porter le littéral JSON `null`.
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
        -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : même normalisation
        -- que ci-dessus.
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

-- modify_order_line : même correctif, même site (branche alojamiento uniquement, room_type_id null
-- et end_date non null). Branche chambre PAS TOUCHÉE (qty = lits/chambres, multiplication correcte).
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
    -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : price_tiers peut porter
    -- le littéral JSON `null`.
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
    -- resolve_tier_price d'abord (palier de quantité), puis resolve_date_price par nuit. Branche
    -- chambre PAS TOUCHÉE par cette migration (qty = lits/chambres, multiplication correcte).
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
    -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : même normalisation que
    -- ci-dessus.
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
    -- Correctif (2026-08-19, cf. entête de migration) : même motif que create_order — v_sum_nightly
    -- porte déjà le tarif de la nuit pour le logement ENTIER (palier choisi selon p_new_qty), pas un
    -- prix par personne à multiplier de nouveau.
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

    -- Correctif (20260818240000, factorisé dans normalize_price_tiers) : price_tiers peut porter
    -- le littéral JSON `null` — normalisé dans v_bound_price_tiers (réutilisé, mêmes branches
    -- jamais actives en même temps) plutôt que sur le champ de record v_product.price_tiers, qu'on
    -- ne peut pas réaffecter directement.
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
