-- Spec 19 §0 Tranche 0 — set_order_line_status (feature 10, 20260814170000) étendue de trois façons :
--
-- 1. Élargissement d'autorisation : le prestataire (operator) peut désormais marquer lui-même,
--    depuis son espace socio, qu'un client n'est pas venu (transition no_show UNIQUEMENT, scopée à
--    ses propres établissements via has_capability). Toute autre transition reste strictement
--    admin-only, inchangé.
--
-- 2. Gap de sécurité corrigé (trouvé en écrivant la spec 19, pas un point à trancher) : aucune
--    garde sur le statut de départ jusqu'ici — une ligne déjà `fulfilled` pouvait être rebasculée
--    vers n'importe quel autre statut terminal sans contrôle. Sans conséquence financière tant
--    qu'aucun ledger n'existait (le commentaire d'origine le disait explicitement) ; devient une
--    vraie faille maintenant que cette même transition écrit le ledger (point 3) et, en Tranche 2
--    de la spec 19, déclenche un remboursement réel. Même patron que modify_order_line : refuse si
--    le statut de départ n'est pas 'reserved'.
--
-- 3. Écriture du ledger par transition (le cahier des charges dit « chaque transition écrit le
--    ledger et l'audit » — seul l'audit était branché jusqu'ici, cf. commentaire d'origine « le
--    ledger n'existe pas encore »). Seules les lignes external_referrer ont quelque chose à
--    transitionner (referrer_commission_cop > 0) — self_referral/direct n'ont jamais d'entrée
--    ledger_entries créée par create_order, rien à faire ici pour elles.
--
-- Écart assumé au patron habituel : `log_admin_action` (20260813201000) est elle-même gardée
-- `is_admin(auth.uid())` en interne — un appel operator lèverait son exception et annulerait toute
-- la transition, y compris la transition no_show légitime qu'on vient d'autoriser au point 1. On
-- écrit donc directement dans audit_log ci-dessous (même insert que log_admin_action fait en
-- interne), plutôt que de rouvrir log_admin_action elle-même — c'est un chokepoint partagé par
-- toutes les RPC admin du projet, son rayon d'effet dépasse cette seule spec (cf.
-- AGENTS-PARALLELES.md point 6) ; l'autorisation métier reste entièrement vérifiée juste avant,
-- dans cette fonction-ci, donc l'insert direct ne réintroduit aucun trou de contrôle.
-- apply_order_line_ledger_transition — logique de transition ledger factorisée : jusqu'ici recopiée
-- au mot près à deux endroits (le CASE ci-dessous, ET expire_stale_payment_orders_job, 20260818230000,
-- qui ne peut pas passer par la RPC set_order_line_status elle-même — celle-ci exige
-- is_admin(auth.uid()) qu'un job système/cron ne peut jamais satisfaire, aucune session). Un seul
-- endroit désormais, appelé par les deux.
--
-- Signature en tableau (p_order_line_ids uuid[]), pas un seul uuid : set_order_line_status l'appelle
-- avec un tableau à un seul élément (comportement ligne par ligne inchangé) ; le job cron l'appelle
-- UNE SEULE FOIS avec tout le lot de lignes venant d'expirer dans ce run (cf. 20260818230000 —
-- finding séparé sur ce même fichier : la boucle par commande y devient un update set-based sur tout
-- le lot verrouillé, pas un appel par ligne — ce paramètre en tableau permet aux deux correctifs de
-- coexister sans réintroduire un aller-retour par ligne côté cron).
--
-- Chaque branche filtre explicitement `ol.referrer_commission_cop > 0` (même garde que l'ancien
-- `if v_referrer_commission_cop > 0 then` qui enveloppait tout le CASE dans set_order_line_status) :
-- self_referral/direct n'ont jamais d'entrée ledger_entries créée par create_order (referrer_pct = 0).
-- Pour les branches UPDATE seules (fulfilled/cancelled_by_provider/expired), ce filtre est redondant
-- avec le fait qu'aucune ligne 'estimated'/'referrer' n'existe pour ces lignes de toute façon — gardé
-- explicite plutôt que supposé, par robustesse. Pour la branche no_show/cancelled_by_client en
-- revanche, il est INDISPENSABLE : elle INSÈRE une compensation établissement, et sans ce filtre par
-- ligne un appel en lot sur un mélange de lignes external_referrer et direct/self insérerait une
-- ligne établissement fantôme (amount_cop nul) pour les lignes direct/self — jamais créée avant ce
-- correctif (l'ancienne version ne traitait jamais qu'une seule ligne à la fois, déjà filtrée en tête
-- de fonction).
--
-- Interne : AUCUN grant à anon/authenticated/service_role, jamais appelée directement depuis un
-- client — seul un appelant SECURITY DEFINER qui partage déjà le même propriétaire (set_order_line_status,
-- expire_stale_payment_orders) peut l'invoquer ; le propriétaire d'une fonction a toujours tous les
-- droits dessus, aucun grant explicite requis (cf. hifago/CLAUDE.md §11 point 1).
create or replace function apply_order_line_ledger_transition(
  p_order_line_ids uuid[],
  p_new_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_new_status = 'fulfilled' then
    update public.ledger_entries le
       set status = 'due'
      from public.order_lines ol
     where le.order_line_id = ol.id
       and ol.id = any(p_order_line_ids)
       and ol.referrer_commission_cop > 0
       and le.beneficiary_type = 'referrer'
       and le.status = 'estimated';

  elsif p_new_status in ('no_show', 'cancelled_by_client') then
    -- La part référent n'est due que si la ligne est réalisée (spec client §7/A3) — sinon
    -- redirigée vers l'établissement, en compensation du créneau bloqué pour rien.
    update public.ledger_entries le
       set status = 'void'
      from public.order_lines ol
     where le.order_line_id = ol.id
       and ol.id = any(p_order_line_ids)
       and ol.referrer_commission_cop > 0
       and le.beneficiary_type = 'referrer'
       and le.status = 'estimated';

    insert into public.ledger_entries (
      order_line_id, beneficiary_type, establishment_id, entry_type, amount_cop, status
    )
    select ol.id, 'establishment', p.establishment_id, 'establishment_compensation',
           ol.referrer_commission_cop, 'due'
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.id = any(p_order_line_ids)
       and ol.referrer_commission_cop > 0;

  elsif p_new_status = 'cancelled_by_provider' then
    -- Câblé pleinement en spec 19 Tranche 2 (remboursement) — ici, seule la part ledger : plus
    -- aucune commission due, référent compris (rien n'a été vendu).
    update public.ledger_entries le
       set status = 'reversed'
      from public.order_lines ol
     where le.order_line_id = ol.id
       and ol.id = any(p_order_line_ids)
       and ol.referrer_commission_cop > 0
       and le.beneficiary_type = 'referrer'
       and le.status in ('estimated', 'due');

  elsif p_new_status = 'expired' then
    update public.ledger_entries le
       set status = 'void'
      from public.order_lines ol
     where le.order_line_id = ol.id
       and ol.id = any(p_order_line_ids)
       and ol.referrer_commission_cop > 0
       and le.beneficiary_type = 'referrer'
       and le.status = 'estimated';
  end if;
end;
$$;

-- Interne, aucune autorisation vérifiée dans le corps de cette fonction (elle fait confiance à
-- l'appelant — set_order_line_status, expire_stale_payment_orders — pour avoir déjà validé
-- transition/rôle avant d'appeler) : contrairement à log_admin_action (is_admin vérifié EN
-- INTERNE), une absence de grant ne suffit PAS à la rendre réellement inaccessible — PostgreSQL
-- accorde EXECUTE à PUBLIC par défaut à la création d'une fonction, indépendamment de
-- ALTER DEFAULT PRIVILEGES (qui ne couvre que les tables ici, cf. identity_rls.sql). Sans ce
-- revoke explicite, n'importe quel rôle authenticated/anon pourrait appeler cette fonction
-- directement et manipuler le statut de ledger_entries sur une ligne arbitraire, en contournant
-- entièrement la garde admin/operator de set_order_line_status — même précédent déjà posé sur
-- apply_payment_webhook (20260818220000).
revoke execute on function apply_order_line_ledger_transition(uuid[], text) from public;

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
  v_is_admin boolean;
  v_establishment_id uuid;
begin
  v_is_admin := (select public.is_admin(auth.uid()));

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour une transition manuelle';
  end if;

  if p_new_status not in ('fulfilled', 'no_show', 'cancelled_by_client',
                           'cancelled_by_provider', 'expired') then
    raise exception 'statut cible invalide : %', p_new_status;
  end if;

  select ol.status, p.establishment_id
    into v_before_status, v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id
   for update of ol;

  if not found then
    raise exception 'ligne de commande introuvable';
  end if;

  if not v_is_admin then
    if p_new_status <> 'no_show'
       or not (select public.has_capability(auth.uid(), 'operator', v_establishment_id)) then
      raise exception
        'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show uniquement)'
        using errcode = '42501';
    end if;
  end if;

  if v_before_status <> 'reserved' then
    raise exception 'transition refusée : la ligne n''est plus reserved (statut actuel : %)', v_before_status;
  end if;

  update public.order_lines set status = p_new_status where id = p_order_line_id;

  -- Transition ledger factorisée (cf. apply_order_line_ledger_transition ci-dessus) — même effet
  -- que l'ancien CASE inline, partagé désormais avec expire_stale_payment_orders_job.
  perform public.apply_order_line_ledger_transition(array[p_order_line_id], p_new_status);

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    (select auth.uid()), 'order_line.set_status', 'order_lines', p_order_line_id,
    jsonb_build_object('status', v_before_status), jsonb_build_object('status', p_new_status), p_reason
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_order_line_status(uuid, text, text) to authenticated;
