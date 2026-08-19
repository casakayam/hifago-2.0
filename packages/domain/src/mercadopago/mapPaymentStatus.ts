// Spec 19 §0 Tranche 1 — Mercado Pago distingue plus d'états (pending/approved/authorized/
// in_process/in_mediation/rejected/cancelled/refunded/charged_back) que payments.status côté
// hifago (pending/approved/rejected/cancelled, cf. migration 20260818200000). Fonction PURE
// (aucune dépendance Node), réutilisable server ET client si besoin d'affichage — d'où sa place
// dans @hifago/domain, jamais dans apps/web/lib/mercadopago (qui lui dépend du SDK/Node).
//
// refunded/charged_back retombent sur 'cancelled' pour ce Tranche 1 (paiement qui n'est plus
// acquis) — le remboursement/litige DÉTAILLÉ (payment_refunds) est le sujet de la Tranche 2, pas
// re-modélisé ici en aval.
export type PaymentStatus = "pending" | "approved" | "rejected" | "cancelled";

export function mapMercadoPagoPaymentStatus(mpStatus: string | null | undefined): PaymentStatus {
  switch (mpStatus) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
    case "refunded":
    case "charged_back":
      return "cancelled";
    case "pending":
    case "in_process":
    case "authorized":
    case "in_mediation":
    default:
      return "pending";
  }
}
