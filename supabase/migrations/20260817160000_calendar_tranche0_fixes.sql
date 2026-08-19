-- Spec 17 (Calendrier/disponibilité, Tranche 0 — correctifs immédiats), docs/specs/17-calendrier-
-- disponibilite-refonte.md §0. Trois correctifs indépendants, aucune nouvelle table.
--
-- 1. Garde-fou price_cop is null dans create_order — bug confirmé, chaîne d'atteinte retracée dans
--    la spec §1 : un produit type='hotel' (price_cop nullable par contrainte, le prix vit sur ses
--    chambres) n'est PAS exclu du ReservationForm générique côté apps/web (contrairement à
--    'evento', déjà exclu). Sans prix, order_lines.price_cop (bigint not null) plante sur une
--    exception Postgres brute au lieu d'un refus métier propre. Placé en PHASE 3 (validation, zéro
--    écriture) et non en Phase 4 comme le brouillon initial de la spec le suggérait sans préciser
--    la phase : un `return` en Phase 4 ne fait PAS rollback des écritures déjà faites plus tôt dans
--    le même appel de fonction (insert `orders` en tête de Phase 4, éventuelles lignes déjà
--    traitées avant celle en défaut dans la boucle) — l'invariant de cette RPC est que Phase 3
--    valide tout AVANT toute écriture, Phase 4 ne fait plus jamais échouer une ligne. Corrigé ici
--    en respectant cet invariant plutôt qu'en le contournant.
--
-- 2. Type 'tour' retiré du CHECK products_type_check — confirmé zéro ligne en base (vérifié avant
--    cette migration) et zéro chemin de création dans product-form.tsx (seuls les 6 types annoncés
--    sont proposables) : vestige jamais nettoyé après l'introduction des 6 types réels.
--
-- 3. Colonne product_calendar.closed_slot droppée — confirmée morte (zéro ligne non-null en base,
--    zéro lecture/écriture dans le code applicatif, cf. grep exhaustif spec 17 §1). schedule='slot'
--    (products.schedule) N'EST PAS touché ici : sa coexistence avec product_slot_rules est un point
--    ouvert explicite renvoyé à la Tranche 3 (spec 17 §10) — trancher cette décision en même temps
--    que ce nettoyage mécanique aurait mélangé un correctif sûr avec un choix d'architecture non
--    encore validé par Jérôme.

-- 1. Garde-fou price_missing dans create_order (Phase 3 : validation, avant toute écriture).
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

  -- Phase 1 : plafonds (AUCUN verrou pris).
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers
      into v_product_type, v_min_qty, v_max_qty, v_price_tiers
      from public.products where id = (v_line->>'product_id')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
    end if;
    if v_product_type = 'lodging' then
      v_lodging_lines := v_lodging_lines + 1;
      v_lodging_units := v_lodging_units + (v_line->>'qty')::int;
    else
      v_prestation_lines := v_prestation_lines + 1;
      if (v_line->>'qty')::int < v_min_qty then
        return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
      end if;
      if (v_line->>'qty')::int > v_max_qty then
        return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
      end if;
      if v_price_tiers is not null and not exists (
        select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
         where (v_line->>'qty')::int between t.min_qty and t.max_qty
      ) then
        return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
      end if;
    end if;
  end loop;
  if v_lodging_lines > 4 or v_lodging_units > 12 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 20 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  -- Phase 2 : verrouillage, ordre stable (product_id, date), toutes ressources en une requête.
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
    null;
  end loop;

  -- Phase 2b (feature 20) : verrouillage de la ressource partagée, camps uniquement.
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
    begin
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

      -- Garde-fou (1 ci-dessus) : aucun palier ET aucun prix de base -> refus métier explicite,
      -- jamais une insertion order_lines qui plante sur sa contrainte NOT NULL price_cop. Un
      -- produit avec price_tiers défini a déjà été confirmé couvert par un palier en Phase 1
      -- (no_matching_tier), donc price_cop null est sans risque dans ce cas — seul le cas
      -- price_tiers is null et price_cop is null (ex. hotel sans prix propre saisi) est visé ici.
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

  -- Phase 4 : écriture, tout le panier a été validé — plus aucune branche de refus ici (inchangé).
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
    begin
      select partner_id, price_cop, price_tiers, type, establishment_id, duration_days
        into v_line_partner_id, v_line_price_cop, v_line_price_tiers, v_line_type,
             v_line_establishment_id, v_line_duration_days
        from public.products where id = (v_line->>'product_id')::uuid;

      if v_line_price_tiers is not null then
        select t.price_cop into v_line_price_cop
          from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
         where (v_line->>'qty')::int between t.min_qty and t.max_qty
         limit 1;
      end if;

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
        order_id, account_id, product_id, date, qty, referrer_partner_id,
        price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
        acompte_cop, referrer_commission_cop, app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date, (v_line->>'qty')::int,
        v_referrer_partner_id,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      if v_line_type = 'camp' then
        update public.provider_resource_calendar
           set booked = booked + (v_line->>'qty')::int
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

-- 2. 'tour' retiré : zéro ligne en base au moment de cette migration (vérifié), zéro chemin de
-- création. Contrainte réécrite en entier (Postgres n'a pas d'ALTER CONSTRAINT partiel sur un
-- CHECK), même patron que les migrations précédentes qui l'ont étendue.
alter table products
  drop constraint products_type_check,
  add constraint products_type_check
    check (type in ('lodging', 'activity', 'transport', 'camp', 'evento', 'hotel'));

-- 3. closed_slot : colonne confirmée morte (zéro ligne non-null, zéro usage applicatif).
alter table product_calendar drop column closed_slot;
