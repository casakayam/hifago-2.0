-- Tranche 3 (disponibilité + anti-survente) — RPC critique reserve_order_line.
-- Squelette copié tel quel de hifago/docs/05-reference-technique.md §1 (verrouillage explicite
-- SELECT ... FOR UPDATE avant toute décision, security definer, search_path vide, un seul
-- aller-retour réseau) — <table_capacite> → product_availability, <table_log> → orders +
-- order_lines (le « log » de l'opération réussie est directement la commande elle-même, pas une
-- table générique en plus). Authentification requise : pas de réservation invité à ce stade
-- (même posture conservatrice que consume_partner_invitation, 0004) — hors périmètre non tranché,
-- pas décidé silencieusement ici.

create or replace function reserve_order_line(
  p_product_id uuid,
  p_date date,
  p_qty int,
  p_holder_name text,
  p_holder_email text default null,
  p_holder_phone text default null
)
returns jsonb
language plpgsql
security definer         -- obligatoire : contourne RLS explicitement pour cette RPC
set search_path = ''     -- obligatoire : jamais omis sur une fonction SECURITY DEFINER
as $$
declare
  v_account_id uuid := auth.uid();
  v_capacity int;
  v_booked int;
  v_order_id uuid;
  v_line_id uuid;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Verrouillage explicite : bloque toute autre transaction visant la même ligne
  -- jusqu'au commit/rollback de celle-ci. C'est CE verrou, pas une vérification
  -- applicative préalable, qui garantit l'invariant sous concurrence réelle.
  select capacity, booked
    into v_capacity, v_booked
    from public.product_availability
   where product_id = p_product_id
     and date = p_date
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  end if;

  if v_booked + p_qty > v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
  end if;

  update public.product_availability
     set booked = booked + p_qty
   where product_id = p_product_id
     and date = p_date;

  insert into public.orders (account_id, holder_name, holder_email, holder_phone)
  values (v_account_id, p_holder_name, p_holder_email, p_holder_phone)
  returning id into v_order_id;

  insert into public.order_lines (order_id, account_id, product_id, date, qty)
  values (v_order_id, v_account_id, p_product_id, p_date, p_qty)
  returning id into v_line_id;

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_line_id', v_line_id);
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. 20260813163456_identity_rls.sql) — accordé explicitement au seul rôle
-- authenticated (pas de réservation invité, cf. commentaire ci-dessus).
grant execute on function reserve_order_line(uuid, date, int, text, text, text) to authenticated;
