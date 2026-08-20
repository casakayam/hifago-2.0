// Extrait de CommissionsTable.tsx (filtres date/état, 2026-08-20) — même raison que
// apps/admin/app/admin/orders/statusLabels.ts : page.tsx (Server Component) et
// lib/lists/filters.ts doivent valider/afficher le paramètre ?status= reçu de l'URL contre ce même
// vocabulaire, sans importer un fichier "use client" pour une simple constante. Vocabulaire réel de
// ledger_entries.status (check constraint, migration 20260818120000).
export const COMMISSION_STATE_LABELS: Record<string, string> = {
  estimated: "Estimada",
  due: "Ganada, por pagar",
  paid: "Pagada",
  void: "Reasignada al prestador",
  reversed: "Excluida",
};
