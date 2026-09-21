-- Durcissement de apply_payment_webhook — incident HFG-000013 du 2026-09-20 (docs/journal/2026-09.md).
--
-- Ce que ça corrige, mesuré en réel : le premier vrai paiement Checkout Pro a été encaissé par
-- Mercado Pago, puis la commande a été annulée par `expire_stale_payment_orders` (le webhook ne
-- passait pas la signature, piège 19). Sur cet état — `payments.status = 'cancelled'`, lignes
-- `expired` — la version précédente de cette fonction (20260910190000) ne court-circuitait que sur
-- `approved` : une retentative Mercado Pago aurait réécrit le paiement `approved`, passé la commande
-- `paid` et envoyé 3 e-mails « reserva confirmada » pour des prestations expirées. Une COMMANDE
-- FANTÔME, sans aucune garde, et aucun chemin de remboursement pour la rattraper.
--
-- Trois défauts fermés ici, sans décision produit (l'unification réconciliation/expiration, le
-- plafond des `pending` et le chemin de remboursement restent un arbitrage de Jérôme —
-- docs/specs/39-garantie-confirmation-paiement.md) :
--
-- 1. ORDRE DES VERROUS. La fonction ne posait qu'un seul verrou, sur `payments`, puis écrivait
--    `orders` (verrou implicite de l'UPDATE) ; le cron `expire_stale_payment_orders` verrouille un
--    lot d'`orders` (`for update of o`) PUIS écrit `payments`. Deux ordres inverses = interblocage
--    possible. Règle désormais unique dans ce dépôt, à respecter par toute fonction qui touche les
--    deux tables : **`orders` d'abord, toujours** (create_payment_intent, release_order_after_pms_
--    refusal et le cron la respectent déjà — vérifié le 2026-09-20). Ici : lecture non verrouillante
--    de `order_id`, `select … from orders … for update`, puis `payments … for update`.
--
-- 2. GARDE « RIEN À HONORER ». Un `approved` est refusé — sans toucher `payments.status` ni
--    `orders.payment_status`, sans aucun e-mail — quand (a) le paiement est déjà `cancelled` (le cron
--    est passé), OU (b) la commande n'a plus aucune ligne vivante ou consommée
--    (`reserved`/`fulfilled`/`no_show` — une prestation déjà réalisée reste honorable :
--    set_order_line_status ne conditionne pas `fulfilled` au paiement), OU (c) un AUTRE paiement de
--    la même commande est déjà `approved` (double paiement : carte refusée puis retentée dans la
--    même session Checkout Pro sous l'`external_reference` P1, alors que P2 a déjà été payé — cette
--    fonction ne lisait jamais les autres `payments` de la commande). L'argent est encaissé chez
--    Mercado Pago : une entrée `payment_reconciliation_entries` de `kind = 'refund_required'` est
--    créée (le trigger existant notifie les admins), le `mp_payment_id` et l'événement brut sont
--    conservés sur le paiement pour le remboursement futur, et la fonction répond `{ok:true,
--    reason:'paid_after_expiry'|'double_payment'}` — un 200 côté Route Handler, donc Mercado Pago ne
--    retente pas. Le motif (`failure_reason`) est dérivé des statuts réels des lignes, jamais
--    supposé « expiration » (une annulation client avant paiement produit le même état).
--
-- 3. IDEMPOTENCE DE LA GARDE. Mercado Pago livre `payment.created` PUIS `payment.updated` pour un
--    même paiement approuvé (deux livraisons en régime nominal), puis retente pendant des heures si
--    la première réponse dépasse 22 s. Sans clé d'unicité, chaque livraison créerait une entrée et
--    donc une salve d'e-mails à tous les admins (trigger `for each row`, sans dédup — c'est la
--    « bombe d'e-mails » du 2026-09-20). Index unique partiel sur `(mp_payment_id) where kind =
--    'refund_required'` + `on conflict … do nothing` : une entrée par paiement Mercado Pago, point.
--
-- Deux gardes de bord ajoutées dans le même geste :
-- 4. Après une approbation réussie, les autres `payments` de la commande encore `pending`/`rejected`
--    passent `cancelled` : un P1 `rejected` retenté plus tard tombe dans la garde 2c (double paiement)
--    au lieu d'être appliqué une seconde fois.
-- 5. Un `pending`/`rejected`/`cancelled` reçu sur un paiement déjà `cancelled` est un no-op
--    (`already_cancelled`) — un PSE tardif ne ressuscite pas une commande morte ; et un
--    `rejected`/`cancelled` ne rétrograde jamais `orders.payment_status` à `unpaid` si un AUTRE
--    paiement de la commande est encore `pending` ou `approved`.
--
-- ⚠️ SIGNATURE INCHANGÉE — `create or replace` seul, JAMAIS un `drop function` ici : cette fonction
-- est grantée à `service_role` UNIQUEMENT et n'a aucun garde interne (20260910190000, en-tête). Un
-- `drop` la rouvrirait à `anon`/`authenticated` par les default privileges. Aucun grant retouché.
--
-- ⚠️ Corps repris de `pg_get_functiondef` sur la base locale (identique octet pour octet au fichier
-- 20260910190000, vérifié par diff le 2026-09-20), jamais retapé. Modifications COMPTÉES : (1) le
-- bloc de verrouillage, (2)+(3) le bloc de garde inséré avant l'UPDATE de `payments`, (4) après
-- `update orders set payment_status = 'paid'`, (5) le court-circuit `already_cancelled` et la clause
-- `not exists` de la branche rejected/cancelled. Les blocs e-mail (a)(b)(c) sont intacts.
--
-- Tests : supabase/tests/database/payments.test.sql (cas 28-38, vérifiés par mutation),
-- tests/concurrency/apply_payment_webhook_vs_expiry.concurrency.mjs (ordre des verrous).

-- --------------------------------------------------------------------------------------------
-- payment_reconciliation_entries.kind — le seul discriminant existant était `failure_reason`,
-- une phrase libre écrite par le Route Handler : rien ne permettait de distinguer « signature
-- invalide » (bruit) de « argent encaissé sans prestation » (action requise). Valeur machine,
-- lue par l'écran admin et les tests.
-- --------------------------------------------------------------------------------------------
alter table public.payment_reconciliation_entries
  add column kind text not null default 'webhook_failure'
    check (kind in ('webhook_failure', 'refund_required'));

create unique index payment_reconciliation_entries_refund_required_mp_payment_idx
  on public.payment_reconciliation_entries (mp_payment_id)
  where kind = 'refund_required';

-- --------------------------------------------------------------------------------------------
-- apply_payment_webhook
-- --------------------------------------------------------------------------------------------
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
  -- Ajout 20260920120000 (durcissement) :
  v_order_id uuid;
  v_has_honorable_line boolean;
  v_other_approved_payment_id uuid;
  v_refund_code text;
  v_refund_reason text;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'cancelled') then
    raise exception 'statut de paiement Mercado Pago inconnu : %', p_status;
  end if;

  -- (1) ORDRE DES VERROUS : `orders` d'abord, toujours (cf. en-tête) — lecture non verrouillante de
  -- la commande, verrou sur `orders`, PUIS verrou sur `payments`, dont le statut est relu après.
  select order_id into v_order_id
    from public.payments
   where id = p_external_reference;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  perform 1 from public.orders where id = v_order_id for update;

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

  -- (5) Un paiement `cancelled` (par le cron d'expiration) ne bouge plus, sauf pour un `approved`
  -- qui est traité par la garde (2) ci-dessous : un `pending` PSE tardif, un `rejected` en retard
  -- ne ressuscitent jamais une commande morte.
  if v_payment.status = 'cancelled' and p_status <> 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already_cancelled');
  end if;

  -- (2) GARDE « RIEN À HONORER » — cf. en-tête, points (a) (b) (c).
  if p_status = 'approved' then
    select exists (
      select 1 from public.order_lines ol
       where ol.order_id = v_payment.order_id
         and ol.status in ('reserved', 'fulfilled', 'no_show')
    ) into v_has_honorable_line;

    select id into v_other_approved_payment_id
      from public.payments
     where order_id = v_payment.order_id
       and status = 'approved'
       and id <> v_payment.id
     limit 1;

    if v_other_approved_payment_id is not null then
      v_refund_code := 'double_payment';
      v_refund_reason := 'double paiement : la commande est déjà payée par le paiement '
        || v_other_approved_payment_id;
    elsif v_payment.status = 'cancelled' or not v_has_honorable_line then
      v_refund_code := 'paid_after_expiry';
      v_refund_reason := case
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'expired')
          then 'paiement approuvé après expiration de la commande'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_client')
          then 'paiement approuvé après annulation par le client'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_provider')
          then 'paiement approuvé après annulation par le prestataire'
        else 'paiement approuvé sans aucune prestation à honorer'
      end;
    end if;

    if v_refund_code is not null then
      -- L'argent est chez Mercado Pago : on garde de quoi le rembourser (identifiant MP, événement
      -- brut), sans jamais toucher au statut du paiement ni à celui de la commande.
      update public.payments
         set mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;

      -- (3) Une seule entrée par paiement Mercado Pago, quel que soit le nombre de livraisons.
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event, v_refund_reason,
        'refund_required'
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;

      return jsonb_build_object('ok', true, 'reason', v_refund_code);
    end if;
  end if;

  update public.payments
     set status = p_status, mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
   where id = v_payment.id;

  if p_status = 'approved' then
    update public.orders set payment_status = 'paid' where id = v_payment.order_id;

    -- (4) Les autres paiements de cette commande n'ont plus lieu d'être : un `rejected` retenté
    -- plus tard chez Mercado Pago tombera dans la garde (2c) au lieu d'être appliqué à son tour.
    update public.payments
       set status = 'cancelled', updated_at = now()
     where order_id = v_payment.order_id
       and id <> v_payment.id
       and status in ('pending', 'rejected');

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
    -- (5) Jamais rétrograder une commande qu'un AUTRE paiement porte encore (pending) ou a déjà
    -- réglée (approved) — une notification `rejected` en retard sur P1 ne doit pas effacer P2.
    update public.orders
       set payment_status = 'unpaid'
     where id = v_payment.order_id
       and not exists (
         select 1 from public.payments other
          where other.order_id = v_payment.order_id
            and other.id <> v_payment.id
            and other.status in ('pending', 'approved')
       );
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$function$;

-- --------------------------------------------------------------------------------------------
-- notify_admin_new_reconciliation_exception — l'e-mail admin est, pour une entrée
-- `refund_required`, le SEUL signal humain qu'un client a payé pour rien tant que l'écran n'a pas
-- été ouvert. Deux défauts fermés : (a) le lien était RELATIF (`/admin/reconciliation`), donc mort
-- dans toute boîte mail — il passe par le secret Vault `admin_app_public_url`, même patron que
-- l'invitation partenaire (20260824040000) ; (b) une exception de paiement se présentait sans
-- numéro de commande ni montant. Le détail (`failure_reason`, `raw_event`) reste réservé à
-- l'écran, comme le prescrit la spec 23 §3 — l'e-mail nomme, il ne raconte pas.
-- Corps repris de pg_get_functiondef (2026-09-20) ; trois sites modifiés : lecture du secret,
-- libellé de la branche paiement, sujet distinct pour `refund_required`.
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admin_new_reconciliation_exception()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_label text;
  v_subject text;
  v_body text;
  v_app_base_url text;
begin
  begin
    -- Lien absolu : sans le secret, on retombe sur le chemin relatif (jamais un e-mail en moins).
    select decrypted_secret into v_app_base_url
      from vault.decrypted_secrets where name = 'admin_app_public_url';
    if v_app_base_url is null then
      raise warning 'notify_admin_new_reconciliation_exception: secret Vault admin_app_public_url manquant — lien relatif dans l''e-mail';
    end if;

    if tg_table_name = 'pms_reconciliation_entries' then
      select coalesce(p.name ->> 'es', 'Producto sin nombre')
        into v_label
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.id = new.order_line_id;
      v_subject := 'Nueva excepción de reconciliación PMS';
    else
      -- payment_id nullable (spec 23 §9, cas limite) : un webhook peut échouer avant même d'être
      -- corrélé à un payments connu — libellé générique plutôt qu'un crash de construction.
      select 'Pedido ' || o.reference || ' de ' || o.holder_name || ' — ' || pay.amount_cop || ' COP'
        into v_label
        from public.payments pay
        join public.orders o on o.id = pay.order_id
       where pay.id = new.payment_id;
      v_label := coalesce(v_label, 'Pedido no identificado');
      if new.kind = 'refund_required' then
        v_subject := 'Pago recibido sin reserva que honrar — reembolso requerido';
      else
        v_subject := 'Nueva excepción de reconciliación de pago';
      end if;
    end if;

    v_body := '<p>' || coalesce(v_label, 'Sin identificar') || '</p>'
      || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/reconciliation">Ver reconciliaciones pendientes</a></p>';

    perform public.notify_all_admins(
      'admin_new_reconciliation_exception', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_reconciliation_exception: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_reconciliation_exception: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$function$;
