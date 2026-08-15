-- Feature 6 (Client : composer un panier à plusieurs lignes sur une même commande,
-- multi-établissement) — LA RPC la plus complexe du projet à ce stade. Remplace
-- reserve_order_line (Tranche 3 + correctif Tranche 2/3) : maintenir deux implémentations
-- indépendantes du même verrouillage anti-survente serait exactement la duplication que
-- hifago/CLAUDE.md §4.3 interdit, appliqué à l'envers (deux squelettes qui pourraient diverger).
--
-- Consentement Habeas Data (cahier des charges client §3e/§4 : « une case explicite au moment de
-- la réservation, distincte de l'acceptation des CGV... horodatée ») — orders.created_at (déjà
-- là) horodate suffisamment, le consentement étant capturé atomiquement à la création de la
-- commande ; pas de colonne d'horodatage séparée.
alter table orders add column marketing_consent boolean not null default false;

-- Séquencement en 4 phases, pas une boucle naïve :
--   1. Plafonds (aucun verrou pris) — un panier manifestement invalide ne doit jamais prendre un
--      verrou. Plafonds appliqués GLOBALEMENT sur toute la commande (point ouvert tranché par
--      Jérôme le 2026-08-13), pas répétés par établissement.
--   2. Verrouillage de TOUTES les ressources visées en un seul ordre stable (product_id, date),
--      une seule requête multi-lignes — jamais une boucle de verrous individuels dans l'ordre
--      soumis par le client, qui exposerait un interblocage entre deux commandes multi-lignes
--      concurrentes visant les deux mêmes ressources en ordre inverse. Première validation
--      empirique réelle de cette technique de verrouillage multi-ressources (avant même le spike
--      dédié de la feature 19, qui dérisque le problème voisin mais distinct des camps).
--   3. Validation de chaque ligne contre l'état verrouillé — aucune écriture avant cette étape.
--      Deux lignes visant le même produit ET la même date (autorisé, cahier des charges client
--      A14) voient leurs quantités sommées avant comparaison à la capacité restante.
--   4. Écriture, seulement si la phase 3 a validé la totalité du panier.
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
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
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

      -- Gate sellable (feature 4) : security definer contourne entièrement RLS (donc aussi
      -- products_select_public, qui filtre l'affichage mais ne protège aucun appel direct) — un
      -- produit dépublié resterait réservable via un product_id connu sans cette vérification
      -- explicite. Cahier des charges client §3a : « un produit doit être marqué vendable...
      -- vérifié... côté serveur au moment de la réservation ».
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

  -- Phase 4 : écriture, tout le panier a été validé.
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

grant execute on function create_order(jsonb, text, text, text, boolean) to authenticated;
drop function if exists reserve_order_line(uuid, date, int, text, text, text);
