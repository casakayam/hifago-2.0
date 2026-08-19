// addDays — arithmétique de date en UTC (parse la date comme minuit UTC plutôt que minuit local),
// pour éviter tout décalage de fuseau horaire dans les calendriers admin/socio (grille de cupos,
// pagination des fenêtres de dates). SEULE définition de cet helper dans tout le projet —
// auparavant redéclaré verbatim dans availability-calendar.tsx ET dans les 4 pages
// room-availability/slot-availability (admin + partner), désormais toutes importées d'ici (les 2
// premières via les loaders apps/admin/lib/products/roomAvailabilityPage.ts /
// slotAvailabilityPage.ts, les pages elles-mêmes pour la pagination ?from=).
export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
