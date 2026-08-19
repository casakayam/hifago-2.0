import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 19 §0 Tranche 1 — poll de secours après retour de Checkout Pro (le webhook peut arriver
// après la redirection du client). service_role : orders_select exclut déjà l'invité de toute
// lecture RLS directe (même modèle que create_payment_intent, migration 20260818200000) — la
// possession de orderId fait foi, jamais une vérification account_id ici. Ne renvoie QUE
// payment_status, jamais le reste de la commande (nom, email, téléphone).
export async function GET(
  _request: Request,
  context: RouteContext<"/api/payments/[orderId]/status">
) {
  const { orderId } = await context.params;

  const service = createServiceRoleClient();
  const { data: order, error } = await service
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    return Response.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  }

  return Response.json({ ok: true, payment_status: order.payment_status });
}
