-- Spec 21 §8 — RÉORDONNANCEMENT : LobbyPMS est réservé AVANT confirmation et encaissement.
--
-- LE FAIT QUI A DÉCIDÉ (spec 24 §11.2). Sur le compte réel de Casa Kayam, deux catégories (49823,
-- 18013) refusent `POST /bookings` en 422 TOUT EN affichant une disponibilité non nulle, et C1 est
-- RÉFUTÉ : `available-rooms` les cote exactement comme les autres, rien dans la charge utile ne dit
-- « réservable ». Aucune lecture préalable ne peut donc prédire le refus — seul l'appel d'écriture
-- le révèle. Jusqu'ici la séquence était `create_order` (qui CONFIRME) → `void reserve-nights` →
-- `void startPayment` : le client payait ses 17 %, hifago confirmait, et le partenaire ne recevait
-- RIEN. La compensation par annulation ne jouait pas — il n'y a rien à annuler quand rien n'a été
-- créé.
--
-- CE QUE FAIT CETTE MIGRATION, et ce qu'elle ne fait PAS. Elle ajoute la seule pièce qui manquait :
-- de quoi DÉFAIRE une commande dont LobbyPMS a refusé les nuits, avant que quoi que ce soit ne soit
-- encaissé. `create_order` n'est PAS touchée — c'est délibéré : elle est aussi la barrière
-- anti-survente du chemin NON-PMS (verrou `for update` + décrément de product_availability), que
-- les lignes PMS-backed sautent depuis 20260819130000. Réordonner le PMS ne doit pas déplacer une
-- ligne de ce chemin-là.
--
-- ⚠️ POURQUOI CETTE FONCTION REND LES PLACES ALORS QUE `cancel_order` REFUSE DE LE FAIRE.
-- Ce n'est pas une incohérence, c'est la même règle appliquée à deux situations opposées.
-- `cancel_order` garde la place consommée EXPRÈS (cahier des charges client §7/A3 — « en
-- compensation du créneau bloqué pour rien ») : un client a réservé, le partenaire a immobilisé un
-- créneau, puis le client s'est désisté. Ici, personne n'a rien immobilisé : LobbyPMS a refusé, la
-- réservation n'a jamais existé, et il n'y a aucune compensation à devoir. Garder la place
-- consommée reviendrait à punir le partenaire pour un refus venu de son propre PMS.
--
-- ⚠️ TOUT-OU-RIEN À L'ÉCHELLE DE LA COMMANDE, et c'est un choix. Une commande peut mêler logement
-- et activités, et plusieurs établissements. Trois raisons de tout défaire dès qu'une ligne
-- PMS-backed échoue : (1) le client paie UN acompte pour UNE commande — en confirmer une partie
-- reviendrait à encaisser pour un panier qu'on ne peut pas honorer ; (2) `add-product-service`
-- EXIGE un booking porteur, donc une activité dont la nuit a échoué est de toute façon invendable
-- côté Lobby ; (3) les bookings déjà créés pour un AUTRE établissement de la même commande sont
-- rattrapés sans code neuf — le trigger `order_lines_enqueue_pms_cancellation` les met en file dès
-- que leurs lignes quittent `reserved`.
--
-- Statut retenu : `cancelled_by_provider`. C'est le plus exact (le système du prestataire a
-- refusé), il est déjà dans la liste blanche du trigger d'annulation PMS, et il évite d'ajouter une
-- valeur à `order_lines_status_check` — donc de toucher tout ce qui lit ce statut.

create or replace function public.release_order_after_pms_refusal(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_line record;
  v_released_ids uuid[] := array[]::uuid[];
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_required');
  end if;

  -- Verrou sur la commande AVANT toute lecture de lignes : `expire_stale_payment_orders` prend le
  -- même verrou (`for update of o`), donc les deux ne peuvent pas défaire la même commande en
  -- parallèle et décrémenter deux fois.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Rendre les places AVANT de changer les statuts : la restitution a besoin de savoir quelles
  -- lignes étaient vivantes, et le trigger d'annulation PMS a besoin, lui, de les voir mortes.
  -- L'ordre inverse ferait rater l'une des deux.
  for v_line in
    select ol.id, ol.product_id, ol.date, ol.end_date, ol.slot_start_time, ol.qty,
           p.type as product_type, p.lobby_category_id, p.establishment_id, p.duration_days
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
     order by ol.id
     for update of ol
  loop
    v_released_ids := v_released_ids || v_line.id;

    -- Miroir EXACT des trois incréments de create_order, dans le même ordre de branches. Une
    -- branche qui divergerait rendrait une place de trop ou de trop peu, en silence.
    if v_line.end_date is not null then
      -- Séjour par plage. La condition `lobby_category_id is null` reproduit celle de create_order :
      -- une ligne PMS-backed n'a JAMAIS été décrémentée, il n'y a donc rien à lui rendre.
      if v_line.lobby_category_id is null then
        update public.product_availability
           set booked = greatest(0, booked - v_line.qty)
         where product_id = v_line.product_id
           and date >= v_line.date
           and date < v_line.end_date;
      end if;

    elsif v_line.slot_start_time is not null then
      update public.product_slot_availability
         set booked = greatest(0, booked - v_line.qty)
       where product_id = v_line.product_id
         and slot_date = v_line.date
         and slot_start_time = v_line.slot_start_time;

    else
      update public.product_availability
         set booked = greatest(0, booked - v_line.qty)
       where product_id = v_line.product_id
         and date = v_line.date;
    end if;

    -- Un camp immobilise en plus une ressource partagée et pose un blocage d'agenda : les deux
    -- sont posés par create_order, les deux doivent repartir.
    if v_line.product_type = 'camp' then
      update public.provider_resource_calendar
         set booked = greatest(0, booked - v_line.qty)
       where establishment_id = v_line.establishment_id
         and slot_date between v_line.date and v_line.date + v_line.duration_days - 1;

      delete from public.availability_blocks where source_order_line_id = v_line.id;
    end if;
  end loop;

  if array_length(v_released_ids, 1) is null then
    -- Idempotent : un second appel (rejeu réseau, double clic) ne trouve plus de ligne vivante et
    -- ne rend donc rien une seconde fois.
    return jsonb_build_object('ok', true, 'released_lines', 0);
  end if;

  -- UNE SEULE instruction UPDATE, et ce n'est pas cosmétique : le trigger
  -- `order_lines_enqueue_pms_cancellation` est FOR EACH STATEMENT et lit `new_rows`. Découper en
  -- plusieurs UPDATE le ferait s'exécuter plusieurs fois sur des vues partielles, et son test
  -- « plus aucune ligne reserved ne porte ce booking » pourrait être faux à mi-chemin.
  update public.order_lines
     set status = 'cancelled_by_provider'
   where id = any(v_released_ids);

  perform public.apply_order_line_ledger_transition(v_released_ids, 'cancelled_by_provider');

  -- Le paiement n'a jamais démarré (c'est tout l'intérêt du réordonnancement), mais une intention
  -- a pu être créée si le client a rejoué : on la neutralise plutôt que de la laisser pendante.
  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = p_order_id and status = 'pending';

  update public.orders set payment_status = 'unpaid' where id = p_order_id;

  -- ⚠️ PAS d'écriture dans audit_log, et ce n'est pas un oubli : `actor_id` y est NOT NULL, or
  -- aucun humain n'est à l'origine de ce relâchement — il est décidé par le refus de LobbyPMS.
  -- C'est déjà la convention du projet pour les transitions automatiques :
  -- `expire_stale_payment_orders` n'en écrit pas non plus. La trace vit ailleurs, et elle est
  -- suffisante : les lignes portent `cancelled_by_provider`, la route journalise le corps de refus
  -- de Lobby, et le cas « relâchement impossible » alimente pms_reconciliation_entries.
  --
  -- (Trouvé par release_order_after_pms_refusal.test.sql : la première version insérait
  -- `actor_id = null` et violait la contrainte au premier refus réel.)

  return jsonb_build_object('ok', true, 'released_lines', array_length(v_released_ids, 1));
end;
$$;

-- ⚠️ SERVICE_ROLE UNIQUEMENT. Sur Supabase, les privilèges par défaut de `public` accordent EXECUTE
-- EXPLICITEMENT à anon et authenticated : un `revoke ... from public` ne leur retire RIEN, il faut
-- NOMMER les rôles (leçon du 2026-08-27, migrations 20260828000103/20260828002053). Sans ça,
-- connaître l'UUID d'une commande suffirait à la faire annuler depuis le navigateur — et cette
-- fonction rend des places, donc elle est directement monnayable.
-- Elle est appelée par /api/pms/reserve-nights, qui seul sait que Lobby a refusé ; le client ne
-- décide jamais d'un relâchement.
revoke all on function public.release_order_after_pms_refusal(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_order_after_pms_refusal(uuid, text)
  to service_role;
