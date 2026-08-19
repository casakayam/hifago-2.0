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
    // Alignement hebdomadaire (ex. "toutes les 2 semaines, le mardi") : seulement quand la
    // fréquence est un multiple de 7 ET qu'une date d'ancrage existe — sans les deux, aucun jour de
    // semaine n'est mathématiquement déterminable (une donnée plus ancienne peut n'avoir aucune
    // occurrence_date, cf. gap corrigé côté formulaire admin). weekday pré-formaté ici (chaîne
    // simple interpolée), même convention que `date` ci-dessous — jamais un 2e niveau de select ICU.
    const weekday =
      occurrence.occurrenceDate && days % 7 === 0
        ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
            new Date(`${occurrence.occurrenceDate}T00:00:00`)
          )
        : null;
    // 3e condition de fin (indéfini) = aucune des deux posée, cf. contrainte
    // products_recurrence_end_shape (mutuellement exclusives entre elles).
    if (occurrence.recurrenceEndDate) {
      return weekday
        ? t("recurringWeeklyUntilDate", { weekday, days, date: formatDate(occurrence.recurrenceEndDate) })
        : t("recurringUntilDate", { days, date: formatDate(occurrence.recurrenceEndDate) });
    }
    if (occurrence.recurrenceEndCount) {
      return weekday
        ? t("recurringWeeklyForCount", { weekday, days, count: occurrence.recurrenceEndCount })
        : t("recurringForCount", { days, count: occurrence.recurrenceEndCount });
    }
    return weekday ? t("recurringWeeklyOngoing", { weekday, days }) : t("recurringOngoing", { days });
  }

  return "";
}
