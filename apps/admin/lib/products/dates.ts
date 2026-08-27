// addDays — arithmétique de date en UTC (parse la date comme minuit UTC plutôt que minuit local),
// pour éviter tout décalage de fuseau horaire dans les calendriers admin/socio (grille de cupos,
// pagination des fenêtres de dates). SEULE définition de cet helper dans tout le projet —
// auparavant redéclaré verbatim dans availability-calendar.tsx ET dans les pages
// slot-availability (admin + partner), désormais toutes importées d'ici (via le loader
// apps/admin/lib/products/slotAvailabilityPage.ts, et les pages elles-mêmes pour ?from=).
export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
