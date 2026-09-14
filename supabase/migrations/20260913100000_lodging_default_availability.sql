-- Décision Jérôme (2026-09-13) — INVERSE la polarité du calendrier pour les chambres/alojamiento
-- (`type='lodging'`) : au lieu de "fermé par défaut, le partenaire ouvre" (docs/01-cahier-des-
-- charges-client.md §3d, validé le 2026-08-11 puis le 2026-08-13, motivé par le risque de survente
-- sur une nuit déjà prise hors du système), devient "ouvert par défaut, le partenaire vient marquer
-- les jours déjà pris". Déclencheur : une chambre fraîchement créée n'affichait AUCUNE date
-- réservable sur sa fiche publique — attendu pour `camp`/`evento` (non concernés, §3d inchangée
-- pour eux), pas voulu pour une chambre.
--
-- ⚠️ NE TOUCHE PAS create_order NI create_manual_order_line — la RPC anti-survente la plus
-- critique du dépôt (hifago/CLAUDE.md §4), déjà écrite, testée, couverte par des tests de
-- concurrence réels sur son chemin lodging (nuits/verrouillage/décrément). "Ouvert par défaut" est
-- obtenu en MATÉRIALISANT de vraies lignes `product_availability` à l'avance (à la création, puis
-- une fenêtre glissante via cron) — create_order continue de lire des lignes réelles exactement
-- comme avant, aucune régression possible sur son invariant.
--
-- Pourquoi ceci n'a PAS besoin du squelette anti-survente (FOR UPDATE + test de concurrence,
-- CLAUDE.md §4.3) : les inserts ci-dessous sont `ON CONFLICT (product_id, date) DO NOTHING` — jamais
-- de décrément, jamais d'écrasement d'une ligne existante (donc jamais d'écrasement d'un override
-- posé par le partenaire via set_product_availability). Deux exécutions concurrentes se résolvent
-- par la contrainte UNIQUE elle-même ; aucun verrou explicite n'est nécessaire.
--
-- Le geste "marquer un jour déjà pris" reste l'écran partenaire existant
-- (/partner/products/[id]/availability) et la RPC déjà en place set_product_availability
-- (p_open=false ou p_capacity réduite) — aucun changement ici, aucune nouvelle RPC côté fermeture.

-- ============================================================================================
-- 1. resolve_lodging_default_capacity — combien de nuitées cette chambre vend par défaut.
-- ============================================================================================
-- Réutilise EXACTEMENT la formule déjà écrite pour le garde-fou physique de
-- set_product_availability (supabase/migrations/20260827250000_capacity_guard_arms_without_
-- lodging_kind.sql) : un dortoir se vend AU LIT (unit_count × capacity, capacity = lits par
-- exemplaire), une chambre privée ou une maison entière se vend À L'UNITÉ (unit_count seul).
-- ⚠️ Piège à ne pas refaire : pour une chambre privée, ce n'est PAS `capacity` (occupants) — une
-- chambre 2 personnes reste réservable UNE fois par nuit, pas deux, quel que soit le nombre
-- d'occupants (cohérent avec unit='per_two'/'per_house', dont le prix ne dépend déjà pas de qty).
-- `unit_count` par défaut à 1 : une chambre = un produit, pas une "chambre type" à plusieurs
-- exemplaires (product_room_types supprimée, spec 24).
create or replace function public.resolve_lodging_default_capacity(
  p_lodging_kind text,
  p_unit_count int,
  p_capacity int
)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_lodging_kind = 'dorm' then coalesce(p_unit_count, 1) * p_capacity
    else coalesce(p_unit_count, 1)
  end;
$$;

-- ============================================================================================
-- 2. open_default_lodging_availability — matérialise la fenêtre glissante pour UN produit.
-- ============================================================================================
-- Horizon = 6 mois, MÊME VALEUR que RESERVATION_HORIZON_MONTHS
-- (packages/domain/src/products/reservationHorizon.ts) — ce fichier documente lui-même un incident
-- passé de 3 horizons divergents dans le dépôt (trois définitions qui ouvraient/fermaient une nuit
-- différemment) : ne pas en recréer un 4ᵉ ici, changer les deux ensemble si l'horizon bouge un jour.
--
-- `security definer` + `revoke` explicite (jamais exposée à anon/authenticated — piège documenté
-- dans .claude/rules/supabase.md : une fonction neuve est EXECUTE-able par PUBLIC tant qu'un revoke
-- ne le referme pas). Appelée uniquement en interne : par create_product_from_proposal (à la
-- création) et par roll_lodging_availability_window (cron quotidien, ci-dessous) — un appel interne
-- depuis une fonction security definer s'exécute dans le contexte de SON propriétaire, le revoke
-- ci-dessous ne bloque donc pas ces deux appelants.
create or replace function public.open_default_lodging_availability(
  p_product_id uuid,
  p_horizon interval default '6 months'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_availability (product_id, date, capacity, booked)
  select p.id, d::date, p.default_capacity, 0
    from public.products p
    cross join generate_series(current_date, current_date + p_horizon, interval '1 day') as d
   where p.id = p_product_id
     and p.default_capacity is not null
  on conflict (product_id, date) do nothing;
end;
$$;

revoke all on function public.open_default_lodging_availability(uuid, interval) from public, anon, authenticated;

-- ============================================================================================
-- 3. create_product_from_proposal — calcule default_capacity pour lodging, ouvre la fenêtre
--    immédiatement à la création. Signature INCHANGÉE (create or replace suffit, cf. piège #7
--    .claude/rules/supabase.md — un changement de liste de paramètres exigerait un drop d'abord).
-- ============================================================================================
create or replace function public.create_product_from_proposal(p_partner_id uuid, p_establishment_id uuid, p_type text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_slug_base text;
  v_slug text;
  v_suffix int := 1;
  v_tag_id text;
  v_slot jsonb;
  v_photo jsonb;
  v_sort int;
  v_default_capacity int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_product_from_proposal réservé au rôle admin' using errcode = '42501';
  end if;

  v_slug_base := public.slugify(coalesce(p_payload -> 'name' ->> 'es', 'producto'));
  if v_slug_base = '' then
    v_slug_base := 'producto';
  end if;
  v_slug := v_slug_base;
  while exists (select 1 from public.products where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  v_default_capacity := nullif(p_payload ->> 'default_capacity', '')::int;
  if p_type = 'lodging' and v_default_capacity is null then
    v_default_capacity := public.resolve_lodging_default_capacity(
      nullif(p_payload ->> 'lodging_kind', ''),
      nullif(p_payload ->> 'unit_count', '')::int,
      nullif(p_payload ->> 'capacity', '')::int
    );
  end if;

  insert into public.products (
    partner_id, establishment_id, type, name, description, slug, sellable,
    price_cop, price_tiers, min_qty, max_qty,
    address, lat, lon,
    check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates,
    duration_days,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url,
    lobby_category_id, lobby_product_id
  )
  values (
    p_partner_id, p_establishment_id, p_type,
    p_payload -> 'name', p_payload -> 'description', v_slug,
    true,
    nullif(p_payload ->> 'price_cop', '')::bigint,
    p_payload -> 'price_tiers',
    nullif(p_payload ->> 'min_qty', '')::int,
    nullif(p_payload ->> 'max_qty', '')::int,
    p_payload ->> 'address',
    nullif(p_payload ->> 'lat', '')::double precision,
    nullif(p_payload ->> 'lon', '')::double precision,
    nullif(p_payload ->> 'check_in_time', '')::time,
    nullif(p_payload ->> 'check_out_time', '')::time,
    nullif(p_payload ->> 'capacity', '')::int,
    nullif(p_payload ->> 'unit_count', '')::int,
    nullif(p_payload ->> 'lodging_kind', ''),
    nullif(p_payload ->> 'unit', ''),
    v_default_capacity,
    p_payload -> 'stay_rates',
    nullif(p_payload ->> 'duration_days', '')::int,
    p_payload ->> 'price_label',
    p_payload ->> 'occurrence_type',
    nullif(p_payload ->> 'occurrence_date', '')::date,
    nullif(p_payload ->> 'recurrence_frequency_days', '')::int,
    nullif(p_payload ->> 'recurrence_end_date', '')::date,
    nullif(p_payload ->> 'recurrence_end_count', '')::int,
    nullif(p_payload ->> 'start_time', '')::time,
    nullif(p_payload ->> 'duration_minutes', '')::int,
    nullif(p_payload ->> 'external_booking_url', ''),
    nullif(p_payload ->> 'lobby_category_id', '')::int,
    nullif(p_payload ->> 'lobby_product_id', '')::int
  )
  returning id into v_product_id;

  if jsonb_typeof(p_payload -> 'tag_ids') = 'array' then
    for v_tag_id in select * from jsonb_array_elements_text(p_payload -> 'tag_ids') loop
      insert into public.product_tag_assignments (product_id, tag_id) values (v_product_id, v_tag_id::uuid);
    end loop;
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' then
    v_sort := 0;
    for v_photo in select * from jsonb_array_elements(p_payload -> 'photos') loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_product_id, v_photo ->> 'storage_path', v_sort);
      v_sort := v_sort + 1;
    end loop;
  end if;

  if p_type = 'activity' and jsonb_typeof(p_payload -> 'slot_rules') = 'array' then
    for v_slot in select * from jsonb_array_elements(p_payload -> 'slot_rules') loop
      insert into public.product_slot_rules
        (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
      values (
        v_product_id,
        (select array_agg((w)::int order by (w)::int) from jsonb_array_elements_text(v_slot -> 'weekdays') w),
        (v_slot ->> 'start_time')::time,
        (v_slot ->> 'end_time')::time,
        (v_slot ->> 'slot_duration_minutes')::int,
        (v_slot ->> 'capacity')::int
      );
    end loop;
  end if;

  if p_type = 'lodging' and v_default_capacity is not null then
    perform public.open_default_lodging_availability(v_product_id);
  end if;

  perform public.log_admin_action(
    'product_proposal.approve_create', 'products', v_product_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'establishment_id', p_establishment_id, 'type', p_type),
    null
  );

  return v_product_id;
end;
$$;

-- ============================================================================================
-- 4. roll_lodging_availability_window — fait avancer la fenêtre glissante chaque jour.
-- ============================================================================================
-- Sans ce cron, la fenêtre ouverte à la création se fige à cette date et s'épuiserait 6 mois plus
-- tard (plus aucune nuit ouverte au-delà). Même patron que expire_stale_payment_orders
-- (supabase/migrations/20260818230000_expire_stale_payment_orders_job.sql) : fonction SQL directe,
-- aucun pg_net/Edge Function nécessaire (pas d'appel réseau, tout se passe en base).
create or replace function public.roll_lodging_availability_window()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
begin
  for v_product in select id from public.products where type = 'lodging' and default_capacity is not null loop
    perform public.open_default_lodging_availability(v_product.id);
  end loop;
end;
$$;

revoke all on function public.roll_lodging_availability_window() from public, anon, authenticated;

select cron.schedule('roll-lodging-availability', '0 8 * * *', $$select roll_lodging_availability_window();$$);
