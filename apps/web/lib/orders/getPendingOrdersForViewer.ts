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
// ⚠️ Passe par la RPC `list_pending_orders_for_viewer` (20260922120000), jamais `list_my_orders` :
// celle-ci refuse explicitement une session anonyme (`is_anonymous_session()`, migration
// 20260911100000) — un invité en a justement besoin ici. `get_order_by_token` est gardée par le
// JETON, pas par l'identité : inutilisable pour « quelles commandes m'appartiennent ».
//
// La RPC ne renvoie que id/reference/access_token/statuts de lignes — jamais les colonnes de
// commission d'order_lines : fermeture de la fuite documentée dans docs/backlog.md (2026-09-11),
// `order_lines_select` autorisant sinon la lecture de TOUTES ses colonnes pour le propriétaire.

/** Une commande encore ouverte, telle que ce bloc l'affiche — rien de plus. */
export type PendingOrderForViewer = {
  id: string;
  /** Le numéro AFFICHÉ (`HFG-000042`) — jamais le jeton. */
  reference: string;
  /** Le secret d'accès à `/reserva/<jeton>` — seul chemin vers le détail. */
  accessToken: string;
};

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

  // Garde-fou capacité : la RPC limite déjà à 10 commandes (cron toutes les 5 min, seuil 30 min),
  // un job cassé ne doit pas transformer ce bloc en liste illimitée.
  const { data, error } = await supabase.rpc("list_pending_orders_for_viewer");

  if (error || !data) return [];

  return data
    .filter((order) => order.line_statuses.some((status) => !isDeadLine(status)))
    .map((order) => ({
      id: order.id,
      reference: order.reference,
      accessToken: order.access_token,
    }));
}
