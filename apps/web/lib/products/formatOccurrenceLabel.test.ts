import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import esMessages from "@/messages/es.json";
import { formatOccurrenceLabel, type OccurrenceInput } from "./formatOccurrenceLabel";

// createTranslator charge le vrai catalogue es.json (namespace ProductPage.occurrence) plutôt
// qu'un mock — tester contre le catalogue réel attrape aussi une clé manquante/mal orthographiée,
// pas seulement la logique de branchement de formatOccurrenceLabel. Cast explicite : le type
// Translator retourné n'accepte que les clés littérales de ce namespace précis (contravariance
// des paramètres de fonction), plus étroit que OccurrenceTranslator (key: string) — sûr ici, les
// clés utilisées par formatOccurrenceLabel sont des littéraux fixes vérifiés par ce test même.
const t = createTranslator({
  locale: "es",
  messages: esMessages,
  namespace: "ProductPage.occurrence",
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const dateFormatter = new Intl.DateTimeFormat("es", { dateStyle: "long" });
function formatDate(iso: string) {
  return dateFormatter.format(new Date(`${iso}T00:00:00`));
}

const base: OccurrenceInput = {
  occurrenceType: null,
  occurrenceDate: null,
  recurrenceFrequencyDays: null,
  recurrenceEndDate: null,
  recurrenceEndCount: null,
};

describe("formatOccurrenceLabel", () => {
  it("ponctuel → date formatée", () => {
    const label = formatOccurrenceLabel(
      { ...base, occurrenceType: "once", occurrenceDate: "2026-09-20" },
      "es",
      t
    );
    expect(label).toBe(formatDate("2026-09-20"));
  });

  it("récurrent + fin par date", () => {
    const label = formatOccurrenceLabel(
      {
        ...base,
        occurrenceType: "recurring",
        recurrenceFrequencyDays: 7,
        recurrenceEndDate: "2026-12-31",
      },
      "es",
      t
    );
    expect(label).toBe(`Cada 7 días, hasta el ${formatDate("2026-12-31")}.`);
  });

  it("récurrent + fin par nombre d'occurrences", () => {
    const label = formatOccurrenceLabel(
      {
        ...base,
        occurrenceType: "recurring",
        recurrenceFrequencyDays: 14,
        recurrenceEndCount: 5,
      },
      "es",
      t
    );
    expect(label).toBe("Cada 14 días, durante 5 repeticiones.");
  });

  it("récurrent sans fin (indéfini) — ni recurrence_end_date ni recurrence_end_count posés", () => {
    const label = formatOccurrenceLabel(
      { ...base, occurrenceType: "recurring", recurrenceFrequencyDays: 7 },
      "es",
      t
    );
    expect(label).toBe("Cada 7 días, de forma indefinida.");
  });

  it("les 4 cas rendent un texte distinct les uns des autres", () => {
    const labels = [
      formatOccurrenceLabel({ ...base, occurrenceType: "once", occurrenceDate: "2026-09-20" }, "es", t),
      formatOccurrenceLabel(
        { ...base, occurrenceType: "recurring", recurrenceFrequencyDays: 7, recurrenceEndDate: "2026-12-31" },
        "es",
        t
      ),
      formatOccurrenceLabel(
        { ...base, occurrenceType: "recurring", recurrenceFrequencyDays: 7, recurrenceEndCount: 5 },
        "es",
        t
      ),
      formatOccurrenceLabel({ ...base, occurrenceType: "recurring", recurrenceFrequencyDays: 7 }, "es", t),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });
});
