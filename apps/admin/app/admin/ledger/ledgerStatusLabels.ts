import type { ChipStyle } from "@/components/status-chip";

// Extrait de LedgerList.tsx (refonte DataList) — même raison que orders/statusLabels.ts et
// commissions/commissionStateLabels.ts : page.tsx (Server Component) et lib/lists/filters.ts
// doivent valider/afficher le paramètre ?status= reçu de l'URL contre ce même vocabulaire, sans
// importer un fichier "use client" pour une simple constante. Vocabulaire réel de
// ledger_entries.status (check constraint, migration 20260818120000_ledger_entries.sql).
export const LEDGER_STATUS_LABELS: Record<string, string> = {
  estimated: "Estimada",
  due: "A pagar",
  paid: "Pagada",
  reversed: "Reprisada",
  void: "Anulada",
};

export const LEDGER_STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  estimated: { color: "default", variant: "soft" },
  due: { color: "warning", variant: "primary" },
  paid: { color: "success", variant: "soft" },
  reversed: { color: "accent", variant: "soft" },
  void: { color: "danger", variant: "soft" },
};
