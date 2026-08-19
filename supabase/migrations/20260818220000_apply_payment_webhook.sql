-- Spec 19 §0 Tranche 1 — apply_payment_webhook. Appelée UNIQUEMENT par le Route Handler webhook
-- (apps/web/app/api/payments/webhook/route.ts), APRÈS vérification HMAC de la signature
-- (x-signature) ET un GET serveur-à-serveur de re-confirmation /v1/payments/{id} — jamais sur la
-- seule foi du corps du webhook (pattern anti-race-condition recommandé par Mercado Pago,
-- cohérent avec la philosophie anti-survente déjà en place ici).
--
-- Grant service_role UNIQUEMENT, jamais authenticated/anon — invariant CRITIQUE, pas un simple
-- garde-fou interne : contrairement à la quasi-totalité des autres RPC du projet (qui restent
-- techniquement PUBLIC-executable mais se protègent via un check interne is_admin(auth.uid())),
-- cette fonction n'a AUCUN moyen de vérifier "suis-je vraiment appelée par le Route Handler
-- vérifié" au niveau SQL — la confiance vient entièrement de la vérification HMAC déjà faite EN
-- AMONT, côté serveur. Sans le `revoke`/`grant service_role` ci-dessous, PostgreSQL accorderait
-- EXECUTE à PUBLIC par défaut (comportement standard des fonctions, contrairement aux tables) : un
-- appelant anonyme pourrait alors marquer n'importe quel paiement 'approved' directement depuis le
-- navigateur. Le seul rempart est donc ce grant, pas une logique interne.
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
  elsif p_status in ('rejected', 'cancelled') then
    update public.orders set payment_status = 'unpaid' where id = v_payment.order_id;
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function apply_payment_webhook(text, uuid, text, jsonb) from public;
grant execute on function apply_payment_webhook(text, uuid, text, jsonb) to service_role;
