-- Feature 10 — Admin : changer manuellement le statut d'une ligne de commande (raison obligatoire).
--
-- Portée ligne, pas commande (contrairement à la feature 8, client, toute la commande d'un coup) —
-- l'admin cible une order_line précise. Seulement vers un état terminal (fulfilled/no_show/
-- cancelled_by_client/cancelled_by_provider/expired, vocabulaire de la feature 8) — jamais un
-- retour en arrière vers reserved.
--
-- Premier appel de log_admin_action (correctif feature 4) avec un motif OBLIGATOIRE (pas optionnel
-- comme set_product_sellable) : le titre même de cette feature l'exige. Verrou FOR UPDATE simple
-- sur la ligne ciblée, même calibrage bas-risque que cancel_order (feature 8) — pas de compteur de
-- capacité en jeu, pas de test de concurrence à barrière.
--
-- Ce que cette RPC NE fait PAS : le cahier des charges dit « chaque transition écrit le ledger et
-- l'audit » — seul l'audit (log_admin_action) est branché ici. Le ledger n'existe pas encore
-- (feature 12, juste après) ; cette RPC n'écrit donc aucun mouvement financier pour l'instant,
-- uniquement la transition de statut et sa trace d'audit.
create or replace function set_order_line_status(
  p_order_line_id uuid,
  p_new_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_status text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_order_line_status réservé au rôle admin' using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour une transition manuelle';
  end if;

  if p_new_status not in ('fulfilled', 'no_show', 'cancelled_by_client',
                           'cancelled_by_provider', 'expired') then
    raise exception 'statut cible invalide : %', p_new_status;
  end if;

  select status into v_before_status
    from public.order_lines
   where id = p_order_line_id
   for update;

  if not found then
    raise exception 'ligne de commande introuvable';
  end if;

  update public.order_lines set status = p_new_status where id = p_order_line_id;

  perform public.log_admin_action(
    'order_line.set_status', 'order_lines', p_order_line_id,
    jsonb_build_object('status', v_before_status),
    jsonb_build_object('status', p_new_status),
    p_reason
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_order_line_status(uuid, text, text) to authenticated;
