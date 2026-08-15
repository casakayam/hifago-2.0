-- Feature 7 — Client : appliquer un code partenaire à la commande (attribution).
--
-- Les trois colonnes orders.referrer_partner_id/attribution_code/attribution_source valent null
-- ensemble pour une commande « directe » (aucun référent) — jamais une valeur incohérente (code
-- posé sans referrer_partner_id, ou l'inverse) : la RPC ci-dessous applique cette règle, jamais un
-- check contraint côté schéma (la résolution dépend d'une lecture de partner_codes.active au
-- moment de l'écriture, pas exprimable en check constraint pur).
alter table orders add column referrer_partner_id uuid references partners(id);
alter table orders add column attribution_code text references partner_codes(code);
alter table orders add column attribution_source text
  check (attribution_source is null or attribution_source in ('qr', 'link', 'account'));

-- Préférence durable d'un compte enregistré (cahier des charges client §3c) — jamais pour un
-- invité, qui n'a pas de ligne partner_accounts.
alter table partner_accounts add column saved_attribution_code text references partner_codes(code);

-- 4e évolution de create_order (Tranche 3 → feature 6 → correctif réservation invité → ici) :
-- signature élargie de 2 paramètres, donc drop explicite de l'ancienne surcharge à 5 paramètres
-- avant de recréer — même raisonnement que le remplacement de reserve_order_line en feature 6
-- (create or replace seul ne suffit pas quand la liste de paramètres change, Postgres traiterait
-- ça comme une surcharge distincte plutôt qu'un remplacement, laissant une fonction morte mais
-- toujours appelable).
drop function if exists create_order(jsonb, text, text, text, boolean);

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
    update public.product_availability set booked = booked + (v_line->>'qty')::int
     where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
    insert into public.order_lines (order_id, account_id, product_id, date, qty)
    values (v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date, (v_line->>'qty')::int);
  end loop;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$$;

grant execute on function create_order(jsonb, text, text, text, boolean, text, text) to authenticated, anon;
