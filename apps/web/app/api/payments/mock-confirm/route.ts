import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { isPaymentsMockEnabled } from "@/lib/mercadopago/mock";

export const runtime = "nodejs";

// Mode dev — le pendant de mock-checkout/route.ts. Appelle EXACTEMENT la même RPC que le vrai
// webhook (apps/web/app/api/payments/webhook/route.ts), moins la vérification HMAC et le
// GET /v1/payments/{id} — qui n'ont plus de sens ici, il n'y a pas de vrai paiement Mercado Pago à
// re-confirmer. apply_payment_webhook reste le seul point de mutation de payments/orders.
export async function POST(request: Request) {
  if (!isPaymentsMockEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const form = await request.formData();
  const paymentId = form.get("paymentId");
  const returnUrl = form.get("returnUrl");
  const outcome = form.get("outcome");

  if (
    typeof paymentId !== "string" ||
    typeof returnUrl !== "string" ||
    (outcome !== "approved" && outcome !== "rejected" && outcome !== "pending")
  ) {
    return new Response("Bad request", { status: 400 });
  }

  // Anti open-redirect (défense en profondeur, même si cette route n'est atteignable qu'en mode
  // dev) : returnUrl doit pointer vers la même origine que la requête elle-même.
  let target: URL;
  try {
    target = new URL(returnUrl);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (target.origin !== new URL(request.url).origin) {
    return new Response("Bad request", { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: payment } = await service
    .from("payments")
    .select("id")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) {
    return new Response("Not found", { status: 404 });
  }

  const { data: result, error } = await service.rpc("apply_payment_webhook", {
    p_mp_payment_id: `mock_${randomUUID()}`,
    p_external_reference: paymentId,
    p_status: outcome,
    p_raw_event: { mock: true, outcome },
  });

  if (error || !(result as { ok: boolean } | null)?.ok) {
    console.error("apply_payment_webhook (mock) a échoué", error ?? result);
    return new Response("Internal error", { status: 500 });
  }

  // Même paramètre `?payment=` que les trois back_urls du vrai Mercado Pago (create/route.ts) —
  // ici posé au moment du clic plutôt qu'à la création de la préférence, faute d'issue connue avant.
  target.searchParams.set("payment", outcome);
  // Spec 39 : la raison rendue par la RPC (paid_after_expiry, double_payment, already_cancelled…)
  // est relayée pour que les tests et l'œil humain voient ce que la garde a décidé — le vrai
  // Mercado Pago ne la connaît pas, l'écran ne la lit jamais pour décider (orderState.ts).
  const reason = (result as { reason?: string } | null)?.reason;
  if (reason) target.searchParams.set("reason", reason);
  return Response.redirect(target.toString(), 303);
}
