-- Spec 20 §0 — Agenda de réservations socio. Élargit deux RPC déjà existantes pour que l'operator
-- puisse gérer une réservation directement depuis la fiche ouverte au clic sur un événement de
-- l'agenda (annuler, modifier la date), au-delà du seul no_show déjà autorisé (spec 19 Tranche 0).
-- Chokepoint partagé avec l'admin (AGENTS-PARALLELES.md point 6) : signalé, pas juste modifié en
-- silence — l'autorisation métier de chaque transition reste entièrement revérifiée dans la
-- fonction, aucune régression du contrôle d'accès admin existant.

-- set_order_line_status (dernière version : 20260818150000) — AJOUT de 'cancelled_by_provider' aux
-- transitions qu'un operator peut déclencher lui-même sur son propre établissement (avant : no_show
-- seul). Signature inchangée (3 paramètres), CREATE OR REPLACE suffit. Le reste de la fonction
-- (garde reason, garde statut cible valide, verrouillage, garde "avant = reserved", écriture ledger
-- par transition, audit) est repris au mot près — seule la liste des statuts autorisés hors admin
-- change.
create or replace function set_order_line_status(
  p_order_line_id uuid,
  p_new_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_status text;
  v_is_admin boolean;
  v_establishment_id uuid;
begin
  v_is_admin := (select public.is_admin(auth.uid()));

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour une transition manuelle';
  end if;

  if p_new_status not in ('fulfilled', 'no_show', 'cancelled_by_client',
                           'cancelled_by_provider', 'expired') then
    raise exception 'statut cible invalide : %', p_new_status;
  end if;

  select ol.status, p.establishment_id
    into v_before_status, v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id
   for update of ol;

  if not found then
    raise exception 'ligne de commande introuvable';
  end if;

  if not v_is_admin then
    if p_new_status not in ('no_show', 'cancelled_by_provider')
       or not (select public.has_capability(auth.uid(), 'operator', v_establishment_id)) then
      raise exception
        'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show/cancelled_by_provider uniquement)'
        using errcode = '42501';
    end if;
  end if;

  if v_before_status <> 'reserved' then
    raise exception 'transition refusée : la ligne n''est plus reserved (statut actuel : %)', v_before_status;
  end if;

  update public.order_lines set status = p_new_status where id = p_order_line_id;

  -- Transition ledger factorisée (apply_order_line_ledger_transition, 20260818150000) — même effet
  -- que l'ancien CASE inline, partagé désormais avec expire_stale_payment_orders_job.
  perform public.apply_order_line_ledger_transition(array[p_order_line_id], p_new_status);

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    (select auth.uid()), 'order_line.set_status', 'order_lines', p_order_line_id,
    jsonb_build_object('status', v_before_status), jsonb_build_object('status', p_new_status), p_reason
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_order_line_status(uuid, text, text) to authenticated;

-- modify_order_line (dernière version : 20260818100000) — DEUX changements :
--
-- 1. Élargissement d'autorisation : admin OU operator du même établissement que le produit de la
--    ligne (avant : admin-only strict). La garde d'origine s'exécutait AVANT le verrouillage de la
--    ligne (elle n'avait besoin que de auth.uid()) ; la nouvelle garde a besoin de
--    products.establishment_id, donc elle est déplacée APRÈS le `select ... for update` (qui
--    embarque désormais un join products pour le récupérer), exactement le même ordre que
--    set_order_line_status ci-dessus. `for update of ol` gardé explicite pour ne verrouiller QUE
--    order_lines, jamais products (même granularité de verrou qu'avant le join).
--
-- 2. Fix chokepoint : l'appel `perform log_admin_action(...)` en fin de fonction est lui-même
--    is_admin-gated en interne (20260813201000) — un appel operator légitime (point 1) lèverait son
--    exception et annulerait TOUTE la transaction, y compris la modification qu'on vient
--    d'autoriser. Remplacé par un insert direct dans audit_log, même patron déjà en place dans
--    set_order_line_status (20260818150000) pour exactement la même raison — l'autorisation métier
--    reste entièrement vérifiée juste avant dans cette fonction-ci, l'insert direct ne réintroduit
--    aucun trou de contrôle. jsonb before/after inchangé au mot près (mêmes clés, même contenu),
--    aucune régression attendue sur une assertion pgTAP existante qui comparerait ce contenu.
--
-- Le reste de la fonction (3 branches chambre/alojamiento/date-unique, exclusion créneau horaire,
-- verrouillage déterministe, recalcul de prix, remplacement de ligne) est repris au mot près.
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

  -- Audit : insert direct (fix chokepoint, cf. entête) — avant/après enrichis d'un end_date
  -- UNIQUEMENT quand la ligne concernée en porte un, comme avant.
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
