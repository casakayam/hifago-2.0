-- Feature 11 (Backend seul : snapshot de la commission 17/10/7 à la confirmation de commande).
--
-- Gap constaté en écrivant cette feature (pas un point à trancher, cahier des charges client §4
-- explicite) : order_lines ne portait AUCUN snapshot de prix — seulement product_id/date/qty, le
-- prix réel n'était lisible qu'en rejoignant products.price_cop au moment de la lecture, qui dérive
-- silencieusement dès qu'un prix est modifié après coup (feature 3 le permet déjà). « Chaque ligne
-- porte son propre snapshot de prix et de commission » — les deux, pas seulement la commission :
-- on ne peut de toute façon pas snapshoter une commission sans un montant stable pour la calculer.
--
-- not null direct, sans backfill : order_lines est vide à chaque db reset en dev, même
-- raisonnement que la contrainte price_cop > 0 de la feature 3.
alter table order_lines
  add column price_cop bigint not null,
  add column total_cop bigint not null,
  add column commission_case text not null
    check (commission_case in ('external_referrer', 'self_referral', 'direct')),
  add column acompte_pct numeric(5, 4) not null,
  add column referrer_pct numeric(5, 4) not null,
  add column app_pct numeric(5, 4) not null,
  add column acompte_cop bigint not null,
  add column referrer_commission_cop bigint not null,
  add column app_commission_cop bigint not null;

-- products.acompte_pct/products.referral_pct (Tranche 2, valeurs v1 historiques 0.15/0.10) ne sont
-- JAMAIS lues par ce nouveau moteur — le 17/10/7 est une règle fixe, pas configurable par produit.
-- Colonnes laissées telles quelles (pas supprimées : utilité potentielle pour une future migration
-- des commandes historiques de l'app actuelle, hors périmètre de ce chantier).

-- 5e évolution de create_order (Tranche 3 → feature 6 → correctif réservation invité → feature 7 →
-- ici). Signature INCHANGÉE (aucun nouveau paramètre) : create or replace seul suffit, pas de drop.
-- Le update product_availability et l'insert into order_lines de la feature 6 restent inchangés
-- dans leur forme d'origine — seules de nouvelles colonnes s'ajoutent au même insert.
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

  -- Phase 1 : plafonds.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select type into v_product_type from public.products where id = (v_line->>'product_id')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
    end if;
    if v_product_type = 'lodging' then
      v_lodging_lines := v_lodging_lines + 1;
      v_lodging_units := v_lodging_units + (v_line->>'qty')::int;
    else
      v_prestation_lines := v_prestation_lines + 1;
      if (v_line->>'qty')::int > 20 then
        return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
      end if;
    end if;
  end loop;
  if v_lodging_lines > 4 or v_lodging_units > 12 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 20 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  -- Phase 2 : verrouillage, ordre stable (product_id, date).
  for v_avail in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date
         from jsonb_array_elements(p_lines) elem
     )
     order by pa.product_id, pa.date
     for update
  loop
    null; -- verrouillage seul ; la validation par ligne suit contre le même état verrouillé
  end loop;

  -- Phase 3 : validation par ligne, aucune écriture.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    declare
      v_sellable boolean;
      v_calendar_open boolean;
      v_capacity int;
      v_booked int;
    begin
      select p.sellable, coalesce(pc.open, p.calendar_default_open)
        into v_sellable, v_calendar_open
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
    end;
  end loop;

  -- Résolution d'attribution : code présenté cette session > code sauvegardé du compte enregistré
  -- > direct. Purement une métadonnée à côté — ne touche jamais le verrouillage
  -- product_availability déjà passé aux phases 1-3 ci-dessus.
  if p_attribution_code is not null then
    v_attribution_code := p_attribution_code;
    v_attribution_source := p_attribution_source; -- 'qr' ou 'link', fourni par le front
  elsif v_account_id is not null then
    select saved_attribution_code into v_attribution_code
      from public.partner_accounts where id = v_account_id;
    v_attribution_source := 'account'; -- jamais pour un invité (pas de compte à lire)
  end if;

  if v_attribution_code is not null then
    select partner_id into v_referrer_partner_id
      from public.partner_codes
     where code = v_attribution_code and active = true;
  end if;

  if v_referrer_partner_id is null then
    -- code absent, invalide ou inactif : jamais un blocage de la commande (cahier des charges
    -- client §3c) — silencieusement « direct », rien à conserver comme attribution.
    v_attribution_code := null;
    v_attribution_source := null;
  end if;

  -- Persistance compte, uniquement si un code a été présenté CETTE session (jamais réécrire la
  -- préférence sauvegardée avec elle-même) : « le dernier code présenté prime » (cahier des
  -- charges client §3c).
  if v_account_id is not null and p_attribution_code is not null and v_referrer_partner_id is not null then
    update public.partner_accounts set saved_attribution_code = p_attribution_code
     where id = v_account_id;
  end if;

  -- Phase 4 : écriture, tout le panier a été validé. v_account_id (potentiellement null pour un
  -- invité) est écrit tel quel, comme n'importe quelle autre valeur — aucun traitement spécial.
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
      v_total_cop bigint;
      v_commission_case text;
      v_referrer_pct numeric(5, 4);
      v_app_pct numeric(5, 4);
      v_acompte_pct numeric(5, 4);
    begin
      -- Table de décision 17/10/7 : référent absent → direct, 0/17 ; référent = propriétaire de
      -- CETTE ligne → self_referral, 0/7 ; référent externe → external_referrer, 10/7. Résolue par
      -- ligne (pas une seule fois pour la commande) : un panier multi-établissement peut mélanger
      -- self_referral et external_referrer pour un même référent, selon le propriétaire de chaque
      -- produit — cf. plan feature 11 et son test dédié.
      select partner_id, price_cop into v_line_partner_id, v_line_price_cop
        from public.products where id = (v_line->>'product_id')::uuid;

      v_total_cop := v_line_price_cop * (v_line->>'qty')::int;

      if v_referrer_partner_id is null then
        v_commission_case := 'direct';        v_referrer_pct := 0;    v_app_pct := 0.17;
      elsif v_referrer_partner_id = v_line_partner_id then
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.07;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.10; v_app_pct := 0.07;
      end if;
      v_acompte_pct := v_referrer_pct + v_app_pct;

      update public.product_availability set booked = booked + (v_line->>'qty')::int
       where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
      insert into public.order_lines (
        order_id, account_id, product_id, date, qty,
        price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
        acompte_cop, referrer_commission_cop, app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date, (v_line->>'qty')::int,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      );
    end;
  end loop;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$$;

grant execute on function create_order(jsonb, text, text, text, boolean, text, text) to authenticated, anon;
