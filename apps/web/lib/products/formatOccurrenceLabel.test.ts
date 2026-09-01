import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { formatOccurrenceLabel, type OccurrenceInput } from "./formatOccurrenceLabel";
import { loadMessages } from "@/messages";

const esMessages = loadMessages("es");

// createTranslator charge le vrai catalogue messages/es/ProductPage.json (namespace
// ProductPage.occurrence) plutôt
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

  it("récurrent hebdomadaire (fréquence multiple de 7) + date d'ancrage → jour de semaine affiché", () => {
    // 2026-09-22 est un mardi.
    const label = formatOccurrenceLabel(
      {
        ...base,
        occurrenceType: "recurring",
        occurrenceDate: "2026-09-22",
        recurrenceFrequencyDays: 14,
        recurrenceEndDate: "2026-12-31",
      },
      "es",
      t
    );
    expect(label).toBe(`Los martes, cada 14 días, hasta el ${formatDate("2026-12-31")}.`);
  });

  it("récurrent hebdomadaire, fin par nombre d'occurrences", () => {
    const label = formatOccurrenceLabel(
      { ...base, occurrenceType: "recurring", occurrenceDate: "2026-09-22", recurrenceFrequencyDays: 7, recurrenceEndCount: 5 },
      "es",
      t
    );
    expect(label).toBe("Los martes, cada 7 días, durante 5 repeticiones.");
  });

  it("récurrent hebdomadaire, indéfini", () => {
    const label = formatOccurrenceLabel(
      { ...base, occurrenceType: "recurring", occurrenceDate: "2026-09-22", recurrenceFrequencyDays: 7 },
      "es",
      t
    );
    expect(label).toBe("Los martes, cada 7 días, de forma indefinida.");
  });

  it("récurrent NON multiple de 7 malgré une date d'ancrage → pas de jour de semaine (pas mathématiquement déterminable)", () => {
    const label = formatOccurrenceLabel(
      { ...base, occurrenceType: "recurring", occurrenceDate: "2026-09-22", recurrenceFrequencyDays: 10 },
      "es",
      t
    );
    expect(label).toBe("Cada 10 días, de forma indefinida.");
  });

  it("récurrent multiple de 7 SANS date d'ancrage (donnée historique) → repli sur le texte simple", () => {
    const label = formatOccurrenceLabel(
      { ...base, occurrenceType: "recurring", occurrenceDate: null, recurrenceFrequencyDays: 7 },
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
