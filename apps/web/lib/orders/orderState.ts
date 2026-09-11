// L'état d'une commande tel qu'on le DIT à un client, et le seul endroit où il se décide.
//
// Extrait le 2026-09-11 (spec 34) de `reserva/[token]/OrderResult.tsx`, où il vivait en cascade de
// ternaires dans un composant client — donc non testé, et invisible à qui écrit un second écran.
// La liste « Mis reservas » montre les mêmes commandes que l'écran du jeton : deux dérivations
// séparées auraient fini par dire deux choses différentes du même objet.
//
// ⚠️ CE MODULE NE CONNAÎT PAS L'INCIDENT DE PAIEMENT, et c'est la distinction que l'en-tête
// d'OrderResult avait déjà payée : « l'état de la COMMANDE et l'incident de PAIEMENT sont deux
// choses distinctes ; les mélanger rendait `isPayable` vrai sur une commande déjà payée dont un
// paiement de trop avait échoué ». `failed` reste donc un état d'ÉCRAN, superposé par celui qui
// vient de voir un appel échouer — jamais un état qu'on dérive d'une commande.
//
// Fonction pure, sans React ni Supabase : elle se teste sans monter quoi que ce soit.

/** Lignes qui ne comptent plus — MÊME liste que `order_for_client_jsonb`, qui exclut les mêmes des totaux. */
export const DEAD_LINE_STATUSES = [
  "cancelled_by_client",
  "cancelled_by_provider",
  "expired",
  "superseded",
];

/** Vrai pour une prestation qui n'arrivera plus : affichée barrée, jamais masquée. */
export function isDeadLine(status: string): boolean {
  return DEAD_LINE_STATUSES.includes(status);
}

/** Les cinq états qu'une commande peut porter d'elle-même. `failed` n'en est pas un : cf. l'en-tête. */
export type OrderState = "paid" | "awaiting" | "unpaid" | "expired" | "cancelled";

/** La forme minimale dont la dérivation a besoin — compatible avec `OrderForDisplay` et la liste. */
export type OrderStateInput = {
  paymentStatus: string;
  lines: { status: string }[];
};

/**
 * L'état d'une commande, dans l'ordre où un client le lirait : payée d'abord, puis en attente du
 * webhook, puis « il reste quelque chose de vivant donc c'est à payer », puis les deux fins
 * possibles — expirée (le paiement n'est jamais arrivé) ou annulée.
 *
 * ⚠️ `orders.status` n'est JAMAIS consulté : la colonne vaut `'confirmed'` sur toute ligne, rien ne
 * l'écrit, et depuis la spec 34 elle ne sort même plus de la base (invariant 4).
 */
export function deriveOrderState(order: OrderStateInput): OrderState {
  if (order.paymentStatus === "paid") return "paid";
  if (order.paymentStatus === "pending") return "awaiting";
  if (order.lines.some((line) => !isDeadLine(line.status))) return "unpaid";
  if (order.lines.some((line) => line.status === "expired")) return "expired";
  return "cancelled";
}
