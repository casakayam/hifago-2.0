-- Feature 8 — Client : annuler sa réservation.
--
-- Constat : orders.status/order_lines.status n'avaient jusqu'ici qu'un défaut 'confirmed' sans
-- check — un placeholder de la Tranche 3, jamais le vocabulaire cible du cahier des charges client
-- §3f (réservée/réalisée/absence/annulée-client/annulée-prestataire/expirée). Première feature qui
-- touche vraiment ce statut — même logique que price_cop > 0 en feature 3 : le bon moment pour
-- poser le vocabulaire cible plutôt qu'un correctif de plus, plus tard.
--
-- Décision de conception — orders.status reste hors périmètre : le cahier des charges décrit un
-- cycle de vie PAR LIGNE (order_lines), jamais un statut de commande agrégé indépendant — le
-- reprendre ici forcerait une valeur résumée forcément fausse dès qu'une commande mélange des
-- lignes à des états différents. orders.status reste donc le placeholder existant, inchangé, non
-- calculé par cette feature.
alter table order_lines
  alter column status set default 'reserved',
  add constraint order_lines_status_check check (
    status in ('reserved', 'fulfilled', 'no_show', 'cancelled_by_client',
               'cancelled_by_provider', 'expired')
  );

-- cancel_order — PAS une RPC critique au sens anti-survente (aucun compteur de capacité touché) :
-- verrou FOR UPDATE simple pour éviter un double-clic concurrent sur le même bouton, pas le
-- harnais de concurrence à barrière réservé au risque n°1 (create_order/set_product_availability)
-- — même calibrage que la feature 16 (modération, verrou bas-risque).
create or replace function cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_owner uuid;
  v_cancelled_count int;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select account_id into v_owner from public.orders where id = p_order_id for update;

  if not found or v_owner is distinct from v_account_id then
    -- commande inexistante ou d'un autre compte : même réponse dans les deux cas, jamais un refus
    -- explicite qui distinguerait les deux (même logique que le socio doc §3d).
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  update public.order_lines
     set status = 'cancelled_by_client'
   where order_id = p_order_id
     and status = 'reserved';   -- seulement les lignes ENCORE actives (admin doc §3g) : une ligne
                                 -- déjà réalisée/annulée/expirée n'est jamais retouchée.

  get diagnostics v_cancelled_count = row_count;

  if v_cancelled_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_active_lines');
  end if;

  -- product_availability.booked n'est JAMAIS décrémenté ici : la place reste consommée, aucune
  -- remise en vente automatique (cahier des charges client §7/A3 — « en compensation du créneau
  -- bloqué pour rien »). Une réouverture éventuelle reste un geste manuel admin
  -- (set_product_availability, feature 5), jamais un effet de bord de cette annulation.

  return jsonb_build_object('ok', true, 'cancelled_lines', v_cancelled_count);
end;
$$;

-- Pas de grant à anon (contrairement à create_order) : annuler exige de prouver la propriété de la
-- commande via auth.uid() — un invité n'a justement aucune session pour ça, cohérent avec le
-- cahier des charges (« après la réservation, sans compte : le client garde son numéro de
-- réservation et le contact direct... comme seuls repères », pas d'action self-service sans compte).
grant execute on function cancel_order(uuid) to authenticated;
