-- CORRECTIF DE SÉCURITÉ — `create_payment_intent` acceptait un appelant SANS AUCUNE SESSION sur la
-- commande d'un autre compte.
--
-- Trouvé le 2026-09-09 en auditant la surface de `authenticated` avant la spec « identité anonyme »,
-- puis REPRODUIT à la main contre la base locale (rôle `anon`, aucun JWT, commande d'un autre
-- compte) : {"ok": true, "amount_cop": 45000, "payer_email": "<email du titulaire>"}.
--
-- Trois effets constatés, tous refermés ici :
--   * fuite de PII      — l'email du titulaire était renvoyé à l'appelant ;
--   * écriture          — une ligne `payments` 'pending' créée sur la commande d'autrui, et
--                         `orders.payment_status` basculé ;
--   * déni de service   — l'idempotence `payment_already_pending` empêchait ensuite le VRAI
--                         titulaire de créer son propre intent.
-- Il faut connaître l'UUID de la commande, mais ces UUID circulent (liens du tunnel, emails).
--
-- ⚠️ Le correctif consiste à RETIRER une condition, pas à en ajouter : `v_account_id is not null and`
-- désarmait la garde dès que l'appelant n'avait pas de session. Rien d'autre ne change, et le
-- parcours invité est préservé à l'identique (cf. le commentaire dans le corps).
--
-- Checklist (CLAUDE.md §3) : la fonction reste `security definer` + `set search_path = ''`, garde son
-- `grant execute`, ne touche aucune table, aucune policy. Ce n'est pas une opération critique au sens
-- du §4.1 (elle ne décrémente aucune capacité — create_order l'a déjà fait) : pas de test de
-- concurrence requis. Couverte par `supabase/tests/database/payments.test.sql` cas 5bis, ajouté du
-- même geste — sans lui, ce correctif serait un souhait (§11.20).

CREATE OR REPLACE FUNCTION public.create_payment_intent(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_order_account_id uuid;
  v_payer_email text;
  v_existing_status text;
  v_amount_cop bigint;
  v_payment_id uuid;
begin
  select account_id, holder_email into v_order_account_id, v_payer_email
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- 2026-09-09 — CORRECTIF DE SÉCURITÉ. La condition `v_account_id is not null and` a été RETIRÉE :
  -- elle désarmait la garde pour tout appelant SANS session. Prouvé en réel sous le rôle `anon`
  -- sans aucun JWT, sur la commande d'un autre compte : retour {"ok": true, "amount_cop": 45000,
  -- "payer_email": "<email du titulaire>"} — donc fuite de PII, écriture d'une ligne `payments`
  -- 'pending' et bascule de `orders.payment_status` sur la commande d'autrui, plus un déni de
  -- service (l'idempotence `payment_already_pending` empêchait ensuite le VRAI titulaire de créer
  -- son intent). Le test pgTAP couvrait « un autre compte AUTHENTIFIÉ » (cas 5) et passait : c'est
  -- le cas sans session qui n'était testé nulle part (CLAUDE.md §11.20). Cas 5bis ajouté.
  --
  -- `is distinct from` traite NULL correctement : appelant sans session (v_account_id null) sur une
  -- commande qui A un propriétaire → distinct → refusé. Ce qui reste ouvert, DÉLIBÉRÉMENT et sans
  -- changement : une commande INVITÉ (v_order_account_id null) reste payable par le porteur de son
  -- order_id — c'est le parcours invité d'aujourd'hui (CheckoutForm appelle cette RPC depuis le
  -- navigateur juste après create_order). L'identité anonyme refermera ce dernier cas d'elle-même :
  -- toute commande portera alors un account_id.
  if v_order_account_id is not null and v_order_account_id is distinct from v_account_id then
    -- Même réponse qu'une commande inexistante, jamais un refus distinct qui confirmerait
    -- l'existence d'une commande d'un autre compte (même logique que cancel_order).
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select status into v_existing_status
    from public.payments
   where order_id = p_order_id and status in ('pending', 'approved')
   order by created_at desc
   limit 1
   for update;

  if v_existing_status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;
  if v_existing_status = 'pending' then
    -- Idempotence métier (spec §0 Tranche 1) : jamais un second intent tant que le premier n'a pas
    -- été refusé/annulé/expiré — pas de double-clic "payer" créant deux payments 'pending'.
    return jsonb_build_object('ok', false, 'reason', 'payment_already_pending');
  end if;

  -- Seulement les lignes ENCORE actives (status = 'reserved') : une ligne déjà superseded par
  -- modify_order_line, ou déjà annulée/expirée, ne doit jamais gonfler l'acompte demandé — même
  -- discipline que cancel_order (« seulement les lignes ENCORE actives »).
  select coalesce(sum(acompte_cop), 0) into v_amount_cop
    from public.order_lines
   where order_id = p_order_id and status = 'reserved';

  if v_amount_cop <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_pay');
  end if;

  insert into public.payments (order_id, amount_cop, payer_email)
  values (p_order_id, v_amount_cop, v_payer_email)
  returning id into v_payment_id;

  update public.orders set payment_status = 'pending' where id = p_order_id;

  return jsonb_build_object(
    'ok', true, 'payment_id', v_payment_id, 'amount_cop', v_amount_cop, 'payer_email', v_payer_email
  );
end;
$function$;
