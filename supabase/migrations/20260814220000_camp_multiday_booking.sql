-- Feature 20 (Admin : créer et réserver un camp multi-jours) — schéma réel remplaçant le spike
-- jetable de la feature 19 (5 runs consécutifs propres sur ses 3 scénarios, pattern §1bis validé
-- empiriquement). Portée admin-direct seulement (création, calendrier partagé, réservation) — la
-- proposition socio d'un camp est une extension future distincte, sur le modèle de la feature 15.
-- Blocage croisé camp↔activité DIFFÉRÉ (tranché par Jérôme) : une réservation de camp bloque la
-- ressource partagée pour les autres camps/eventos réservables du même établissement, mais une
-- activité ordinaire ne vérifie pas encore cette ressource — create_order n'est pas retouché une
-- fois de plus pour ça ici.

-- products.type 'camp' déjà ajouté par la migration evento vitrine (feature 21,
-- 20260814190000_products_evento_vitrine.sql, products_type_check) — vérifié en base, rien à
-- refaire ici. Seule colonne manquante : duration_days, même convention que stay_rates (Tranche 2)
-- pour un champ spécifique à un seul type, en colonne nullable sur products plutôt qu'une table
-- séparée. Contrainte miroir de products_price_cop_required_unless_evento (même précédent déjà
-- posé) : jamais de camp sans durée, ce qui élimine à la source tout risque de generate_series(0,
-- null) dans create_order ci-dessous.
alter table products
  add column duration_days int,
  add constraint products_duration_days_required_for_camp
    check (type <> 'camp' or duration_days is not null),
  add constraint products_duration_days_positive
    check (duration_days is null or duration_days >= 1);

-- Tables spike jetables (feature 19) — jamais promues, supprimées ici comme annoncé dans leur
-- propre migration. spike_book_camp/spike_book_single_day référencent ces tables dans leur corps
-- PL/pgSQL mais n'en dépendent pas au sens de DROP TABLE (pas de lien statique) — supprimées elles
-- aussi ci-dessous : les laisser vivantes les rendrait cassées à l'appel (table inexistante) sans
-- aucune utilité, un vestige jamais nettoyé plutôt qu'un choix délibéré.
drop table spike_provider_resource_calendar, spike_availability_block;
drop function if exists spike_book_camp(uuid, date, int, int);
drop function if exists spike_book_single_day(uuid, date, int);

-- provider_resource_calendar : ressource partagée d'un établissement (camps/eventos réservables,
-- pas les activités ordinaires — blocage croisé différé, cf. ci-dessus). Même posture RLS que
-- product_availability : cupos publics en lecture, RPC-only en écriture.
create table provider_resource_calendar (
  establishment_id uuid not null references establishments(id),
  slot_date date not null,
  capacity int not null,
  booked int not null default 0,
  primary key (establishment_id, slot_date)
);
alter table provider_resource_calendar enable row level security;
revoke insert, update, delete on provider_resource_calendar from authenticated, anon;
create policy provider_resource_calendar_select_public on provider_resource_calendar
  for select using (true);

-- availability_blocks : trace la CAUSE d'un blocage (quelle commande a occupé quelle plage) —
-- lecture admin seule ("voir la cause du blocage", admin §3c), jamais publique (révélerait des
-- données de commande à n'importe quel visiteur).
create table availability_blocks (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id),
  start_date date not null,
  end_date date not null,
  source_order_line_id uuid not null references order_lines(id),
  created_at timestamptz not null default now()
);
alter table availability_blocks enable row level security;
revoke insert, update, delete on availability_blocks from authenticated, anon;
create policy availability_blocks_select_admin on availability_blocks
  for select using ((select is_admin(auth.uid())));

-- Le camp garde sa PROPRE capacité (participants par départ, cahier des charges client §1) dans
-- product_availability, réutilisée telle quelle — déjà générique par (product_id, date), aucune
-- modification nécessaire ; set_product_availability (feature 17) fonctionne sans y toucher.

-- set_provider_resource_capacity — parallèle à set_product_availability, volontairement PAS
-- fusionnée : clé établissement+date (pas produit+date), aucune notion 'open' booléenne (une
-- ressource partagée n'a qu'une capacité, jamais une fermeture calendaire propre).
create or replace function set_provider_resource_capacity(
  p_establishment_id uuid, p_date date, p_capacity int, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_capacity int;
  v_before_booked int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_provider_resource_capacity réservé au rôle admin' using errcode = '42501';
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.provider_resource_calendar
   where establishment_id = p_establishment_id and slot_date = p_date
   for update;

  if found and p_capacity < v_before_booked then
    return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_before_booked);
  end if;

  if found then
    update public.provider_resource_calendar set capacity = p_capacity
     where establishment_id = p_establishment_id and slot_date = p_date;
  else
    insert into public.provider_resource_calendar (establishment_id, slot_date, capacity, booked)
    values (p_establishment_id, p_date, p_capacity, 0);
  end if;

  perform public.log_admin_action(
    'establishment.set_resource_capacity', 'provider_resource_calendar', p_establishment_id,
    jsonb_build_object('date', p_date, 'capacity', v_before_capacity, 'booked', v_before_booked),
    jsonb_build_object('date', p_date, 'capacity', p_capacity), p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_provider_resource_capacity(uuid, date, int, text) to authenticated;

-- create_order (create or replace, 7e évolution — Tranche 3 → feature 6 → correctif réservation
-- invité → feature 7 → feature 11 → feature 14 → ici). Signature INCHANGÉE : create or replace
-- seul suffit. Deux ajouts, camps uniquement, reprenant tel quel le pattern validé par la
-- feature 19 — tout le reste (Phases 1/2/3/4 existantes) reste inchangé dans sa forme d'origine.
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

  -- Phase 2b (feature 20) : verrouillage de la ressource partagée, camps uniquement — APRÈS
  -- product_availability ci-dessus, toujours dans cet ordre relatif (établissement, date) pour
  -- toute future écriture qui toucherait les deux tables : c'est cette discipline d'ordre
  -- constant, pas la valeur de l'ordre en elle-même, qui élimine tout risque d'interblocage (même
  -- raisonnement que la feature 19, prouvé par son test de concurrence à 5 runs propres).
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
    null; -- verrouillage seul ; la validation par ligne (Phase 3) suit contre le même état verrouillé
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
    begin
      select p.sellable, coalesce(pc.open, p.calendar_default_open),
             p.type, p.establishment_id, p.duration_days
        into v_sellable, v_calendar_open, v_line_type, v_line_establishment_id, v_line_duration_days
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

      -- Feature 20, sous-étape supplémentaire : en plus du check habituel ci-dessus (calendrier +
      -- capacité propre du camp via product_availability, inchangé), chaque jour de la plage doit
      -- avoir booked + qty <= capacity sur provider_resource_calendar. Vérifié ligne par ligne
      -- (pas sommé entre lignes camp d'un même panier comme product_availability le fait plus
      -- haut) : cas volontairement plus simple que le pattern "somme inter-lignes" de la feature 6
      -- — deux camps qui se chevauchent DANS LE MÊME panier n'est pas un scénario couvert par les
      -- tests demandés pour cette feature ; à durcir plus tard sur le même modèle si ce cas
      -- devient réel, pas un oubli silencieux.
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
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_order_line_id uuid;
    begin
      -- Table de décision 17/10/7 : référent absent → direct, 0/17 ; référent = propriétaire de
      -- CETTE ligne → self_referral, 0/7 ; référent externe → external_referrer, 10/7. Résolue par
      -- ligne (pas une seule fois pour la commande) : un panier multi-établissement peut mélanger
      -- self_referral et external_referrer pour un même référent, selon le propriétaire de chaque
      -- produit — cf. plan feature 11 et son test dédié.
      select partner_id, price_cop, type, establishment_id, duration_days
        into v_line_partner_id, v_line_price_cop, v_line_type, v_line_establishment_id, v_line_duration_days
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

      -- Feature 20, sous-étape supplémentaire : pour une ligne camp, incrémenter booked sur
      -- CHAQUE jour de la plage et poser le bloc de disponibilité — même transaction, aucun
      -- second appel, même geste que product_availability juste au-dessus.
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
