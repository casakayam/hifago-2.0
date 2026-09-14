-- Remise par seuil de remplissage cumulé — camps (demande Jérôme du 2026-09-14, cadrée dans la même
-- session : cahier des charges client §"remise optionnelle par quantité/nombre de personnes"
-- (docs/01-cahier-des-charges-client.md:546-559, décision 2026-08-11/13) jamais construite jusqu'ici
-- (docs/00-modele-de-donnees.md:255) — CE lot la construit, scopée au type camp uniquement (seul
-- type portant aujourd'hui un remplissage cumulé fiable par départ, product_availability).
--
-- Décisions produit actées avec Jérôme (AskUserQuestion, même session) :
--   - Le seuil porte sur le remplissage CUMULÉ d'une session de camp (product_availability.booked
--     à la date de départ), PAS la quantité d'une seule ligne — mécanisme différent de price_tiers
--     (tarif dégressif par quantité de ligne, spec 08), complémentaire, pas substituable.
--   - Seuil ET pourcentage librement configurables par camp (admin et/ou prestataire propriétaire).
--   - La réservation qui fait elle-même franchir le seuil bénéficie de la remise sur sa propre part
--     (comparaison sur le remplissage APRÈS cette réservation, pas juste avant) — sinon un groupe
--     qui réserve d'un coup assez de places pour franchir le seuil n'en bénéficierait jamais.
--   - Aucun remboursement rétroactif de l'acompte déjà capturé pour les réservations antérieures au
--     franchissement — seul le solde réglé à l'arrivée (hors plateforme, spec 19) reflète le
--     remplissage final constaté, ajusté manuellement par l'établissement.

alter table products
  add column group_discount_threshold_qty int,
  add column group_discount_pct numeric(5, 4),
  add constraint products_group_discount_threshold_positive
    check (group_discount_threshold_qty is null or group_discount_threshold_qty >= 1),
  add constraint products_group_discount_pct_range
    check (group_discount_pct is null or (group_discount_pct > 0 and group_discount_pct < 1)),
  add constraint products_group_discount_pair
    check ((group_discount_threshold_qty is null) = (group_discount_pct is null)),
  -- Impose le scope MVP au niveau base, pas seulement dans l'UI admin — empêche silencieusement
  -- toute extension à un autre type tant que ce n'est pas explicitement décidé (cahier des charges
  -- vise plus large — activité/transport/evento — mais seul camp a un remplissage cumulé fiable
  -- aujourd'hui ; étendre est un chantier distinct, pas un oubli).
  add constraint products_group_discount_camp_only
    check (type = 'camp' or (group_discount_threshold_qty is null and group_discount_pct is null));

-- Pas de CHECK croisant threshold <= default_capacity : default_capacity est souvent nul pour un
-- camp (cupos posés explicitement par départ via product_availability, cf. set_product_availability)
-- — un CHECK bloquant sur une colonne souvent absente serait trompeur. Validation souple côté
-- formulaire admin (avertissement) plutôt qu'un blocage en base.

-- Pas de RPC pour ces 2 colonnes côté écriture admin — RLS directe products_write_admin existante,
-- même précédent que price_tiers/min_qty/max_qty (20260815230000_product_price_tiers_and_qty_bounds.sql) :
-- ni compteur de capacité, ni verrou optimiste, juste de la configuration produit. C'est leur
-- LECTURE dans create_order ci-dessous qui a besoin de rigueur, pas leur écriture.

-- create_order (create or replace, signature INCHANGÉE — pas de drop function nécessaire, cf.
-- supabase.md règle 7). Corps extrait par pg_get_functiondef depuis la version vivante
-- (20260910160000_create_order_lit_panier_et_attribution.sql, aucune migration ultérieure ne la
-- retouche), modifié par occurrences comptées à 4 endroits, tout le reste inchangé :
--   1. Déclaration de 3 nouveaux tableaux indexés par v_line_idx (seuil, pourcentage, remplissage
--      avant cette commande).
--   2. Boucle de lecture produit (Phase 1) : les 2 nouvelles colonnes rejoignent le même select que
--      price_tiers/duration_days/etc., même geste, aucune requête supplémentaire.
--   3. Phase 3 (validation, branche générique camp+activité+transport) : v_booked (déjà lu sous
--      verrou pour la vérification de capacité existante) est aussi capturé comme remplissage AVANT
--      cette commande — valeur déjà en mémoire, aucune requête ni verrou supplémentaire.
--   4. Phase 4 (écriture, même branche) : le prix de la ligne camp est réduit du pourcentage
--      configuré si remplissage-avant + qty-de-cette-ligne atteint le seuil. acompte_cop, calculé
--      juste après à partir de v_total_cop, répercute automatiquement la remise sur l'acompte
--      capturé par Mercado Pago, sans toucher au moteur de commission 17/10/7 (inchangé).
CREATE OR REPLACE FUNCTION public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_order_id uuid;
  -- Spec 32 (panier en base) : plus un paramètre — construites depuis cart_items/carts
  -- pour ce compte, côté serveur, un client ne pouvant plus jamais les falsifier.
  v_lines jsonb;
  v_cart_attribution_code text;
  v_cart_attribution_source text;
  v_line jsonb;
  v_line_idx int;
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
  -- 2026-09-10 (/simplify) : la condition « identité durable non anonyme » était calculée
  -- deux fois (lecture + écriture de saved_attribution_code) — une seule fois ici, réutilisée.
  v_identified_account boolean := v_account_id is not null and not (select public.is_anonymous_session());
  v_products_type text[];
  v_products_sellable boolean[];
  v_products_price_cop bigint[];
  v_products_price_tiers jsonb[];
  v_products_establishment_id uuid[];
  v_products_duration_days int[];
  v_products_partner_id uuid[];
  v_products_calendar_default_open boolean[];
  v_products_stay_rates jsonb[];
  v_products_lobby_category_id int[];
  -- Ajout de cette migration — remise par seuil de remplissage cumulé (camps).
  v_products_group_discount_threshold_qty int[];
  v_products_group_discount_pct numeric(5, 4)[];
  v_camp_fill_before_qty int[];
begin
  -- 2026-09-10 (spec 31, Tranche 1) — garde RÉINTRODUITE, en connaissance de son historique.
  -- Elle avait été retirée le 2026-08-13 (migration 20260814090000_create_order_guest_checkout.sql)
  -- pour que la réservation invité reste possible SANS COMPTE, décision de Jérôme documentée là-bas
  -- (cahier §1/§2 : « forcer un compte avant achat fait perdre des ventes »). Cette décision N'EST
  -- PAS renversée ici : elle porte sur le MOT DE PASSE, jamais exigé. Ce qui change, c'est qu'après
  -- ce lot, CartContext (apps/web) crée une session anonyme Supabase dès le premier ajout au panier
  -- (spec 31 invariant 1) — donc au moment où cette RPC est atteinte depuis l'écran réel, auth.uid()
  -- n'est PLUS jamais nul. La garde ne bloque que ce qui n'a plus aucun chemin légitime : un appel
  -- direct à la RPC sans passer par le panier. Elle prépare aussi `orders.account_id` NOT NULL
  -- (Tranche 2, spec 31) : sans elle, cette contrainte future remonterait une erreur Postgres brute
  -- (23502) au navigateur au lieu d'un motif exploitable par l'écran.
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Spec 32 : les lignes viennent de cart_items pour CE compte, jamais d'un paramètre. Un
  -- product_id/qty/date passé par le client ne peut plus jamais diverger de ce qu'il a
  -- réellement dans son panier au moment du checkout.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'date', date,
           'end_date', end_date,
           'slot_start_time', slot_start_time,
           'qty', qty
         ) order by created_at), '[]'::jsonb)
    into v_lines
    from public.cart_items
   where account_id = v_account_id;

  select attribution_code, attribution_source
    into v_cart_attribution_code, v_cart_attribution_source
    from public.carts
   where account_id = v_account_id;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;

  if p_holder_email is null or btrim(p_holder_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_required');
  end if;
  if p_holder_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email_invalid');
  end if;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_p_sellable boolean;
      v_p_price_cop bigint;
      v_p_establishment_id uuid;
      v_p_duration_days int;
      v_p_partner_id uuid;
      v_p_calendar_default_open boolean;
      v_p_stay_rates jsonb;
      v_p_lobby_category_id int;
      v_p_group_discount_threshold_qty int;
      v_p_group_discount_pct numeric(5, 4);
    begin
      select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates, lobby_category_id,
             group_discount_threshold_qty, group_discount_pct
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates, v_p_lobby_category_id,
             v_p_group_discount_threshold_qty, v_p_group_discount_pct
        from public.products where id = (v_line->>'product_id')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
      end if;

      v_products_type[v_line_idx] := v_product_type;
      v_products_sellable[v_line_idx] := v_p_sellable;
      v_products_price_cop[v_line_idx] := v_p_price_cop;
      v_products_price_tiers[v_line_idx] := v_price_tiers;
      v_products_establishment_id[v_line_idx] := v_p_establishment_id;
      v_products_duration_days[v_line_idx] := v_p_duration_days;
      v_products_partner_id[v_line_idx] := v_p_partner_id;
      v_products_calendar_default_open[v_line_idx] := v_p_calendar_default_open;
      v_products_stay_rates[v_line_idx] := v_p_stay_rates;
      v_products_lobby_category_id[v_line_idx] := v_p_lobby_category_id;
      v_products_group_discount_threshold_qty[v_line_idx] := v_p_group_discount_threshold_qty;
      v_products_group_discount_pct[v_line_idx] := v_p_group_discount_pct;

      v_price_tiers := public.normalize_price_tiers(v_price_tiers);

      if v_line_end_date is not null and v_product_type <> 'lodging' then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_date_range', 'line', v_line);
      end if;
      if v_line_end_date is not null and v_line_end_date <= (v_line->>'date')::date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_date_range', 'line', v_line);
      end if;

      if v_line_slot_start_time is not null then
        if v_line_end_date is not null then
          return jsonb_build_object('ok', false, 'reason', 'unsupported_slot_combination', 'line', v_line);
        end if;
      elsif v_line_end_date is null and exists (
        select 1 from public.product_slot_rules where product_id = (v_line->>'product_id')::uuid
      ) then
        return jsonb_build_object('ok', false, 'reason', 'slot_required', 'line', v_line);
      end if;

      if v_product_type = 'lodging' then
        v_lodging_lines := v_lodging_lines + 1;
        v_lodging_units := v_lodging_units + v_line_qty;
      else
        v_prestation_lines := v_prestation_lines + 1;
        if v_line_qty < v_min_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
        end if;
        if v_line_qty > v_max_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
        end if;
      end if;
    end;
  end loop;
  -- Valeurs relevées le 2026-09-07 (cahier §3e) pour la commande multi-établissements, jamais
  -- codées jusqu'ici (trouvé en préparant spec 32 §10) : 4/12/20 étaient encore celles de l'ère
  -- un-seul-établissement.
  if v_lodging_lines > 12 or v_lodging_units > 36 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 40 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  insert into public.product_availability (product_id, date, capacity, booked)
  select distinct p.id, (elem->>'date')::date, p.default_capacity, 0
    from jsonb_array_elements(v_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
   where elem->>'end_date' is null
     and p.default_capacity is not null
  on conflict (product_id, date) do nothing;

  insert into public.product_slot_availability (
    product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
  )
  select distinct p.id, (elem->>'date')::date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
    from jsonb_array_elements(v_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
    cross join lateral public.expand_product_slots(p.id, (elem->>'date')::date) v
   where elem->>'slot_start_time' is not null
     and v.slot_start_time = (elem->>'slot_start_time')::time
  on conflict (product_id, slot_date, slot_start_time) do nothing;

  for v_avail in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date
         from jsonb_array_elements(v_lines) elem
        where elem->>'end_date' is null
       union
       select (elem->>'product_id')::uuid, (elem->>'date')::date + gs
         from jsonb_array_elements(v_lines) elem
         join public.products p2 on p2.id = (elem->>'product_id')::uuid
         cross join lateral generate_series(0, ((elem->>'end_date')::date - (elem->>'date')::date) - 1) as gs
        where elem->>'end_date' is not null
          and p2.lobby_category_id is null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select prc.establishment_id, prc.slot_date
      from public.provider_resource_calendar prc
     where (prc.establishment_id, prc.slot_date) in (
       select p.establishment_id, (elem->>'date')::date + gs
         from jsonb_array_elements(v_lines) elem
         join public.products p on p.id = (elem->>'product_id')::uuid
         cross join generate_series(0, p.duration_days - 1) as gs
        where p.type = 'camp'
     )
     order by prc.establishment_id, prc.slot_date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select psa.product_id, psa.slot_date, psa.slot_start_time
      from public.product_slot_availability psa
     where (psa.product_id, psa.slot_date, psa.slot_start_time) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date, (elem->>'slot_start_time')::time
         from jsonb_array_elements(v_lines) elem
        where elem->>'slot_start_time' is not null
     )
     order by psa.product_id, psa.slot_date, psa.slot_start_time
     for update
  loop
    null;
  end loop;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
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
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_cart_qty int;
      v_night_row record;
    begin
      if v_line_end_date is not null then
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if v_line_price_tiers is null and v_line_price_cop is null then
          return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
        end if;
        if v_products_lobby_category_id[v_line_idx] is null then
          for v_night_row in
            select gs.night::date as night,
                   coalesce(pc.open, v_products_calendar_default_open[v_line_idx]) as calendar_open,
                   pa.capacity as capacity,
                   pa.booked as booked,
                   (select coalesce(sum((l->>'qty')::int), 0)
                      from jsonb_array_elements(v_lines) l
                     where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
                       and l->>'end_date' is not null
                       and gs.night::date >= (l->>'date')::date
                       and gs.night::date < (l->>'end_date')::date
                   ) as cart_qty
              from generate_series(
                     (v_line->>'date')::date::timestamp,
                     v_line_end_date::timestamp - interval '1 day',
                     interval '1 day'
                   ) as gs(night)
              left join public.product_calendar pc
                on pc.product_id = (v_line->>'product_id')::uuid and pc.date = gs.night::date
              left join public.product_availability pa
                on pa.product_id = (v_line->>'product_id')::uuid and pa.date = gs.night::date
             order by gs.night
          loop
            if not v_night_row.calendar_open then
              return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.capacity is null then
              return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.booked + v_night_row.cart_qty > v_night_row.capacity then
              return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line, 'date', v_night_row.night);
            end if;
          end loop;
        end if;

      elsif v_line_slot_start_time is not null then
        v_sellable := v_products_sellable[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        select capacity, booked into v_capacity, v_booked
          from public.product_slot_availability
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;
        if not found then
          return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
        end if;

        if v_booked + (
          select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
           where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
             and (l->>'date')::date = (v_line->>'date')::date
             and (l->>'slot_start_time')::time = v_line_slot_start_time
        ) > v_capacity then
          return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
        end if;

      else
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;

        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        if v_line_price_tiers is null and v_line_price_cop is null then
          return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
        end if;

        select capacity, booked into v_capacity, v_booked
          from public.product_availability
         where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
        if not found then
          return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
        end if;

        -- Ajout de cette migration : remplissage AVANT cette commande, capturé sous le même verrou
        -- que v_booked ci-dessus (aucune requête supplémentaire) — sert en Phase 4 à décider si la
        -- ligne franchit le seuil de remise (camps uniquement, group_discount_threshold_qty null
        -- pour tout autre type). Valeur déjà cohérente avec la vérification de capacité qui suit.
        v_camp_fill_before_qty[v_line_idx] := v_booked;

        if v_booked + (
          select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
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
      end if;
    end;
  end loop;

  -- 2026-09-10 (spec 31 invariant 3) — `and not is_anonymous_session()` ajouté aux DEUX endroits
  -- de ce bloc (lecture ci-dessous, écriture plus bas). Sans cette exclusion, la préférence
  -- d'attribution durable se serait mise à s'écrire sur une IDENTITÉ ANONYME dès l'invariant 1 en
  -- vigueur — chaque commande invité avec ?ref= aurait estampillé le code sur l'identité, et les
  -- commandes suivantes de ce même visiteur l'auraient réutilisé sans ?ref=, source='account'.
  -- Exactement ce que la décision ② interdit (« jamais sur l'identité »), et ce que le §3c du
  -- cahier client (validé 2026-08-13) interdit déjà pour un invité (« vaut pour la réservation en
  -- cours, jamais une préférence durable »). v_account_id seul ne suffit plus à distinguer : après
  -- ce lot, un invité EST v_account_id is not null (son identité anonyme), donc c'est précisément
  -- le test qui aurait laissé passer la régression.
  -- Spec 32 : la source n'est plus un paramètre client mais carts.attribution_code, capté par
  -- CartContext dès le premier ajout au panier (spec 32 §4) — jamais l'identité elle-même (spec
  -- 31 invariant 3). Repli inchangé pour un compte réel sans attribution de panier :
  -- partner_accounts.saved_attribution_code, sa durée de vie dépassant celle d'un panier.
  if v_cart_attribution_code is not null then
    v_attribution_code := v_cart_attribution_code;
    v_attribution_source := v_cart_attribution_source;
  elsif v_identified_account then
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

  if v_identified_account and v_cart_attribution_code is not null and v_referrer_partner_id is not null then
    update public.partner_accounts set saved_attribution_code = v_cart_attribution_code
     where id = v_account_id;
  end if;

  insert into public.orders (
    account_id, holder_name, holder_email, holder_phone, marketing_consent,
    referrer_partner_id, attribution_code, attribution_source
  )
  values (
    v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent,
    v_referrer_partner_id, v_attribution_code, v_attribution_source
  )
  returning id into v_order_id;

  -- Spec 32 : le panier de ce compte n'a plus lieu d'exister dès qu'une commande le remplace —
  -- seulement à partir d'ici (tout retour 'ok', false plus haut laisse cart_items intact, cas
  -- limite de la spec 32 §0).
  delete from public.cart_items where account_id = v_account_id;
  delete from public.carts where account_id = v_account_id;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
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
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_gs int;
      v_nights int;
      v_sum_nightly bigint;
      v_tier_price bigint;
      v_stay_rates jsonb;
      v_camp_product_name text;
      v_camp_partner_account record;
    begin
      if v_line_end_date is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_stay_rates := v_products_stay_rates[v_line_idx];
        select public.resolve_tier_price(v_line_price_tiers, v_line_price_cop, v_line_qty) into v_tier_price;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price((v_line->>'product_id')::uuid, v_night, v_tier_price, v_stay_rates);
        end loop;
        if v_products_lobby_category_id[v_line_idx] is null then
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid
             and date >= (v_line->>'date')::date and date < v_line_end_date;
        end if;
        v_total_cop := v_sum_nightly;
        v_line_price_cop := v_sum_nightly;

      elsif v_line_slot_start_time is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

        if v_line_price_tiers is not null then
          select t.price_cop into v_line_price_cop
            from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
           limit 1;
        end if;

        v_total_cop := v_line_price_cop * v_line_qty;

        update public.product_slot_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;

      else
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

        if v_line_price_tiers is not null then
          select t.price_cop into v_line_price_cop
            from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
           limit 1;
        end if;

        -- Ajout de cette migration : remise par seuil de remplissage cumulé, camps uniquement.
        -- Comparaison sur le remplissage APRÈS cette ligne (fill_avant + qty), pas juste avant —
        -- décision actée avec Jérôme : la réservation qui fait elle-même franchir le seuil en
        -- bénéficie (sinon un groupe qui réserve d'un coup assez de places pour franchir le seuil
        -- n'en bénéficierait jamais lui-même). group_discount_threshold_qty est structurellement
        -- null pour tout type autre que camp (products_group_discount_camp_only ci-dessus), donc
        -- cette branche n'a aucun effet en dehors des camps configurés.
        if v_line_type = 'camp'
           and v_products_group_discount_threshold_qty[v_line_idx] is not null
           and v_camp_fill_before_qty[v_line_idx] + v_line_qty
               >= v_products_group_discount_threshold_qty[v_line_idx]
        then
          v_total_cop := round(
            v_line_price_cop * v_line_qty * (1 - v_products_group_discount_pct[v_line_idx])
          );
        else
          v_total_cop := v_line_price_cop * v_line_qty;
        end if;

        update public.product_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
      end if;

      if v_referrer_partner_id is null then
        v_commission_case := 'direct';        v_referrer_pct := 0;    v_app_pct := 0.17;
      elsif v_referrer_partner_id = v_line_partner_id then
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.07;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.10; v_app_pct := 0.07;
      end if;
      v_acompte_pct := v_referrer_pct + v_app_pct;

      -- Ajout de cette migration : holder_phone, holder_email dans la liste de colonnes et de
      -- valeurs (jusqu'ici seul holder_name était dupliqué depuis p_holder_name/p_holder_email/
      -- p_holder_phone déjà disponibles comme paramètres de cette fonction).
      insert into public.order_lines (
        order_id, account_id, product_id, date, end_date, slot_start_time, qty,
        referrer_partner_id, holder_name, holder_phone, holder_email, price_cop, total_cop,
        commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
        app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_slot_start_time, v_line_qty,
        v_referrer_partner_id, p_holder_name, p_holder_phone, p_holder_email,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      if v_commission_case = 'external_referrer' then
        insert into public.ledger_entries (
          order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status
        )
        values (
          v_order_line_id, 'referrer', v_referrer_partner_id, 'referral_earned',
          round(v_total_cop * v_referrer_pct), 'estimated'
        );
      end if;

      if v_line_type = 'camp' then
        update public.provider_resource_calendar
           set booked = booked + v_line_qty
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

        -- Spec 23 Tranche 2 (docs/specs/23-notifications-email-transactionnelles.md §4/§10 point 3)
        -- — notification prestataire "blocage camp/evento". Branchée ICI (create_order), pas
        -- apply_payment_webhook : le blocage ci-dessus est déjà effectif à cet instant précis,
        -- avant tout paiement (comportement existant, inchangé par cette spec) — le cahier des
        -- charges décrit la notification comme liée au moment où le blocage devient effectif, pas
        -- à la confirmation du paiement (docs/02-cahier-des-charges-socio.md:409-412). Isolée PAR
        -- COMPTE (spec 23 §8.2, un partenaire peut avoir plusieurs comptes de connexion) et ne
        -- doit jamais faire échouer la réservation elle-même (spec 23 §8.1) — la RPC la plus
        -- centrale du système (tout panier, anon ou authentifié, y passe).
        select p.name ->> 'es' into v_camp_product_name
          from public.products p where p.id = (v_line->>'product_id')::uuid;

        for v_camp_partner_account in
          select pa.id as account_id, au.email
            from public.partner_accounts pa
            join auth.users au on au.id = pa.id
           where pa.partner_id = v_line_partner_id
        loop
          begin
            perform public.enqueue_notification_email(
              'partner_camp_evento_blocked',
              v_camp_partner_account.email,
              v_camp_partner_account.account_id,
              'Reserva confirmada — recurso bloqueado',
              '<p>Se reservó "' || coalesce(v_camp_product_name, 'tu producto') || '".</p>'
                || '<p>Período bloqueado: ' || (v_line->>'date')::date
                || ' a ' || ((v_line->>'date')::date + v_line_duration_days - 1) || '.</p>'
                || '<p>Otras actividades que comparten este recurso pueden haber quedado no disponibles durante ese período.</p>',
              'order_lines', v_order_line_id
            );
          exception
            when query_canceled then
              raise warning 'create_order: notification camp annulée (query_canceled) pour compte % — %', v_camp_partner_account.account_id, sqlerrm;
            when others then
              raise warning 'create_order: échec notification camp pour compte % — %', v_camp_partner_account.account_id, sqlerrm;
          end;
        end loop;
      end if;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$function$;

-- Pas de nouveau grant nécessaire : signature inchangée (text, text, text, boolean), le grant
-- existant (20260910160000) reste valide pour ce même objet function.
