-- Correctif — réservation invité (compte optionnel pour créer une commande).
--
-- Constat (2026-08-13, découvert en préparant la feature 7) : create_order (feature 6) exigeait
-- auth.uid() non nul (not_authenticated sinon) ; Checkpoint B avait fait le choix — jamais signalé
-- comme tel à l'époque — de rediriger tout visiteur non connecté vers /login plutôt que d'appeler
-- la RPC. Ça contredit le cahier des charges client §1/§2 déjà validé : « réserver en tant
-- qu'invité, sans jamais se connecter, doit rester possible... forcer un compte avant achat fait
-- perdre des ventes ». Décision (2026-08-13, via Jérôme) : corriger maintenant, backend et écran.
--
-- Le schéma n'a jamais bloqué ça : orders.account_id et order_lines.account_id sont nullable
-- depuis leur création en Tranche 3 (cf. 20260813194515_availability_orders_core_tables.sql).
-- Seule la garde explicite de la RPC empêchait un appel non authentifié d'aboutir — son retrait
-- est donc le seul changement de comportement ici, le reste du corps de la fonction (plafonds,
-- verrouillage, calendrier, capacité, écriture tout-ou-rien) reste identique à la feature 6.
--
-- Pourquoi ça n'élargit aucune surface d'écriture directe : product_availability/orders/
-- order_lines restent entièrement RPC-only (aucune policy d'écriture directe, quel que soit
-- l'appelant) — élargir QUI peut appeler la RPC ne change rien à CE QUE la RPC vérifie. Les mêmes
-- invariants s'appliquent identiquement à un appel anon ou authenticated.
--
-- Point à surveiller, pas résolu ici (cf. hifago/CLAUDE.md §10) : ouvrir create_order à anon
-- élargit la surface d'abus possible (spam de réservations sans authentification, y compris pour
-- épuiser la capacité d'un concurrent — un « hold attack »). Pas de rate-limit construit
-- maintenant, même posture que les autres points hors périmètre déjà notés.
create or replace function create_order(
  p_lines jsonb,
  p_holder_name text,
  p_holder_email text default null,
  p_holder_phone text default null,
  p_marketing_consent boolean default false
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

  -- Phase 4 : écriture, tout le panier a été validé. v_account_id (potentiellement null pour un
  -- invité) est écrit tel quel, comme n'importe quelle autre valeur — aucun traitement spécial.
  insert into public.orders (account_id, holder_name, holder_email, holder_phone, marketing_consent)
  values (v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent)
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

-- Élargi à anon (visiteur jamais connecté) — signature inchangée, donc create or replace suffit
-- ici (contrairement à la feature 7 juste après, qui change la liste de paramètres et nécessite un
-- drop explicite de l'ancienne surcharge).
grant execute on function create_order(jsonb, text, text, text, boolean) to authenticated, anon;
