-- Bug de données réel trouvé le 2026-08-18 (hifago/CLAUDE.md §12 historique, jamais corrigé
-- jusqu'ici) : expire_stale_payment_orders (20260818230000) expire TOUTE commande dont
-- payment_status reste 'unpaid'/'pending' 30 minutes après création — mais create_manual_order_line
-- (20260818190000/20260819180000, réservation walk-in saisie par un operator) n'a jamais touché
-- payment_status, qui reste donc à son défaut 'unpaid' indéfiniment : une réservation walk-in payée
-- cash au comptoir se faisait donc annuler par ce job 30 minutes après sa saisie, exactement comme
-- une vraie commande en ligne jamais payée. Constaté empiriquement : 88/102 order_lines récentes
-- déjà 'expired' pour cette raison. Un walk-in n'attend structurellement AUCUN paiement en ligne
-- (commission_case='operator_manual', décision Jérôme 2026-08-18 : zéro flux Mercado Pago) — ce
-- job ne doit donc jamais le considérer.
--
-- Chaque appel de create_manual_order_line crée une commande DÉDIÉE (jamais rattachée à une
-- commande existante, cf. la RPC elle-même) : une commande walk-in est donc TOUJOURS 100%
-- 'operator_manual' ou 0% — vérifier qu'AUCUNE ligne de la commande n'a ce commission_case suffit à
-- l'exempter en bloc, sans nouvelle colonne ni changement de payment_status (qui reste sémantiquement
-- correct : un walk-in n'a réellement jamais été payé via la plateforme). Si ce invariant change un
-- jour (une commande mixte manuel+en ligne devient possible), cette exclusion devra être revue.
create or replace function expire_stale_payment_orders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale_order_ids uuid[];
begin
  with stale as (
    select o.id
      from public.orders o
     where o.payment_status in ('unpaid', 'pending')
       and o.created_at < now() - interval '30 minutes'
       and exists (
         select 1 from public.order_lines ol where ol.order_id = o.id and ol.status = 'reserved'
       )
       and not exists (
         select 1 from public.order_lines ol2
          where ol2.order_id = o.id and ol2.commission_case = 'operator_manual'
       )
     for update of o
  )
  select array_agg(id) into v_stale_order_ids from stale;

  if v_stale_order_ids is null then
    return;
  end if;

  update public.order_lines
     set status = 'expired'
   where order_id = any(v_stale_order_ids) and status = 'reserved';

  perform public.apply_order_line_ledger_transition(
    (select coalesce(array_agg(ol.id), array[]::uuid[])
       from public.order_lines ol
      where ol.order_id = any(v_stale_order_ids) and ol.status = 'expired'),
    'expired'
  );

  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = any(v_stale_order_ids) and status = 'pending';

  update public.orders
     set payment_status = 'unpaid'
   where id = any(v_stale_order_ids);
end;
$$;
