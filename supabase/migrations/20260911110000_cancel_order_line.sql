-- Spec 34 Tranche 2 — l'annulation d'UNE prestation, décision ⑤ (2026-09-11).
--
-- ⚠️ CE QUE CETTE MIGRATION RENVERSE, ET QUI L'A DÉCIDÉ. Le cahier client §2c dit, depuis le
-- 2026-09-07 : « Annuler la réservation signifie annuler TOUTE la commande et toutes ses lignes ».
-- C'est la règle sous laquelle `cancel_order` a été écrite le 2026-08-14. Jérôme l'a renversée le
-- 2026-09-11 — « l'annulation devrait être sur une activité ou hôtel, mais pas toutes les
-- prestations » — et la spec 34 révise le cahier nommément. `cancel_order` devient donc sans objet ;
-- elle est SUPPRIMÉE en Tranche 4, une fois que plus aucun écran ne l'appelle.
--
-- ⚠️ PAS une RPC critique au sens de CLAUDE.md §4 : aucun compteur de capacité n'est touché.
-- `product_availability.booked` n'est JAMAIS décrémenté — la place n'est pas remise en vente
-- (cahier client §7/A3, règle inchangée par la granularité, et *Trou (a)* du backlog reste ouvert).
-- Donc verrou `for update` simple sur la ligne, pas le harnais à barrière de synchronisation de
-- docs/05-reference-technique.md. Même calibrage que `cancel_order`, dont elle prend la place.
--
-- ⚠️ LE VERROU PORTE SUR LA LIGNE, PAS SUR LA COMMANDE, et c'est le cœur du changement : deux
-- prestations d'une même commande s'annulent indépendamment. Ce qu'on sérialise, c'est le
-- double-clic sur LA MÊME prestation, pas deux gestes distincts du même client.
create or replace function public.cancel_order_line(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_order_id uuid;
  v_restantes int;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Décision ⑨ (2026-09-11) : un invité n'annule pas lui-même. Il n'a plus l'écran de compte
  -- (décision ⑦), et lui laisser la RPC serait une capacité que plus rien n'exercerait — son
  -- chemin est le contact de l'établissement, depuis /reserva/<jeton>. Ce refus explicite satisfait
  -- aussi le CAS 2 de security_definer_exposure.test.sql sans entrée en liste blanche, là où
  -- `cancel_order` en occupait une.
  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  select ol.account_id, ol.status, ol.order_id
    into v_owner, v_status, v_order_id
    from public.order_lines ol
   where ol.id = p_line_id
   for update;

  -- Ligne inexistante OU appartenant à un autre compte : MÊME réponse, jamais un refus qui
  -- distinguerait les deux (même discipline que cancel_order, create_payment_intent et
  -- get_order_by_token — un attaquant ne doit pas pouvoir énumérer des identifiants valides).
  if not found or v_owner is distinct from v_account_id then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  if v_status <> 'reserved' then
    -- Déjà réalisée, déjà annulée, expirée ou remplacée : jamais retouchée. Un second appel sur
    -- la même ligne tombe ici, ce qui rend la RPC idempotente du point de vue de l'écran.
    return jsonb_build_object('ok', false, 'reason', 'line_not_active');
  end if;

  update public.order_lines
     set status = 'cancelled_by_client'
   where id = p_line_id
     and status = 'reserved';

  -- ⚠️ Aucun `update product_availability set booked = booked - …` ici, et ce n'est pas un oubli :
  -- une annulation client ne rend pas la place (cahier §7/A3). `cancel_order` porte la même
  -- absence, documentée de la même façon — ne pas « corriger » l'une au nom de l'autre.

  -- La propagation vers LobbyPMS n'est PAS appelée d'ici : un trigger `for each statement` sur
  -- order_lines (20260827160000) enfile le booking, et sa garde est écrite PAR BOOKING — il
  -- n'enfile que s'il ne reste plus aucune ligne `reserved` partageant le même `pms_booking_id`.
  -- Comme les activités héritent du booking de l'hébergement, annuler une activité n'annule donc
  -- pas la nuit d'hôtel. Aucune ligne à changer ici, mais ce chemin n'avait jamais tourné ligne par
  -- ligne (avec cancel_order, toutes mouraient dans la même instruction) : cancel_order_line.test.sql
  -- le prouve en deux assertions plutôt que de le supposer.

  select count(*) into v_restantes
    from public.order_lines
   where order_id = v_order_id
     and status = 'reserved';

  -- `remaining_active_lines` A UN LECTEUR : c'est lui qui fait dire à la confirmation de l'écran
  -- « après ça, toute la réservation est annulée » quand il vaudra 0 au prochain geste. Aucun champ
  -- n'est rendu ici sans consommateur.
  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'remaining_active_lines', v_restantes
  );
end;
$$;

-- Le revoke d'abord : PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction neuve, et
-- l'`alter default privileges` du projet accorde NOMMÉMENT à `anon` — qu'un revoke sur `public`
-- seul ne retire pas (piège payé par la spec 33, .claude/rules/supabase.md).
revoke all on function public.cancel_order_line(uuid) from public, anon, authenticated;
grant execute on function public.cancel_order_line(uuid) to authenticated;

comment on function public.cancel_order_line(uuid) is
  'Annule UNE prestation d''une commande, jamais la commande entière (spec 34 décision ⑤, '
  '2026-09-11 — renverse le cahier client §2c et remplace cancel_order, supprimée en Tranche 4). '
  'Garde stricte : account_id = auth.uid(), et refus explicite d''une session anonyme (décision ⑨). '
  'Ligne inexistante ou d''un autre compte → la même réponse line_not_found. Ne rend jamais la '
  'place (cahier §7/A3). La propagation LobbyPMS passe par le trigger de 20260827160000, dont la '
  'garde par booking empêche qu''annuler une activité annule la nuit qui partage son booking.';
