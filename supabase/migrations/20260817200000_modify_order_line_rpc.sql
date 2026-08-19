-- Spec 17 §0 Tranche 1 (docs/specs/17-calendrier-disponibilite-refonte.md) — modifier une
-- réservation existante (date/quantité), cible jamais construite ni en v1 ni en v2. Décisions
-- produit tranchées le 2026-08-17 (§10 points 1/2) avant d'écrire cette migration :
--
-- 1. Neutre en capacité — contrairement à cancel_order (qui ne libère jamais rien, décision
--    volontaire distincte, cf. 20260814161500_cancel_order_rpc.sql), une modification libère
--    l'ancien créneau ET consomme le nouveau, dans la même transaction.
-- 2. Une entrée pms_reconciliation_entries ouverte/en retry sur l'ancienne ligne est transférée
--    vers la nouvelle (historique de tentatives conservé), jamais close automatiquement.
--
-- Jamais un écrasement en place (00-modele-de-donnees.md §5) : l'ancienne ligne passe
-- status='superseded' (nouvelle valeur ajoutée au CHECK), une nouvelle ligne est insérée avec
-- replaces_order_line_id — historique et snapshots financiers d'origine intacts.
--
-- Admin-only (même famille que set_order_line_status, écran /admin/orders, jamais socio) — style
-- raise exception pour TOUTE garde/refus, y compris la capacité pleine : un seul appelant
-- prévisible (l'admin), pas de course publique à gérer avec des refus "normaux" comme create_order.
--
-- Portée v1 explicite (spec 17 §0 Tranche 1, point 4) : raisonne uniquement sur
-- product_availability (date unique + qty) — couvre déjà activity/transport/lodging/hotel(produit,
-- pas encore ses chambres). Exclut explicitement 'camp' (ressource partagée multi-jours,
-- verrouillage différent) plutôt que de le mal gérer en silence. Réécriture prévue en Tranche 2
-- pour devenir polymorphe (room_type_availability).

alter table order_lines
  drop constraint order_lines_status_check,
  add constraint order_lines_status_check check (
    status in ('reserved', 'fulfilled', 'no_show', 'cancelled_by_client',
               'cancelled_by_provider', 'expired', 'superseded')
  ),
  add column replaces_order_line_id uuid references order_lines(id);

create or replace function modify_order_line(
  p_order_line_id uuid,
  p_new_date date,
  p_new_qty int,
  p_reason text
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
    raise exception 'seule une ligne au statut reserved peut être modifiée (statut actuel : %)',
      v_old_line.status;
  end if;

  select type, min_qty, max_qty, price_tiers into v_product
    from public.products where id = v_old_line.product_id;

  if v_product.type = 'camp' then
    raise exception 'modify_order_line ne gère pas encore les camps (ressource partagée multi-jours) — annuler puis recréer manuellement';
  end if;
  if p_new_qty < coalesce(v_product.min_qty, 1) or p_new_qty > coalesce(v_product.max_qty, 20) then
    raise exception 'quantité % hors bornes [%, %] pour ce produit',
      p_new_qty, coalesce(v_product.min_qty, 1), coalesce(v_product.max_qty, 20);
  end if;

  v_same_slot := (v_old_line.date = p_new_date);

  -- Verrouillage déterministe (order by date) des 1 ou 2 lignes product_availability concernées —
  -- même discipline que create_order Phase 2, avant toute lecture de décision ou écriture.
  for v_lock_row in
    select product_id, date from public.product_availability
     where product_id = v_old_line.product_id and date in (v_old_line.date, p_new_date)
     order by date
     for update
  loop
    null;
  end loop;

  select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
    from public.products p
    left join public.product_calendar pc on pc.product_id = p.id and pc.date = p_new_date
   where p.id = v_old_line.product_id;
  if not v_calendar_open then
    raise exception 'date cible fermée pour ce produit';
  end if;

  select capacity, booked into v_capacity, v_booked
    from public.product_availability
   where product_id = v_old_line.product_id and date = p_new_date;
  if not found then
    raise exception 'aucune disponibilité définie pour la date cible';
  end if;

  -- Arithmétique correcte (spec 17 §0 Tranche 1, point 1) : si même date/produit, l'ancienne
  -- quantité est déjà comptée dans booked — la soustraire avant de tester, jamais ajouter la
  -- nouvelle qty par-dessus telle quelle (double-compterait la réservation existante).
  v_effective_booked := v_booked - (case when v_same_slot then v_old_line.qty else 0 end);
  if v_effective_booked + p_new_qty > v_capacity then
    raise exception 'capacité insuffisante à la date cible (% déjà réservé(s) sur %)',
      v_effective_booked, v_capacity;
  end if;

  -- Prix : re-résolu par palier si price_tiers défini (la nouvelle quantité peut changer de
  -- tranche), sinon price_cop de la ligne d'origine inchangé.
  v_new_price_cop := v_old_line.price_cop;
  if v_product.price_tiers is not null then
    select t.price_cop into v_new_price_cop
      from jsonb_to_recordset(v_product.price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
     where p_new_qty between t.min_qty and t.max_qty
     limit 1;
    if v_new_price_cop is null then
      raise exception 'aucun palier de prix ne couvre la quantité %', p_new_qty;
    end if;
  end if;
  v_new_total_cop := v_new_price_cop * p_new_qty;

  -- Écriture : libère l'ancien créneau puis consomme le nouveau — les deux UPDATE s'additionnent
  -- correctement sur la même ligne product_availability si same_slot (booked - old_qty + new_qty),
  -- pas besoin de cas particulier.
  update public.product_availability set booked = booked - v_old_line.qty
   where product_id = v_old_line.product_id and date = v_old_line.date;
  update public.product_availability set booked = booked + p_new_qty
   where product_id = v_old_line.product_id and date = p_new_date;

  update public.order_lines set status = 'superseded' where id = p_order_line_id;

  insert into public.order_lines (
    order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
    replaces_order_line_id,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_qty,
    'reserved', v_old_line.referrer_partner_id, v_old_line.holder_name, p_order_line_id,
    v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
    v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
    round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
    round(v_new_total_cop * v_old_line.app_pct)
  ) returning id into v_new_line_id;

  -- Transfert de l'entrée de réconciliation PMS ouverte/en retry, historique conservé (spec 17
  -- §10 point 2) — jamais close automatiquement, jamais laissée orpheline.
  update public.pms_reconciliation_entries
     set order_line_id = v_new_line_id
   where order_line_id = p_order_line_id
     and status in ('open', 'retrying');

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
