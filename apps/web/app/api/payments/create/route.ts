import { createServiceRoleClient } from "@hifago/supabase/service";
import { resolveOrigin } from "@hifago/domain";
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

  // Spec 33 — le jeton de retour est lu dans la MÊME requête, par l'embed PostgREST sur la FK
  // `payments.order_id → orders.id` : le navigateur n'a jamais à le transmettre, et cette étape ne
  // coûte pas un second aller-retour sur un chemin où le client attend déjà Mercado Pago.
  const service = createServiceRoleClient();
  const { data: payment, error: readError } = await service
    .from("payments")
    .select("id, order_id, amount_cop, payer_email, status, orders(access_token)")
    .eq("id", paymentId)
    .maybeSingle();

  if (readError || !payment) {
    return Response.json({ ok: false, reason: "payment_not_found" }, { status: 404 });
  }

  if (payment.status !== "pending") {
    return Response.json({ ok: false, reason: "payment_not_pending" }, { status: 409 });
  }

  const order = payment.orders;
  if (!order?.access_token) {
    // Ne devrait jamais arriver (colonne NOT NULL depuis 20260910170000) — mais échouer ici est
    // préférable à fabriquer une back_url qui ramènerait le client sur une page introuvable après
    // avoir payé.
    return Response.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  }

  // Spec 33 — RETOUR VERS L'ADRESSE PROPRE À LA COMMANDE, et non plus vers l'écran de checkout.
  //
  // Ce que ça corrige : les trois back_urls pointaient sur `${origin}/es/pago`, un écran qui ne
  // rend `<CheckoutForm>` que si le panier n'est pas vide. Depuis que `create_order` vide
  // `cart_items` dans sa propre transaction (spec 32, 2026-09-10), le client revenait de Mercado
  // Pago sur une PAGE VIDE — un `<h1>` et « ton panier est vide », sans numéro, sans confirmation,
  // sans message d'échec. Le repli assumé par la spec 19 (« réutilise l'écran checkout ») était
  // devenu faux sans que rien ne le relise.
  //
  // ⚠️ AUCUN PRÉFIXE DE LOCALE, et c'est le correctif entier de la locale forcée. `resolveLocale`
  // de next-intl résout dans l'ordre : préfixe du chemin → cookie NEXT_LOCALE → Accept-Language →
  // `es`. Un chemin SANS préfixe tombe donc sur la langue réelle du visiteur. Et c'est le `/es` en
  // dur qui CASSAIT ce repli, pas son absence : un chemin préfixé fait résoudre `es` par la
  // première branche, et `syncCookie` réécrit alors NEXT_LOCALE à `es` — un anglophone qui payait
  // ne revenait pas seulement sur une page espagnole, TOUTE LA SUITE de sa session basculait.
  // Aucune colonne `orders.locale` n'est nécessaire : le mécanisme existait déjà, il était
  // neutralisé.
  // Feature 32 — bug réel trouvé en testant via tunnel (docs/journal/2026-08.md, 2026-08-21) :
  // `new URL(request.url).origin` seul retombe sur l'adresse locale du serveur dès que la requête
  // traverse un reverse proxy/tunnel qui ne réécrit pas request.url lui-même — `back_urls`/
  // `notification_url` construits dessus pointaient vers une adresse injoignable depuis Mercado
  // Pago, silencieusement. Extrait dans @hifago/domain (packages/domain/src/http/resolveOrigin.ts) :
  // le même besoin existe ailleurs (apps/web/app/auth/callback/route.ts).
  const origin = resolveOrigin({
    requestUrl: request.url,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
  });
  const returnUrl = `${origin}/reserva/${order.access_token}`;

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
