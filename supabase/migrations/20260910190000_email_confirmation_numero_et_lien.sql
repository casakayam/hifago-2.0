-- Spec 33 Tranche 4 — l'email de confirmation porte enfin le NUMÉRO et le LIEN.
--
-- Ce que ça corrige : l'email `client_order_confirmed` partait bien sur un paiement approuvé, avec
-- le détail des lignes — mais SANS numéro de commande et SANS aucun moyen de revenir. Pour un
-- client sans compte, c'était un cul-de-sac : il avait payé, et ne possédait rien pour retrouver sa
-- réservation. Le code lui-même portait le report en commentaire depuis le 2026-08-24.
--
-- ⚠️ SIGNATURE INCHANGÉE — `create or replace` seul, JAMAIS un `drop function` ici. Cette fonction
-- est grantée à `service_role` UNIQUEMENT et n'a aucun garde interne : toute sa sécurité tient à ce
-- grant (la vérification HMAC se fait en amont, dans le Route Handler). Un `drop` le perdrait et
-- rouvrirait la fonction à `anon`/`authenticated` par les default privileges du projet — le piège
-- exact documenté dans `.claude/rules/supabase.md`. Aucun grant n'est donc retouché ci-dessous, et
-- c'est volontaire.
--
-- ⚠️ Le lien vient du VAULT (`web_app_public_url`), patron déjà en place dans ce dépôt — cf. le
-- commentaire au point (c) ci-dessous pour pourquoi un jeton de gabarit a été écarté.
--
-- ⚠️ Corps repris de `pg_get_functiondef` sur la base locale — ce qui TOURNE réellement, jamais
-- retapé de mémoire (règle 7 de `.claude/rules/supabase.md`). Un seul bloc change : (c),
-- la notification client. Les blocs (a) commission et (b) paiement partenaire sont intacts.

CREATE OR REPLACE FUNCTION public.apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  v_order record;
  v_referrer_account record;
  v_owner_account record;
  v_order_summary text;
  v_site_url text;
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

    -- (c) confirmation de réservation au client — un seul email par commande.
    --
    -- ⚠️ SPEC 33 : CET EMAIL PORTE DÉSORMAIS LE NUMÉRO ET LE LIEN. Le commentaire qu'il remplace
    -- disait « lien vers /orders/[id]/status non ajouté en v1, à confirmer par Jérôme » — c'est
    -- confirmé et tranché (cahier client §2b.9, 2026-09-07) : l'adresse de la commande « part aussi
    -- dans l'email de confirmation, ce qui la rend retrouvable des mois plus tard ». Pour un client
    -- sans compte, cet email EST le canal de suivi : le WhatsApp pré-rempli a été retiré le même
    -- jour, et la zone tunnel n'a pas de pied de page.
    --
    -- ⚠️ L'URL publique du site vient du VAULT, comme `admin_app_public_url` pour l'email
    -- d'invitation partenaire (20260824040000) et `pms_functions_base_url` pour les crons
    -- (20260819140000). Une première version de la spec 33 avait inventé un jeton de gabarit
    -- `{{SITE_URL}}` résolu à l'envoi par l'Edge Function, en justifiant que « Postgres ne connaît
    -- pas l'URL publique du site » — c'était FAUX : ce dépôt a déjà ce mécanisme, pour exactement
    -- cette raison (« seedée par environnement, jamais une valeur en dur, elle diffère
    -- local/preprod/prod »). Deux patrons concurrents pour mettre un lien dans un email, c'est un
    -- de trop.
    --
    -- ⚠️ DIFFÉRENCE ASSUMÉE avec l'invitation partenaire : là-bas, un secret manquant fait SAUTER
    -- l'email (le lien reste affiché à l'écran, donc rien n'est perdu). Ici le client a PAYÉ et
    -- n'a plus l'écran sous les yeux : on envoie la confirmation dans tous les cas, avec le lien
    -- si le secret existe, sans lui sinon. Un email de confirmation sans lien reste utile ; pas
    -- d'email du tout ne l'est pas.
    begin
      select holder_name, holder_email, reference, access_token into v_order
        from public.orders where id = v_payment.order_id;

      select decrypted_secret into v_site_url
        from vault.decrypted_secrets where name = 'web_app_public_url';
      if v_site_url is null then
        raise warning 'apply_payment_webhook: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', v_payment.order_id;
      end if;

      select string_agg(
        '<li>' || coalesce(p.name ->> 'es', 'Producto') || ' — ' || ol.date
          || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
        ''
      ) into v_order_summary
      from public.order_lines ol join public.products p on p.id = ol.product_id
      where ol.order_id = v_payment.order_id;

      perform public.enqueue_notification_email(
        'client_order_confirmed', v_order.holder_email, null,
        'Reserva ' || v_order.reference || ' confirmada',
        '<p>Hola ' || coalesce(v_order.holder_name, '') || ', tu reserva fue confirmada.</p>'
          || '<p>Número de reserva : <strong>' || v_order.reference || '</strong></p>'
          || '<ul>' || coalesce(v_order_summary, '') || '</ul>'
          || coalesce(
               '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">'
                 || 'Ver tu reserva</a> — guarda este enlace, puedes volver a abrirlo cuando quieras.</p>',
               ''
             ),
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
$function$
