export type OccurrenceInput = {
  occurrenceType: "once" | "recurring" | null;
  occurrenceDate: string | null;
  recurrenceFrequencyDays: number | null;
  recurrenceEndDate: string | null;
  recurrenceEndCount: number | null;
};

type OccurrenceTranslator = (key: string, values?: Record<string, string | number>) => string;

// products.occurrence_* (feature 21) — granularité structurée (occurrence_type + fréquence +
// condition de fin), jamais un texte libre, cf. plan. Fonction pure : aucune dépendance DB/React,
// testable directement en Vitest (cf. formatOccurrenceLabel.test.ts). Les fragments traduits
// viennent d'un traducteur next-intl injecté (namespace ProductPage.occurrence) — jamais une
// chaîne ES/EN en dur ici ; seul le cas "once" n'a besoin d'aucune clé, Intl.DateTimeFormat suffit
// à formater une simple date, même pattern que le formatage du prix ailleurs sur cette fiche.
export function formatOccurrenceLabel(
  occurrence: OccurrenceInput,
  locale: string,
  t: OccurrenceTranslator
): string {
  // "T00:00:00" (pas de suffixe Z) : force un parsing en heure locale plutôt qu'UTC minuit, sans
  // quoi une date affichée pourrait glisser d'un jour dans un fuseau à décalage négatif.
  const formatDate = (isoDate: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${isoDate}T00:00:00`));

  if (occurrence.occurrenceType === "once") {
    return occurrence.occurrenceDate ? formatDate(occurrence.occurrenceDate) : "";
  }

  if (occurrence.occurrenceType === "recurring" && occurrence.recurrenceFrequencyDays) {
    const days = occurrence.recurrenceFrequencyDays;
    // 3e condition de fin (indéfini) = aucune des deux posée, cf. contrainte
    // products_recurrence_end_shape (mutuellement exclusives entre elles).
    if (occurrence.recurrenceEndDate) {
      return t("recurringUntilDate", { days, date: formatDate(occurrence.recurrenceEndDate) });
    }
    if (occurrence.recurrenceEndCount) {
      return t("recurringForCount", { days, count: occurrence.recurrenceEndCount });
    }
    return t("recurringOngoing", { days });
  }

  return "";
}
