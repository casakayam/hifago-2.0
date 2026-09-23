-- Lot B2 — spec 39 D3 : le chemin de remboursement, l'information du client, la décision humaine.
-- Table payment_refunds posée en B1 (20260921100000) ; ici les quatre RPC, le trigger d'e-mails
-- client, et les deux clés du contrat client. Arbitrage Jérôme du 2026-09-20 : détection
-- automatique + écran admin « Reembolsar »/« Resolver » + client prévenu immédiatement — jamais de
-- re-réservation automatique.
--
-- Qui parle à Mercado Pago : le job payments-reconcile (Edge Function), JAMAIS apps/admin (qui n'a
-- ni SDK ni token). L'admin ne fait qu'une RPC qui met la demande en file ; le job l'exécute au
-- tick suivant (≤ 2 min) avec X-Idempotency-Key = payment_refunds.id.
--
-- Le remboursement vise le paiement MP de l'ENTRÉE (payment_refunds.mp_payment_id), jamais la ligne
-- `payments` : sur un écart de montant ou un double paiement, `payments.mp_payment_id` porte un
-- autre paiement (ou rien). Et `payments.status`/`orders.payment_status` ne passent `refunded` QUE
-- si le paiement remboursé est celui qui a payé la commande — un double paiement remboursé laisse
-- la commande `paid` (attaque retenue de la revue adversariale).

-- ============================================================================================
-- 1. request_payment_refund — l'admin demande (authenticated + is_admin, motif obligatoire)
-- ============================================================================================
create function public.request_payment_refund(p_entry_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_payment record;
  v_amount bigint;
  v_refund_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'request_payment_refund réservé au rôle admin' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'motif obligatoire pour demander un remboursement';
  end if;

  select e.id, e.payment_id, e.mp_payment_id, e.kind, e.status, e.raw_event
    into v_entry
    from public.payment_reconciliation_entries e
   where e.id = p_entry_id
   for update;
  if not found then
    raise exception 'entrée introuvable';
  end if;
  if v_entry.kind <> 'refund_required' or v_entry.status not in ('open', 'retrying') then
    raise exception 'entrée non remboursable (kind %, statut %)', v_entry.kind, v_entry.status;
  end if;
  if v_entry.payment_id is null or v_entry.mp_payment_id is null then
    raise exception 'entrée sans paiement Mercado Pago identifié';
  end if;
  if exists (
    select 1 from public.payment_refunds r
     where r.entry_id = p_entry_id and r.status in ('pending', 'approved')
  ) then
    raise exception 'un remboursement est déjà en cours ou effectué pour cette entrée';
  end if;
  -- Un refus MP « déjà remboursé » est terminal : recliquer ne ferait qu'ouvrir une boucle de
  -- confusion humaine (le remboursement a eu lieu, dans le panel ou par un retry).
  if exists (
    select 1 from public.payment_refunds r
     where r.entry_id = p_entry_id and r.status = 'rejected'
       and r.last_error ilike '%already refunded%'
  ) then
    raise exception 'Mercado Pago indique que ce paiement est déjà remboursé — résoudre l''entrée avec une note';
  end if;

  select p.id, p.order_id, p.amount_cop into v_payment
    from public.payments p where p.id = v_entry.payment_id;

  -- Montant réellement encaissé chez MP (écart de montant compris), sinon l'acompte attendu. Le
  -- remboursement MP est intégral (POST /refunds sans `amount`) : ce chiffre sert à l'affichage et
  -- à la trace, pas à l'appel.
  v_amount := coalesce(
    nullif(round((v_entry.raw_event ->> 'transaction_amount')::numeric), 0)::bigint,
    v_payment.amount_cop
  );

  insert into public.payment_refunds (
    entry_id, payment_id, mp_payment_id, amount_cop, status, requested_by, note
  )
  values (p_entry_id, v_payment.id, v_entry.mp_payment_id, v_amount, 'pending', auth.uid(), btrim(p_note))
  returning id into v_refund_id;

  update public.payment_reconciliation_entries
     set status = 'retrying', attempts = attempts + 1, last_attempt_at = now()
   where id = p_entry_id;

  perform public.log_admin_action(
    'payment_refund.request', 'payment_refunds', v_refund_id, null, null, btrim(p_note)
  );

  return jsonb_build_object('ok', true, 'refund_id', v_refund_id, 'amount_cop', v_amount);
end;
$$;
revoke all on function public.request_payment_refund(uuid, text) from public, anon;
grant execute on function public.request_payment_refund(uuid, text) to authenticated;

-- ============================================================================================
-- 2. Le job : claim (bail de 10 min), finalize, fail (backoff 5 min × 2ⁿ, plafond 24 h — modèle
--    fail_pms_sync). Toutes service_role.
-- ============================================================================================
create function public.claim_payment_refunds(p_limit int default 10)
returns table (
  refund_id uuid,
  mp_payment_id text,
  amount_cop bigint,
  attempts int,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with cand as (
      select r.id from public.payment_refunds r
       where r.status = 'pending'
         and (r.next_attempt_at is null or r.next_attempt_at <= now())
       order by r.created_at
       limit p_limit
       for update skip locked
    )
    update public.payment_refunds r
       set attempts = r.attempts + 1,
           -- Bail : un run qui meurt entre l'appel MP et finalize ne bloque pas la ligne pour
           -- toujours ; le retry porte la même X-Idempotency-Key (l'id du refund).
           next_attempt_at = now() + interval '10 minutes',
           updated_at = now()
      from cand
     where r.id = cand.id
    returning r.id, r.mp_payment_id, r.amount_cop, r.attempts, now();
end;
$$;
revoke all on function public.claim_payment_refunds(int) from public, anon, authenticated;
grant execute on function public.claim_payment_refunds(int) to service_role;

create function public.finalize_payment_refund(
  p_refund_id uuid,
  p_outcome text,
  p_mp_refund_id text default null,
  p_raw jsonb default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund record;
  v_payment record;
begin
  if p_outcome not in ('approved', 'rejected') then
    raise exception 'issue de remboursement inconnue : %', p_outcome;
  end if;

  select r.id, r.entry_id, r.payment_id, r.mp_payment_id, r.status, r.requested_by
    into v_refund
    from public.payment_refunds r where r.id = p_refund_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'refund_not_found');
  end if;
  if v_refund.status <> 'pending' then
    return jsonb_build_object('ok', true, 'reason', 'already_finalized');
  end if;

  select p.id, p.order_id, p.status, p.mp_payment_id into v_payment
    from public.payments p where p.id = v_refund.payment_id;
  -- orders d'abord, toujours ; puis payments ; puis le refund et l'entrée.
  perform 1 from public.orders where id = v_payment.order_id for update;
  perform 1 from public.payments where id = v_payment.id for update;
  perform 1 from public.payment_refunds where id = p_refund_id for update;

  if p_outcome = 'approved' then
    update public.payment_refunds
       set status = 'approved', mp_refund_id = p_mp_refund_id, raw_response = p_raw,
           last_error = null, next_attempt_at = null, updated_at = now()
     where id = p_refund_id;

    update public.payment_reconciliation_entries
       set status = 'resolved',
           resolution_note = 'Reembolsado por el job de conciliación — Mercado Pago refund '
             || coalesce(p_mp_refund_id, '(id no devuelto)'),
           resolved_by = v_refund.requested_by,
           resolved_at = now()
     where id = v_refund.entry_id and status in ('open', 'retrying');

    -- Seulement si ce paiement MP est CELUI qui a payé la commande.
    if v_payment.status = 'approved' and v_payment.mp_payment_id = v_refund.mp_payment_id then
      update public.payments set status = 'refunded', updated_at = now() where id = v_payment.id;
      update public.orders set payment_status = 'refunded' where id = v_payment.order_id;
    end if;
    return jsonb_build_object('ok', true, 'reason', 'approved');
  end if;

  update public.payment_refunds
     set status = 'rejected', raw_response = p_raw, last_error = left(coalesce(p_error, 'rejected'), 500),
         next_attempt_at = null, updated_at = now()
   where id = p_refund_id;
  update public.payment_reconciliation_entries
     set status = 'open'
   where id = v_refund.entry_id and status = 'retrying';
  return jsonb_build_object('ok', true, 'reason', 'rejected');
end;
$$;
revoke all on function public.finalize_payment_refund(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finalize_payment_refund(uuid, text, text, jsonb, text) to service_role;

create function public.fail_payment_refund(p_refund_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  select attempts into v_attempts from public.payment_refunds where id = p_refund_id;
  if not found then
    return;
  end if;
  update public.payment_refunds
     set last_error = left(coalesce(p_error, ''), 500),
         next_attempt_at = now() + least(
           make_interval(mins => (5 * power(2, greatest(v_attempts, 1) - 1))::int),
           interval '24 hours'
         ),
         updated_at = now()
   where id = p_refund_id;
end;
$$;
revoke all on function public.fail_payment_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_payment_refund(uuid, text) to service_role;

-- ============================================================================================
-- 3. E-mails client — par TRIGGER sur l'entrée (précédent notify_admin_new_reconciliation_
--    exception), jamais dans la garde d'apply_payment_webhook : la garde est appelée à chaque
--    livraison MP, l'entrée n'existe qu'une fois. related_id = l'entrée → l'index de dédup de
--    notification_emails garantit UN e-mail par entrée. Texte selon reason_code : un double
--    paiement ne dit JAMAIS « ta réservation n'a pas pu être confirmée » (elle l'est).
--    Textes : docs/specs/39 §5, à valider par Jérôme.
-- ============================================================================================
create function public.notify_client_refund_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_amount bigint;
  v_site_url text;
  v_event text;
  v_subject text;
  v_body text;
  v_link text;
begin
  begin
    if new.kind <> 'refund_required' or new.payment_id is null then
      return new;
    end if;
    select o.holder_name, o.holder_email, o.reference, o.access_token, p.amount_cop
      into v_order
      from public.payments p
      join public.orders o on o.id = p.order_id
     where p.id = new.payment_id;
    if not found or v_order.holder_email is null then
      return new;
    end if;
    v_amount := coalesce(
      nullif(round((new.raw_event ->> 'transaction_amount')::numeric), 0)::bigint,
      v_order.amount_cop
    );
    select decrypted_secret into v_site_url
      from vault.decrypted_secrets where name = 'web_app_public_url';
    v_link := coalesce(
      '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">Ver tu reserva</a></p>',
      ''
    );

    if new.reason_code = 'double_payment' then
      v_event := 'client_duplicate_payment_refund';
      v_subject := 'Recibimos un pago duplicado para tu reserva ' || v_order.reference;
      v_body := '<p>Hola ' || coalesce(v_order.holder_name, '') || ',</p>'
        || '<p>Tu reserva <strong>' || v_order.reference || '</strong> está confirmada. Recibimos un segundo pago de $'
        || v_amount || ' COP para la misma reserva: te lo reembolsaremos por el mismo medio de pago en los próximos días.</p>'
        || v_link;
    else
      v_event := 'client_payment_received_not_honored';
      v_subject := 'Recibimos tu pago — tu reserva ' || v_order.reference || ' no pudo confirmarse';
      v_body := '<p>Hola ' || coalesce(v_order.holder_name, '') || ',</p>'
        || '<p>Recibimos tu pago de $' || v_amount || ' COP, pero tu reserva <strong>' || v_order.reference
        || '</strong> no pudo confirmarse: '
        || case when new.reason_code = 'amount_mismatch'
             then 'el monto recibido no coincide con el anticipo de la reserva.'
             else 'la reserva ya había expirado o había sido anulada cuando llegó el pago.' end
        || '</p><p>Te contactamos en las próximas horas para reembolsarte o volver a reservar. No necesitas hacer nada.</p>'
        || v_link;
    end if;

    perform public.enqueue_notification_email(
      v_event, v_order.holder_email, null, v_subject, v_body,
      'payment_reconciliation_entries', new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_client_refund_required: annulé (query_canceled) pour % — %', new.id, sqlerrm;
    when others then
      raise warning 'notify_client_refund_required: échec pour % — %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
create trigger payment_reconciliation_entries_notify_client
  after insert on public.payment_reconciliation_entries
  for each row when (new.kind = 'refund_required')
  execute function public.notify_client_refund_required();

-- ============================================================================================
-- 4. Contrat client — deux clés (corps par pg_get_functiondef, insertion comptée)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.order_for_client_jsonb(p_order orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', e.slug,
        'establishment_contact_phone', e.contact_phone,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        'price_cop', ol.price_cop,
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Spec 39 D3 (20260922100000) : le client a payé, rien n'est honoré — vrai tant qu'une entrée
    -- refund_required (payé après expiration/annulation, écart de montant) est ouverte. Un DOUBLE
    -- paiement n'y entre pas : sa réservation EST honorée, seul le doublon est remboursé.
    'payment_received_not_honored', exists (
      select 1 from public.payment_reconciliation_entries e
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id and e.kind = 'refund_required'
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch')
        and e.status in ('open', 'retrying')
    ),
    -- Le dernier remboursement lié à ces mêmes entrées : pending → « en cours », approved → « te
    -- reembolsamos », rejected → l'admin reprend la main (le client reste sur « te contactamos »).
    'refund_status', (
      select r.status from public.payment_refunds r
      join public.payment_reconciliation_entries e on e.id = r.entry_id
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch')
      -- Par PRIORITÉ, pas par date : approved (l'argent est rendu) prime sur pending, qui prime
      -- sur rejected — plusieurs entrées peuvent viser la même commande.
      order by case r.status when 'approved' then 0 when 'pending' then 1 else 2 end, r.created_at desc
      limit 1
    ),
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$function$;
