import { createClient } from "@hifago/supabase/server";
import { isDeadLine } from "./orderState";

// Même famille que getCartLines.ts, getOrderByToken.ts et getMyOrders.ts : ce module résout
// lui-même auth.getUser() et construit son propre client — aucun paramètre. C'est ce qui permet de
// l'appeler depuis `/mi-viaje`, qui n'a aujourd'hui aucun accès Supabase et n'a pas le droit d'en
// créer un directement (`scripts/check-data-layer.sh` : `(tunnel)/pago/page.tsx` est la SEULE
// exemption restante à cette règle, une liste qui doit rétrécir, jamais grandir).
//
// ⚠️ POURQUOI CE MODULE EXISTE : `create_order` vide `cart_items` dès qu'elle réussit (spec 32) —
// la réservation existe déjà, avant tout paiement. Un invité dont le paiement échoue ou qui ferme
// l'onglet perd donc toute trace visible de sa commande sur `/mi-viaje`/`/pago`, alors qu'elle est
// toujours là, retrouvable par son seul jeton (`/reserva/<jeton>`). Ce bloc lui redonne le chemin.
//
// ⚠️ Lit `orders`/`order_lines` en RLS DIRECTE (`orders_select` autorise déjà
// `account_id = (select auth.uid())`, anonyme compris depuis la spec 31), jamais via
// `list_my_orders` : cette RPC refuse explicitement une session anonyme
// (`is_anonymous_session()`, migration 20260911100000) — un invité en a justement besoin ici.
// `get_order_by_token` est gardée par le JETON, pas par l'identité : inutilisable pour « quelles
// commandes m'appartiennent ».
//
// ⚠️ SELECT EXPLICITE, jamais `select("*")` : `order_lines_select` autorise la lecture de TOUTES
// ses colonnes (commission comprise) pour le propriétaire — la liste blanche ci-dessous est le
// seul rempart côté app, même discipline que `order_for_client_jsonb`.

/** Une commande encore ouverte, telle que ce bloc l'affiche — rien de plus. */
export type PendingOrderForViewer = {
  id: string;
  /** Le numéro AFFICHÉ (`HFG-000042`) — jamais le jeton. */
  reference: string;
  /** Le secret d'accès à `/reserva/<jeton>` — seul chemin vers le détail. */
  accessToken: string;
};

/**
 * `payment_status` n'est JAMAIS réécrit par `expire_stale_payment_orders` (reste `'unpaid'` même
 * après expiration) : ce filtre seul ne suffit pas à dire « en cours », cf. le filtre `isDeadLine`
 * appliqué plus bas sur les lignes.
 */
const UNSETTLED_PAYMENT_STATUSES = ["unpaid", "pending"];

/**
 * Les commandes de l'appelant encore ouvertes (paiement non conclu ET au moins une prestation
 * vivante) — pour proposer de reprendre une commande dont `create_order` a déjà vidé le panier.
 *
 * Rend `[]` sans session (visiteur qui n'a jamais touché le panier), en cas d'erreur réseau, et
 * pour tout compte n'ayant aucune commande ouverte : ce bloc est un confort, jamais le contenu
 * principal de l'écran, il ne doit jamais casser `/mi-viaje`/`/pago`.
 */
export async function getPendingOrdersForViewer(): Promise<PendingOrderForViewer[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from("orders")
    .select("id, reference, access_token, order_lines(status)")
    .eq("account_id", user.id)
    .in("payment_status", UNSETTLED_PAYMENT_STATUSES)
    .order("created_at", { ascending: false })
    // Garde-fou : en pratique 0-2 lignes (cron toutes les 5 min, seuil 30 min), mais un job cassé
    // ne doit pas transformer ce bloc en liste illimitée.
    .limit(10);

  if (error || !data) return [];

  return data
    .filter((order) => order.order_lines.some((line) => !isDeadLine(line.status)))
    .map((order) => ({
      id: order.id,
      reference: order.reference,
      accessToken: order.access_token,
    }));
}
