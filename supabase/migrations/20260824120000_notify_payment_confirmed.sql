-- Spec 23 Tranche 2 (docs/specs/23-notifications-email-transactionnelles.md) — 3 notifications
-- après confirmation de paiement : commission attribuée (référent externe), paiement effectué
-- (partenaire propriétaire), confirmation de réservation (client). Corps copié VERBATIM depuis
-- pg_get_functiondef(apply_payment_webhook) — seule source de vérité, cette fonction n'a jamais
-- été redéfinie depuis 20260818220000. Signature INCHANGÉE.
--
-- Branchement retenu (spec 23 §10 point 2) : dans la branche p_status='approved', APRÈS l'update
-- orders.payment_status='paid' — jamais dans create_order (qui insère la ligne ledger_entries AVANT
-- tout paiement réel), pour ne jamais notifier un revenu qui peut ne pas se matérialiser. La garde
-- d'idempotence déjà existante (already_applied, ci-dessus) protège aussi les 3 nouveaux enqueue :
-- un webhook rejoué après approbation ne les atteint jamais.
--
-- Isolation (spec 23 §8.1/§8.2) : chacun des 3 enqueue — et chaque itération des deux boucles par
-- compte distinct — est isolé individuellement (`when others`/`when query_canceled`), jamais un
-- seul bloc autour de tout le bloc Tranche 2 : un partenaire en échec ne doit jamais empêcher les
-- autres destinataires de recevoir leur email, et surtout jamais faire échouer la confirmation
-- d'un paiement Mercado Pago réel — la fonction la plus sensible du projet (grant service_role
-- seul, aucun garde interne, cf. commentaire déjà présent plus bas).
create or replace function apply_payment_webhook(
  p_mp_payment_id text,
  p_external_reference uuid,
  p_status text,
  p_raw_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_order record;
  v_referrer_account record;
  v_owner_account record;
  v_order_summary text;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'cancelled') then
    raise exception 'statut de paiement Mercado Pago inconnu : %', p_status;
  end if;

  select id, order_id, status into v_payment
    from public.payments
   where id = p_external_reference
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotent par construction : un webhook dupliqué ou reçu hors-ordre après approbation est un
  -- no-op — Mercado Pago retente un webhook qui ne renvoie pas 2xx, un no-op DOIT donc renvoyer
  -- ok:true (jamais une erreur), sans quoi le Route Handler entrerait en boucle de retry infinie.
  if v_payment.status = 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already_applied');
  end if;

  update public.payments
     set status = p_status, mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
   where id = v_payment.id;

  if p_status = 'approved' then
    update public.orders set payment_status = 'paid' where id = v_payment.order_id;

    -- (a) commission attribuée — un email par compte du/des référent(s) externe(s) distinct(s).
    for v_referrer_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.partner_accounts pa on pa.partner_id = ol.referrer_partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id and ol.commission_case = 'external_referrer'
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
          'Nueva comisión asignada',
          '<p>Se te asignó una comisión por una reserva confirmada.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
      end;
    end loop;

    -- (b) paiement effectué — un email par compte du/des partenaire(s) propriétaire(s) distinct(s)
    -- des produits commandés (spec 23 §10 point 8 : lecture retenue, à confirmer par Jérôme).
    for v_owner_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.partner_accounts pa on pa.partner_id = p.partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_payment_confirmed', v_owner_account.email, v_owner_account.account_id,
          'Pago confirmado',
          '<p>Se confirmó el pago de una reserva en tu establecimiento.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification paiement annulée (query_canceled) pour compte % — %', v_owner_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification paiement pour compte % — %', v_owner_account.account_id, sqlerrm;
      end;
    end loop;

    -- (c) confirmation de réservation au client — un seul email par commande (spec 23 §10 point 13 :
    -- langue ES, lien vers /orders/[id]/status non ajouté en v1, à confirmer par Jérôme).
    begin
      select holder_name, holder_email into v_order from public.orders where id = v_payment.order_id;

      select string_agg(
        '<li>' || coalesce(p.name ->> 'es', 'Producto') || ' — ' || ol.date
          || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
        ''
      ) into v_order_summary
      from public.order_lines ol join public.products p on p.id = ol.product_id
      where ol.order_id = v_payment.order_id;

      perform public.enqueue_notification_email(
        'client_order_confirmed', v_order.holder_email, null,
        'Reserva confirmada',
        '<p>Hola ' || coalesce(v_order.holder_name, '') || ', tu reserva fue confirmada:</p>'
          || '<ul>' || coalesce(v_order_summary, '') || '</ul>',
        'orders', v_payment.order_id
      );
    exception
      when query_canceled then
        raise warning 'apply_payment_webhook: notification client annulée (query_canceled) pour commande % — %', v_payment.order_id, sqlerrm;
      when others then
        raise warning 'apply_payment_webhook: échec notification client pour commande % — %', v_payment.order_id, sqlerrm;
    end;
  elsif p_status in ('rejected', 'cancelled') then
    update public.orders set payment_status = 'unpaid' where id = v_payment.order_id;
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$$;

-- Grant service_role UNIQUEMENT, jamais authenticated/anon — invariant CRITIQUE inchangé (cf.
-- commentaire complet dans 20260818220000_apply_payment_webhook.sql, non répété ici) : cette
-- fonction n'a AUCUN moyen de vérifier son appelant au niveau SQL, toute la sécurité vient de la
-- vérification HMAC faite en amont côté Route Handler.
revoke execute on function apply_payment_webhook(text, uuid, text, jsonb) from public;
grant execute on function apply_payment_webhook(text, uuid, text, jsonb) to service_role;
