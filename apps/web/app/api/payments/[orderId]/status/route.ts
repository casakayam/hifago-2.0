import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 19 §0 Tranche 1 — poll de secours après retour de Checkout Pro (le webhook peut arriver
// après la redirection du client). Ne renvoie QUE payment_status, jamais le reste de la commande.
//
// ⚠️ SANS AUCUN APPELANT DANS LE DÉPÔT (constaté le 2026-09-10). La spec 33 avait commencé par la
// brancher depuis l'écran de résultat, puis y a renoncé : cet écran est gardé par un JETON, tandis
// que cette route lit `orders` en `service_role` sur la seule possession de l'`order_id` — deux
// modèles d'autorisation pour un même écran, dont celui que la spec 33 a explicitement écarté
// (§3 décision ② : l'identifiant et le secret ne doivent pas être le même objet). L'écran se
// rafraîchit donc par `router.refresh()`, qui repasse par `get_order_by_token`.
//
// ⚠️ Son commentaire d'origine affirmait « orders_select exclut déjà l'invité de toute lecture RLS
// directe » : PÉRIMÉ depuis la spec 31 (`orders.account_id` est NOT NULL et porte l'identité
// anonyme, donc un invité lit bien sa propre commande). Retiré plutôt que laissé à induire en
// erreur.
//
// Reste donc à trancher : la supprimer (elle n'a pas d'appelant), ou la garder par jeton plutôt
// que par order_id si un poll léger redevient souhaitable. Point ouvert, spec 33 §10.
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
