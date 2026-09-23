// Spec 19 §0 Tranche 1 — Mercado Pago distingue plus d'états (pending/approved/authorized/
// in_process/in_mediation/rejected/cancelled/refunded/charged_back) que payments.status côté
// hifago (pending/approved/rejected/cancelled, cf. migration 20260818200000). Fonction PURE
// (aucune dépendance Node), réutilisable server ET client si besoin d'affichage — d'où sa place
// dans @hifago/domain, jamais dans apps/web/lib/mercadopago (qui lui dépend du SDK/Node).
//
// refunded/charged_back : distincts depuis le 2026-09-21 (spec 39, migration 20260921100000). Les
// replier sur 'cancelled' faisait rétrograder une commande PAYÉE à `unpaid`, lignes toujours
// `reserved` ; apply_payment_webhook les traite désormais eux-mêmes (statuts `refunded`/
// `charged_back`, entrée admin `refunded_externally`, reconnaissance de NOTRE remboursement).
export type PaymentStatus = "pending" | "approved" | "rejected" | "cancelled" | "refunded" | "charged_back";

export function mapMercadoPagoPaymentStatus(mpStatus: string | null | undefined): PaymentStatus {
  switch (mpStatus) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    case "pending":
    case "in_process":
    case "authorized":
    case "in_mediation":
    default:
      return "pending";
  }
}
