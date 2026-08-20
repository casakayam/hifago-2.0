import type { ChipStyle } from "@/components/status-chip";

// Revue admin clientes (Jérôme, 2026-08-19) — orders.payment_status et payments.status n'étaient
// affichés nulle part dans l'admin avant cette fiche détail (vrai gap, pas un pattern existant à
// reprendre). Deux vocabulaires distincts, jamais confondus : payment_status = notre suivi interne
// du cycle de vie (unpaid/pending/paid/partially_refunded/refunded), payments.status = le dernier
// statut brut renvoyé par Mercado Pago pour un paiement précis.
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Sin pagar",
  pending: "Pago pendiente",
  paid: "Pagado",
  partially_refunded: "Reembolso parcial",
  refunded: "Reembolsado",
};

export const PAYMENT_STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  unpaid: { color: "default", variant: "soft" },
  pending: { color: "warning", variant: "soft" },
  paid: { color: "success", variant: "soft" },
  partially_refunded: { color: "warning", variant: "soft" },
  refunded: { color: "danger", variant: "soft" },
};

export const PAYMENT_PROVIDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

export const PAYMENT_PROVIDER_STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  pending: { color: "warning", variant: "soft" },
  approved: { color: "success", variant: "soft" },
  rejected: { color: "danger", variant: "soft" },
  cancelled: { color: "default", variant: "soft" },
};
