-- Spec 20 §0 — Agenda de réservations socio. Nouvelle RPC anti-survente : un operator (ou un
-- admin) ajoute une réservation manuelle (walk-in) directement depuis une case vide de l'agenda.
-- Squelette copié de docs/05-reference-technique.md §1 (SECURITY DEFINER, SET search_path='',
-- verrouillage explicite FOR UPDATE avant toute décision), mais volontairement plus étroite que
-- create_order : pas d'attribution référent, pas de calcul de commission (commission_case =
-- 'operator_manual', décision Jérôme 2026-08-18 : zéro commission app sur un walk-in), et exclut
-- 'hotel'/'lodging' (chambre/tarif par nuit hors périmètre) et 'camp' (ressource partagée
-- multi-jours provider_resource_calendar/availability_blocks, non répliquée ici — l'autoriser
-- silencieusement créerait un vrai trou anti-survente sur la ressource partagée).
--
-- Auth : admin+socio unifiés, même patron que set_product_slot_capacity (20260818100000) — un
-- operator scopé à SON établissement, un admin sans restriction. 'product_not_found' renvoyé aussi
-- bien pour un produit inexistant QUE pour un produit d'un autre établissement (jamais de fuite
-- d'existence à un operator non autorisé), même choix que set_product_slot_capacity.
alter table order_lines drop constraint order_lines_commission_case_check;
alter table order_lines add constraint order_lines_commission_case_check
  check (commission_case in ('external_referrer', 'self_referral', 'direct', 'operator_manual'));

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

  -- Correctif (constaté en prod locale, 2026-08-18) : products.price_tiers peut contenir le
  -- littéral JSON `null` (pas un vrai NULL SQL — 11 produits dans cette base) — `v_price_tiers is
  -- not null` reste VRAI dans ce cas (la variable jsonb elle-même n'est pas SQL-NULL), et
  -- jsonb_to_recordset('null'::jsonb) lève "cannot call jsonb_to_recordset on a non-array".
  -- Normalisé ici une fois pour toutes plutôt que de dupliquer un garde jsonb_typeof à chaque
  -- usage plus bas (3 occurrences dans cette fonction).
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

  -- Non-coexistence stricte créneau/date unique, même garde que create_order Phase 1 (spec 18) :
  -- un produit qui porte au moins une règle product_slot_rules ne peut jamais être vendu "en gros"
  -- par date unique.
  if p_slot_start_time is null and exists (
    select 1 from public.product_slot_rules where product_id = p_product_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot_required');
  end if;

  if p_slot_start_time is not null then
    ----------------------------------------------------------------------------------------------
    -- Branche créneau horaire (spec 18) --------------------------------------------------------
    ----------------------------------------------------------------------------------------------
    -- Matérialisation idempotente AVANT verrouillage, même garde-fou que create_order Phase 2
    -- (spec 18) : un slot_start_time qui ne correspond à aucun créneau réellement dérivé des
    -- règles courantes ne matérialise rien → rejet propre slot_not_found plus bas.
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

  -- Guest checkout (account_id null), même précédent déjà en place pour create_order
  -- (20260814090000) — un walk-in n'est structurellement l'achat d'aucune identité cliente
  -- enregistrée. Sentinelle email DÉDIÉE (orders.holder_email NOT NULL, 20260817190000),
  -- distincte de la sentinelle de backfill legacy 'sin-email-migrado@hifago.local' pour ne jamais
  -- confondre les deux origines dans un futur rapport.
  insert into public.orders (account_id, holder_name, holder_email, holder_phone, marketing_consent)
  values (null, p_holder_name, 'reserva-manual@hifago.local', p_holder_phone, false)
  returning id into v_order_id;

  -- commission_case = 'operator_manual' : referrer_pct/app_pct/acompte_pct = 0 (décision Jérôme,
  -- 2026-08-18) — un walk-in est présumé payé directement au partenaire, hors du flux de paiement
  -- de la plateforme, rien à faire remonter au ledger hifago.
  insert into public.order_lines (
    order_id, account_id, product_id, date, slot_start_time, qty, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    v_order_id, null, p_product_id, p_date, p_slot_start_time, p_qty, p_holder_name,
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
