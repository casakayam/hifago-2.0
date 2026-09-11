// La date (ou la plage, ou le créneau) d'une ligne, rendue de la même façon partout.
//
// Extrait le 2026-09-10 (spec 33) : les six mêmes lignes de ternaires vivaient à l'identique dans
// `CartSummary.tsx` et dans le nouvel écran de résultat. C'est de la PRÉSENTATION PURE — aucun
// prix, aucun statut — donc l'interdiction de fusionner les deux composants (prix vivant vs prix
// figé, spec 32 invariant 3) ne s'y applique pas : c'est justement ce qu'ils ont en commun.
//
// Même forme que `lib/products/formatOccurrenceLabel.ts` : une fonction pure, testable, qui ne
// connaît ni React ni Supabase.
//
// ⚠️ Rend les dates telles qu'elles viennent de la base (ISO `2026-11-01`), ce qui est le
// comportement actuel des deux écrans — extraire ne change rien à l'affichage, c'est voulu.
// `formatDateInBogota` de `@hifago/domain` existe et rend une date lisible (il sert déjà dans
// `cuenta/reservas/OrdersList.tsx`) : basculer dessus est une amélioration réelle, mais qui change
// le rendu de deux écrans et leurs e2e — un geste à part, pas un effet de bord d'une extraction.

export type LineSchedule = {
  date: string;
  endDate?: string | null;
  slotStartTime?: string | null;
};

/** `2026-11-01`, `2026-11-01 → 2026-11-03`, ou `2026-11-01 · 09:00` selon la forme de la ligne. */
export function formatLineSchedule({ date, endDate, slotStartTime }: LineSchedule): string {
  if (endDate) return `${date} → ${endDate}`;
  if (slotStartTime) return `${date} · ${slotStartTime}`;
  return date;
}
