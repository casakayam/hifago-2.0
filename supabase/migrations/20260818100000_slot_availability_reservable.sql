-- Spec 18 Tranche 1 — rend product_slot_rules (posée par la spec 11, jamais consommée par une
-- RPC de réservation, cf. spec 17 §10 point 12) réellement réservable côté client avec
-- anti-survente. Décision Jérôme (2026-08-18, question posée pendant cette implémentation) :
-- set_product_slot_capacity suit le régime admin+socio unifié, même arbitrage déjà en place pour
-- set_product_availability/set_room_type_availability (le socio gère déjà ses cupos quotidiens
-- partout ailleurs) — pas le régime admin-only de product_slot_rules elle-même (les horaires
-- restent admin-only, seule la capacité jour par jour d'un créneau s'ouvre au socio).

-- Miroir de convention de product_availability/room_type_availability (uuid id + unique, PAS une
-- PK composite — capacité mutée ligne par ligne par une RPC verrouillée, cf. spec 18 §0).
-- slot_duration_minutes est un SNAPSHOT (pas relu depuis product_slot_rules après matérialisation)
-- : une ligne déjà matérialisée reste auto-descriptive même si la règle source change ensuite,
-- même principe que le snapshot financier d'order_lines.
create table product_slot_availability (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  slot_date date not null,
  slot_start_time time not null,
  slot_duration_minutes int not null,
  capacity int not null,
  booked int not null default 0,
  unique (product_id, slot_date, slot_start_time)
);

-- RPC-only (écriture) : compteur de capacité décrémenté par une RPC verrouillée (hifago/CLAUDE.md
-- §3), même critère que product_availability/room_type_availability. Lecture publique directe
-- (un visiteur doit voir les cupos restants sans RPC dédiée), même patron.
alter table product_slot_availability enable row level security;
revoke insert, update, delete on product_slot_availability from authenticated, anon;
create policy product_slot_availability_select_public on product_slot_availability
  for select using (true);

-- order_lines.slot_start_time : NULL pour tout ce qui n'est pas une ligne à créneau (comportement
-- inchangé pour les 3 branches existantes — date unique, chambre d'hôtel, alojamiento par plage).
-- Chaîne "HH:MM:SS" opaque en sortie JSON, jamais collapsée en Date JS combinée à la date (§10
-- point 5 de la spec — time without time zone est la bonne primitive, un objet Date combiné serait
-- interprété dans le fuseau du navigateur visiteur, pas celui de Bogota).
alter table order_lines add column slot_start_time time;

-- expand_product_slots — expansion PURE des règles product_slot_rules correspondant au jour de
-- semaine de la date donnée (division entière tronquée sur la durée de créneau, même sémantique
-- que generateSlotPreview côté admin, apps/admin/lib/products/slotRules.ts — reliquat non multiple
-- de la durée simplement ignoré, pas rouvert ici). `stable`, PAS security definer (ne fait que
-- projeter une lecture déjà couverte par la policy select existante de product_slot_rules,
-- contrairement à une RPC d'écriture) — réutilisée à la fois par la lecture (get_product_slots) et
-- par la matérialisation de create_order, pour ne jamais dupliquer l'algorithme en deux endroits
-- (même raisonnement que resolve_date_price/resolve_tier_price, partagées).
--
-- Chevauchement exact de start_time entre deux règles du même produit (cas limite résiduel après
-- la validation de non-chevauchement ajoutée côté admin, apps/admin/lib/products/slotRules.ts) :
-- agrégé ici en MIN(capacity), défensif seulement (§10 point 1 de la spec) — jamais deux lignes
-- pour le même slot_start_time en sortie.
create or replace function expand_product_slots(p_product_id uuid, p_date date)
returns table(slot_start_time time, capacity int, slot_duration_minutes int)
language sql
stable
set search_path = ''
as $$
  select expanded.slot_start_time,
         min(expanded.capacity) as capacity,
         min(expanded.slot_duration_minutes) as slot_duration_minutes
    from (
      select (r.start_time + (gs * (r.slot_duration_minutes || ' minutes')::interval))::time
               as slot_start_time,
             r.capacity,
             r.slot_duration_minutes
        from public.product_slot_rules r
        cross join lateral generate_series(
          0,
          floor(extract(epoch from (r.end_time - r.start_time)) / (r.slot_duration_minutes * 60))::int - 1
        ) as gs
       where r.product_id = p_product_id
         and extract(isodow from p_date)::smallint = any(r.weekdays)
    ) expanded
   group by expanded.slot_start_time
$$;

grant execute on function expand_product_slots(uuid, date) to authenticated, anon;

-- get_product_slots — union entre créneaux "virtuels" dérivés des règles courantes ET lignes déjà
-- matérialisées dans product_slot_availability. Une ligne matérialisée fait TOUJOURS foi telle
-- quelle, jamais re-dérivée si les règles changent ensuite (sinon une réservation déjà prise sur
-- un créneau retiré du jeu de règles disparaîtrait de l'écran admin tout en restant réelle et
-- facturée, §10 point 3 de la spec) : FULL JOIN plutôt qu'un simple LEFT JOIN virtual->matérialisé,
-- pour que les lignes orphelines (matérialisées sans règle correspondante) restent visibles.
-- Signature en plage de dates (comme le fetch [aujourd'hui,+180j] déjà fait par ReservationForm.tsx
-- pour product_availability), pas un aller-retour par date.
create or replace function get_product_slots(p_product_id uuid, p_from date, p_to date)
returns table(
  slot_date date,
  slot_start_time time,
  capacity int,
  booked int,
  slot_duration_minutes int
)
language sql
stable
set search_path = ''
as $$
  with virtual as (
    select gs.slot_date::date as slot_date, v.slot_start_time, v.capacity, v.slot_duration_minutes
      from generate_series(p_from, p_to, interval '1 day') as gs(slot_date)
      cross join lateral public.expand_product_slots(p_product_id, gs.slot_date::date) as v
  ),
  materialized as (
    select slot_date, slot_start_time, capacity, booked, slot_duration_minutes
      from public.product_slot_availability
     where product_id = p_product_id
       and slot_date between p_from and p_to
  )
  select coalesce(m.slot_date, v.slot_date),
         coalesce(m.slot_start_time, v.slot_start_time),
         coalesce(m.capacity, v.capacity),
         coalesce(m.booked, 0),
         coalesce(m.slot_duration_minutes, v.slot_duration_minutes)
    from virtual v
    full join materialized m
      on m.slot_date = v.slot_date and m.slot_start_time = v.slot_start_time
   order by 1, 2
$$;

grant execute on function get_product_slots(uuid, date, date) to authenticated, anon;

-- set_product_slot_capacity — même patron exact que set_room_type_availability/
-- set_product_availability (admin+socio unifiés, garde below_booked), sans le contrôle "capacité
-- physique max" de set_room_type_availability (aucune notion de quantité physique posée pour un
-- produit à créneaux, contrairement à une chambre) : mirror du plus proche des deux, product_slot_
-- availability n'a pas de colonne "quantity" à comparer.
create or replace function set_product_slot_capacity(
  p_product_id uuid,
  p_date date,
  p_slot_start_time time,
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
  v_before_capacity int;
  v_before_booked int;
  v_slot_duration int;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  if not v_is_admin then
    v_partner_id := (select public.partner_id_for_account(v_account_id));
    select establishment_id into v_establishment_id
      from public.products where id = p_product_id;

    if v_establishment_id is null or not exists (
      select 1 from public.establishments
       where id = v_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'product_not_found');
    end if;

    if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  if p_capacity < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capacity');
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.product_slot_availability
   where product_id = p_product_id and slot_date = p_date and slot_start_time = p_slot_start_time
   for update;

  if found and p_capacity < v_before_booked then
    return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_before_booked);
  end if;

  if found then
    update public.product_slot_availability set capacity = p_capacity
     where product_id = p_product_id and slot_date = p_date and slot_start_time = p_slot_start_time;
  else
    -- Un slot_start_time qui ne correspond à AUCUN créneau réellement dérivé des règles courantes
    -- est refusé plutôt que d'inventer silencieusement une durée à 0 — l'écran admin
    -- (slot-availability-grid.tsx) n'appelle cette RPC que pour des créneaux déjà listés par
    -- get_product_slots, donc issus soit d'une règle courante, soit déjà matérialisés (branche
    -- "found" ci-dessus) : ce refus ne devrait jamais être atteint par l'écran réel.
    select slot_duration_minutes into v_slot_duration
      from public.expand_product_slots(p_product_id, p_date)
     where slot_start_time = p_slot_start_time;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    insert into public.product_slot_availability (
      product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
    )
    values (p_product_id, p_date, p_slot_start_time, v_slot_duration, p_capacity, 0);
  end if;

  -- Journalisation réservée aux écritures admin, même choix que set_product_availability (un socio
  -- qui gère sa propre disponibilité n'a pas besoin d'être audité comme un admin).
  if v_is_admin then
    perform public.log_admin_action(
      'product.set_slot_capacity', 'product_slot_availability', p_product_id,
      jsonb_build_object(
        'date', p_date, 'slot_start_time', p_slot_start_time,
        'capacity', v_before_capacity, 'booked', v_before_booked
      ),
      jsonb_build_object('date', p_date, 'slot_start_time', p_slot_start_time, 'capacity', p_capacity),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_product_slot_capacity(uuid, date, time, int, text) to authenticated;

-- create_order (dernière version : 20260818090000_product_default_capacity.sql) — AJOUT d'une 4e
-- branche de dispatch (créneau horaire, slot_start_time) à côté des 3 existantes (chambre, alojamiento
-- par plage, historique/date unique) ; tout le reste de la fonction reste au mot près identique.
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

      -- Nouveau (spec 18 Tranche 1) : ligne à créneau horaire — slot_start_time seul, jamais
      -- combiné à room_type_id ni end_date (§10 point 5, chaîne opaque "HH:MM:SS"). Non-coexistence
      -- stricte avec la branche date unique/default_capacity (§10 point 4) : un produit qui porte
      -- au moins une règle product_slot_rules ne peut JAMAIS être vendu "en gros" par date unique —
      -- sans cette garde serveur, default_capacity contournerait entièrement la vraie capacité par
      -- créneau d'un produit comme le jetski.
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

  -- Phase 2 (nouveau, spec 18 Tranche 1, avant verrouillage) : matérialise product_slot_availability
  -- depuis expand_product_slots pour toute ligne à créneau — même garde-fou de concurrence déjà
  -- justifié et testé pour default_capacity ci-dessus (on conflict do nothing, DOIT précéder la
  -- boucle de verrouillage). Un slot_start_time fourni par le client qui ne correspond à aucun
  -- créneau réellement généré par les règles courantes ne matérialise rien → rejet propre
  -- slot_not_found en Phase 3, jamais une confiance aveugle dans une valeur cliente.
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

  -- Phase 2c (Tranche 2) : verrouillage room_type_availability, chaque nuit de chaque ligne
  -- chambre — même ordre déterministe (entité, date), pas de croisement avec Phase 2/2b (tables
  -- disjointes, aucun risque d'ordre incohérent entre les trois boucles).
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

  -- Phase 2d (spec 18 Tranche 1, nouveau) : verrouillage product_slot_availability, une ligne par
  -- (product_id, slot_date, slot_start_time) — même ordre déterministe que les boucles précédentes,
  -- table disjointe des trois autres (aucun risque d'ordre incohérent).
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

      elsif v_line_slot_start_time is not null then
        -- Créneau horaire (spec 18 Tranche 1) : sellable au niveau produit + calendar_open au
        -- niveau JOUR (un jour fermé ferme tous ses créneaux, les deux granularités se cumulent,
        -- ne s'excluent pas — §10 point de la spec) + capacité du créneau précis dans
        -- product_slot_availability (déjà matérialisée en Phase 2 ci-dessus, jamais une confiance
        -- aveugle dans une valeur cliente qui ne matérialiserait rien).
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
        -- Branche existante (date unique, tous types dont camp) — logique inchangée ; seule la
        -- source de v_capacity/v_booked change (peut désormais provenir de la ligne matérialisée
        -- par défaut ci-dessus au lieu d'un slot_not_found systématique).
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
        -- Chambre d'hôtel par plage : prix nuit par nuit (resolve_date_price), qty = lits (dorm)
        -- ou chambres (private) selon product_room_types.kind (spec §10 point 3) — le décompte lui
        -- ne distingue pas les deux, room_type_availability.booked s'incrémente de qty telle
        -- quelle dans les deux cas (la distinction vit dans la capacité définie par
        -- set_room_type_availability, pas ici).
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

      elsif v_line_slot_start_time is not null then
        -- Créneau horaire (spec 18 Tranche 1) : prix résolu comme la branche historique (palier de
        -- quantité ou prix de base, aucune notion de prix "par nuit" ici), decrement sur
        -- product_slot_availability plutôt que product_availability.
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

        update public.product_slot_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;

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

-- modify_order_line (dernière version : 20260818090000) — AJOUT d'un refus explicite pour une
-- ligne à créneau horaire (hors périmètre Tranche 1, cf. spec 18 §2 Portée-Out), placé AVANT le
-- dispatch room_type_id/end_date existant : sans ce refus, une ligne à créneau (room_type_id et
-- end_date tous deux null, comme la branche historique) tomberait silencieusement dans la branche
-- "else" et corromprait product_availability au lieu de product_slot_availability. Signature
-- inchangée (5 paramètres), donc CREATE OR REPLACE suffit, aucun DROP requis.
create or replace function modify_order_line(
  p_order_line_id uuid,
  p_new_date date,
  p_new_qty int,
  p_reason text,
  p_new_end_date date default null
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
  -- RPC (hors périmètre explicite, spec 18 §2 Portée-Out) — même traitement que le camp aujourd'hui
  -- (raise exception nommée, "annuler puis recréer manuellement"), pas un trou silencieux.
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
    -- Branche existante (date unique, tous types dont camp) — AJOUT du fallback default_capacity
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
  end if;

  update public.pms_reconciliation_entries set order_line_id = v_new_line_id
   where order_line_id = p_order_line_id and status in ('open', 'retrying');

  -- Audit : avant/après enrichis d'un end_date UNIQUEMENT quand la ligne concernée en porte un —
  -- sinon jsonb_build_object(...) || '{}'::jsonb reste un no-op, la forme (2 puis 3 clés) des
  -- assertions pgTAP déjà écrites sur la branche historique (modify_order_line.test.sql) reste
  -- donc exactement celle attendue, aucune régression sur leur comparaison jsonb stricte.
  perform public.log_admin_action(
    'order_line.modify', 'order_lines', p_order_line_id,
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
