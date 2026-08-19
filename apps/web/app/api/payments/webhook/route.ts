import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { mapMercadoPagoPaymentStatus } from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { getMercadoPagoPayment } from "@/lib/mercadopago/client";

export const runtime = "nodejs";

// Miroir local du type Json généré par Supabase — même convention que
// apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// Spec 19 §0 Tranche 1 — webhook Mercado Pago. `apply_payment_webhook` (RPC) est grantée
// UNIQUEMENT à service_role (migration 20260818220000) : ce Route Handler est le SEUL appelant
// légitime, et seulement après (1) vérification HMAC de la signature x-signature ET (2) un GET
// serveur-à-serveur de re-confirmation /v1/payments/{id} — jamais sur la seule foi du corps du
// webhook (pattern anti-race-condition documenté par Mercado Pago). Toute étape qui échoue avant
// d'appeler la RPC écrit dans payment_reconciliation_entries plutôt que de laisser l'échec
// silencieux (même discipline que pms_reconciliation_entries).
async function recordFailure(params: {
  paymentId?: string | null;
  mpPaymentId?: string | null;
  externalReference?: string | null;
  rawEvent: Json;
  failureReason: string;
}) {
  const service = createServiceRoleClient();
  await service.from("payment_reconciliation_entries").insert({
    payment_id: params.paymentId ?? null,
    mp_payment_id: params.mpPaymentId ?? null,
    external_reference: params.externalReference ?? null,
    raw_event: params.rawEvent,
    failure_reason: params.failureReason,
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const notificationType = url.searchParams.get("type") ?? url.searchParams.get("topic");
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  let rawBody: Json = null;
  try {
    rawBody = await request.json();
  } catch {
    // Corps vide/non-JSON : pas bloquant en soi (certaines notifications n'ont qu'une query string),
    // la vérification de signature ci-dessous reste la vraie porte.
  }

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("MERCADOPAGO_WEBHOOK_SECRET manquant — webhook refusé par sécurité.");
    return new Response(null, { status: 500 });
  }

  try {
    WebhookSignatureValidator.validate({
      xSignature,
      xRequestId,
      dataId,
      secret,
    });
  } catch (error) {
    const reason =
      error instanceof InvalidWebhookSignatureError ? error.reason : "signature_validation_error";
    await recordFailure({
      rawEvent: rawBody,
      failureReason: `signature invalide (${reason})`,
    });
    return new Response(null, { status: 401 });
  }

  // Seules les notifications de paiement nous concernent (Mercado Pago envoie aussi des
  // notifications merchant_order/chargebacks selon la configuration) — un type inconnu est un
  // no-op silencieux CÔTÉ MÉTIER, mais toujours un 2xx (Mercado Pago retenterait indéfiniment sinon).
  if (notificationType !== "payment" || !dataId) {
    return new Response(null, { status: 200 });
  }

  let mpPayment;
  try {
    mpPayment = await getMercadoPagoPayment(dataId);
  } catch (error) {
    console.error("Re-confirmation GET /v1/payments/{id} a échoué", error);
    await recordFailure({
      mpPaymentId: dataId,
      rawEvent: rawBody,
      failureReason: "échec de la re-confirmation serveur-à-serveur GET /v1/payments/{id}",
    });
    return new Response(null, { status: 502 }); // Mercado Pago retentera.
  }

  const externalReference = mpPayment.external_reference ?? null;
  if (!externalReference) {
    await recordFailure({
      mpPaymentId: dataId,
      rawEvent: rawBody,
      failureReason: "external_reference absent de la réponse Mercado Pago re-confirmée",
    });
    return new Response(null, { status: 200 }); // Rien à corréler, pas la peine de faire retenter.
  }

  const service = createServiceRoleClient();
  const { data: knownPayment } = await service
    .from("payments")
    .select("id, amount_cop")
    .eq("id", externalReference)
    .maybeSingle();

  // Défense en profondeur : le montant réellement payé chez Mercado Pago doit correspondre au
  // montant que NOUS avons calculé à la création de l'intent (create_payment_intent) — jamais
  // supposé, toujours revérifié ici. Un écart n'approuve JAMAIS le paiement automatiquement :
  // atterrit en réconciliation manuelle, échec fermé plutôt qu'une approbation optimiste.
  const mpAmount = mpPayment.transaction_amount;
  const statusToApply = mapMercadoPagoPaymentStatus(mpPayment.status);
  if (
    statusToApply === "approved" &&
    knownPayment &&
    typeof mpAmount === "number" &&
    Math.round(mpAmount) !== knownPayment.amount_cop
  ) {
    await recordFailure({
      paymentId: knownPayment.id,
      mpPaymentId: dataId,
      externalReference,
      rawEvent: rawBody,
      failureReason: `montant Mercado Pago (${mpAmount}) ≠ amount_cop attendu (${knownPayment.amount_cop})`,
    });
    return new Response(null, { status: 200 }); // Corrélé mais suspect : jamais un retry MP en boucle.
  }

  const { data: result, error: rpcError } = await service.rpc("apply_payment_webhook", {
    p_mp_payment_id: dataId,
    p_external_reference: externalReference,
    p_status: statusToApply,
    p_raw_event: rawBody ?? {},
  });

  if (rpcError || !(result as { ok: boolean } | null)?.ok) {
    await recordFailure({
      mpPaymentId: dataId,
      externalReference,
      rawEvent: rawBody,
      failureReason: rpcError?.message ?? JSON.stringify(result),
    });
    return new Response(null, { status: 500 }); // Mercado Pago retentera.
  }

  return new Response(null, { status: 200 });
}
