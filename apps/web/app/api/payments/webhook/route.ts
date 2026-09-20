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

/**
 * Matériel de rejeu d'une livraison, conservé DÉFINITIVEMENT dans `raw_event` (incident du
 * 2026-09-20). Jusqu'ici seul le corps était stocké : les 8 livraisons réelles rejetées en
 * `SignatureMismatch` ce jour-là étaient donc invérifiables hors ligne — impossible de tester un
 * secret candidat sans redemander un vrai paiement. Rien ici n'est secret : `x-signature` ne porte
 * qu'un horodatage et une EMPREINTE HMAC, jamais la clé. Le secret lui-même n'est évidemment
 * jamais journalisé (CLAUDE.md §8.2).
 */
function deliveryEvidence(request: Request, url: URL): Json {
  return {
    signature: request.headers.get("x-signature"),
    request_id: request.headers.get("x-request-id"),
    query: url.search || null,
    // Pas d'horodatage ici : `payment_reconciliation_entries.created_at` le porte déjà
    // (default now()), et un `new Date()` applicatif tomberait sous le garde-fou fuseau.
  };
}

async function recordFailure(params: {
  paymentId?: string | null;
  mpPaymentId?: string | null;
  externalReference?: string | null;
  body: Json;
  delivery: Json;
  failureReason: string;
}) {
  const service = createServiceRoleClient();
  await service.from("payment_reconciliation_entries").insert({
    payment_id: params.paymentId ?? null,
    mp_payment_id: params.mpPaymentId ?? null,
    external_reference: params.externalReference ?? null,
    // Enveloppe { body, delivery } : `body` garde exactement ce que MP a POSTé (forme historique),
    // `delivery` ajoute de quoi rejouer la vérification de signature plus tard.
    raw_event: { body: params.body, delivery: params.delivery },
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

  // ⚠️ ORDRE VOULU : le tri par type passe AVANT la vérification de signature (inversé le
  // 2026-09-20). Mercado Pago envoie pour un même paiement des notifications `merchant_order` que
  // nous n'exploitons pas : les valider d'abord les faisait tomber en 401 et écrire une entrée de
  // réconciliation — donc un e-mail à TOUS les admins (trigger 20260824060000) pour du bruit pur.
  // Sur l'incident du 2026-09-20, 2 des 8 entrées étaient exactement ça. Ne rien authentifier ici
  // est sans risque : la branche ne fait rien, ne lit rien, n'écrit rien.
  if (notificationType !== "payment" || !dataId) {
    return new Response(null, { status: 200 });
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
    // ⚠️ Cause déjà rencontrée en réel, à vérifier AVANT de soupçonner le manifeste (2026-09-20,
    // piège 19 enfin élucidé) : un `SignatureMismatch` systématique signifie presque toujours que
    // MERCADOPAGO_WEBHOOK_SECRET et MERCADOPAGO_ACCESS_TOKEN n'appartiennent pas à la même
    // application/au même mode Mercado Pago. Le secret est propre au couple (application, mode) ;
    // le simulateur du panel signe avec celui du compte où l'on est connecté, les livraisons
    // réelles avec celui du compte qui ENCAISSE. Deux comptes = mismatch permanent.
    await recordFailure({
      mpPaymentId: dataId,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      failureReason: `signature invalide (${reason})`,
    });
    return new Response(null, { status: 401 });
  }

  let mpPayment;
  try {
    mpPayment = await getMercadoPagoPayment(dataId);
  } catch (error) {
    console.error("Re-confirmation GET /v1/payments/{id} a échoué", error);
    await recordFailure({
      mpPaymentId: dataId,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      failureReason: "échec de la re-confirmation serveur-à-serveur GET /v1/payments/{id}",
    });
    return new Response(null, { status: 502 }); // Mercado Pago retentera.
  }

  const externalReference = mpPayment.external_reference ?? null;
  if (!externalReference) {
    await recordFailure({
      mpPaymentId: dataId,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
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
      body: rawBody,
      delivery: deliveryEvidence(request, url),
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
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      failureReason: rpcError?.message ?? JSON.stringify(result),
    });
    return new Response(null, { status: 500 }); // Mercado Pago retentera.
  }

  return new Response(null, { status: 200 });
}
