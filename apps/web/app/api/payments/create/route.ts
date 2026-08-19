import { createServiceRoleClient } from "@hifago/supabase/service";
import { createCheckoutPreference } from "@/lib/mercadopago/client";

// Spec 19 §0 Tranche 1 — création de la préférence Checkout Pro. Le CLIENT appelle d'abord
// create_payment_intent(order_id) directement via son propre client Supabase (RPC anon/
// authenticated, même patron que create_order aujourd'hui — cf. CheckoutForm.tsx), PUIS ce Route
// Handler avec le seul payment_id obtenu. Ne fait JAMAIS confiance à un amount_cop/payer_email
// envoyé par le client : re-lit l'état AUTORITATIF de `payments` via service_role (RLS admin-only,
// même un compte propriétaire de la commande ne peut pas la lire en direct — cf. migration
// 20260818200000) — un client compromis ou buggé qui mentirait sur le montant n'a donc aucune
// prise ici, contrairement à un design qui relaierait bêtement les valeurs reçues du navigateur.
//
// N'appelle PAS auth.getUser()/vérification de propriété ici : create_payment_intent a déjà
// entièrement statué sur l'autorisation (invité compris) au moment de sa propre exécution — ce
// Route Handler ne fait qu'emballer l'appel SDK externe (le secret MERCADOPAGO_ACCESS_TOKEN ne
// peut jamais quitter le serveur, d'où l'existence même de ce Route Handler).
export async function POST(request: Request) {
  let body: { paymentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const paymentId = body.paymentId;
  if (typeof paymentId !== "string" || paymentId.length === 0) {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: payment, error: readError } = await service
    .from("payments")
    .select("id, order_id, amount_cop, payer_email, status")
    .eq("id", paymentId)
    .maybeSingle();

  if (readError || !payment) {
    return Response.json({ ok: false, reason: "payment_not_found" }, { status: 404 });
  }
  if (payment.status !== "pending") {
    return Response.json({ ok: false, reason: "payment_not_pending" }, { status: 409 });
  }

  // Retour vers l'écran checkout existant (pas encore de page de statut dédiée — le branchement
  // écran réel est différé, cf. spec 19 §10 : construit "prêt mais non branché" tant qu'aucun
  // identifiant sandbox réel n'est disponible pour tester en conditions réelles). `es` en dur : le
  // locale du panier n'est pas conservé sur `orders`/`payments` aujourd'hui — à revisiter si un
  // jour le retour doit respecter la langue d'origine du client.
  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/es/checkout`;

  try {
    const { initPoint } = await createCheckoutPreference({
      paymentId: payment.id,
      amountCop: payment.amount_cop,
      payerEmail: payment.payer_email,
      successUrl: returnUrl,
      pendingUrl: returnUrl,
      failureUrl: returnUrl,
      notificationUrl: `${origin}/api/payments/webhook`,
    });
    return Response.json({ ok: true, init_point: initPoint });
  } catch (error) {
    // Échec fermé (spec §0 Tranche 1) : Mercado Pago indisponible/mal configuré n'annule jamais la
    // commande déjà réservée par create_order — la ligne reste 'reserved', payment reste 'pending',
    // le client peut retenter (le job d'expiration reste le seul filet en dernier recours).
    console.error("createCheckoutPreference a échoué", error);
    return Response.json({ ok: false, reason: "mercadopago_unavailable" }, { status: 503 });
  }
}
