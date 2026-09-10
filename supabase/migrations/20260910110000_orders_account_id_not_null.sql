-- Spec 31 (Tranche 2) — orders.account_id / order_lines.account_id deviennent NOT NULL.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE MIGRATION EXISTE, ET CE QU'ELLE REFERME
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Décision de Jérôme (2026-09-09, entretien spec « identité anonyme ») ⑤ : une identité anonyme
-- EST un compte, « juste sans mot de passe » — toute commande en porte désormais un. Elle referme
-- le dernier trou de create_payment_intent (20260909190000) : une commande invité, jusqu'ici sans
-- propriétaire, restait payable par quiconque connaissait son order_id. Avec NOT NULL, ce cas ne
-- peut plus exister — la garde de create_payment_intent devient suffisante d'elle-même, aucune
-- ligne n'y est modifiée ici.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LE BACKFILL — POURQUOI CE N'EST PAS UN SIMPLE `alter column ... set not null`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Deux natures de lignes `account_id null` peuvent exister à ce point :
--   1. de VRAIES réservations comptoir (create_manual_order_line, holder_email = sentinelle
--      'reserva-manual@hifago.local') — invariant 8, déjà tranché : le compte technique fixe.
--   2. des commandes INVITÉ WEB antérieures à la Tranche 1 (n'importe quel autre holder_email) —
--      account_id null pour une raison DIFFÉRENTE (aucune identité n'existait encore, pas "prise
--      au comptoir"). Décision de Jérôme (2026-09-10, question posée explicitement) : LE MÊME
--      compte technique absorbe aussi ce cas plutôt qu'un second compte dédié — mesuré comme un
--      coût nul en pratique (aucune donnée réelle n'existe : hifago/CLAUDE.md §7.3, préprod
--      100 % synthétique). Un futur audit qui verrait ce compte porter des lignes qui ne sont
--      PAS des réservations comptoir doit lire CE commentaire avant de s'en étonner.
--
-- ⚠️ PRÉREQUIS OPÉRATIONNEL — le compte technique DOIT déjà exister dans auth.users avant que
-- cette migration s'applique sur un environnement portant des données préexistantes (jamais un
-- souci sur un `db reset` frais : 0 ligne account_id null à cet instant, donc le backfill est un
-- no-op et ne référence jamais le compte avant sa création par `seed_auth_users.mjs`, qui tourne
-- APRÈS les migrations dans `scripts/db-setup.sh`). `insert into auth.users` direct est refusé sur
-- Supabase Cloud (permission denied for schema auth, constaté 2026-08-21) — le compte se crée par
-- l'API Admin (`supabase/scripts/seed_auth_users.mjs`, entrée `COMPTE_TECHNIQUE_RESA_MANUELLE`),
-- JAMAIS par un insert SQL direct dans cette migration.

update public.orders set account_id = 'e0000000-0000-4000-8000-000000000001'
 where account_id is null;

update public.order_lines set account_id = 'e0000000-0000-4000-8000-000000000001'
 where account_id is null;

alter table public.orders alter column account_id set not null;
alter table public.order_lines alter column account_id set not null;

comment on column public.orders.account_id is
  'NOT NULL depuis le 2026-09-10 (spec 31) : toute commande appartient à une identité Supabase, '
  'anonyme ou réelle — plus jamais null. Une réservation prise au comptoir (create_manual_order_line) '
  'porte le compte technique fixe e0000000-0000-4000-8000-000000000001.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- create_manual_order_line : écrit désormais le compte technique au lieu de null (invariant 8).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Spec 31 (Tranche 2) — orders.account_id/order_lines.account_id passent NOT NULL, et
-- create_manual_order_line écrit le compte technique fixe au lieu de null (invariant 8).
-- Repris de pg_get_functiondef sur la base locale ; seules les lignes commentées « 2026-09-10 »
-- diffèrent (deux occurrences : insert orders, insert order_lines).

CREATE OR REPLACE FUNCTION public.create_manual_order_line(p_product_id uuid, p_date date, p_qty integer, p_holder_name text, p_slot_start_time time without time zone DEFAULT NULL::time without time zone, p_holder_phone text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_product_type in ('lodging', 'camp') then
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

  -- 2026-09-10 (spec 31, Tranche 2) — le compte technique fixe remplace `null` : orders.account_id
  -- est désormais NOT NULL. C'EST ce même compte, invariant 8 de la spec.
  insert into public.orders (account_id, holder_name, holder_email, holder_phone, marketing_consent)
  values ('e0000000-0000-4000-8000-000000000001', p_holder_name, 'reserva-manual@hifago.local',
          p_holder_phone, false)
  returning id into v_order_id;

  insert into public.order_lines (
    order_id, account_id, product_id, date, slot_start_time, qty, holder_name,
    holder_phone, holder_email,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    v_order_id, 'e0000000-0000-4000-8000-000000000001', p_product_id, p_date, p_slot_start_time,
    p_qty, p_holder_name, p_holder_phone, 'reserva-manual@hifago.local',
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
$function$;
