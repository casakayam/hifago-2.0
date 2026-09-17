import { describe, expect, it } from "vitest";
import { computeTripRange, formatTripLabel } from "./tripRange";

/** Simule un traducteur next-intl : rend la clé et ses valeurs, sans dépendre de vrais messages. */
function stubTranslator(key: string, values: Record<string, string>): string {
  return `${key}(${Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")})`;
}

describe("computeTripRange", () => {
  it("s'effondre sur une seule date pour une commande à une seule ligne sans endDate", () => {
    expect(computeTripRange([{ date: "2026-09-12", endDate: null }])).toEqual({
      start: "2026-09-12",
      end: "2026-09-12",
    });
  });

  it("étend la borne haute jusqu'au checkout d'une ligne hébergement", () => {
    expect(computeTripRange([{ date: "2026-09-12", endDate: "2026-09-15" }])).toEqual({
      start: "2026-09-12",
      end: "2026-09-15",
    });
  });

  it("prend le min des débuts et le max des fins sur plusieurs lignes", () => {
    expect(
      computeTripRange([
        { date: "2026-09-14", endDate: null },
        { date: "2026-09-12", endDate: "2026-09-13" },
        { date: "2026-09-16", endDate: "2026-09-18" },
      ])
    ).toEqual({ start: "2026-09-12", end: "2026-09-18" });
  });

  it("compte une ligne même si elle serait annulée/expirée — aucun filtre par statut", () => {
    // Le type ne porte pas `status` : le point à prouver est qu'une date isolée, plus large que le
    // reste de la commande, étire quand même la plage — c'est le comportement pour une ligne morte.
    expect(
      computeTripRange([
        { date: "2026-09-12", endDate: "2026-09-13" },
        { date: "2026-09-20", endDate: null },
      ])
    ).toEqual({ start: "2026-09-12", end: "2026-09-20" });
  });

  it("ne dépend pas de l'ordre des lignes en entrée", () => {
    expect(
      computeTripRange([
        { date: "2026-09-18", endDate: null },
        { date: "2026-09-12", endDate: "2026-09-15" },
      ])
    ).toEqual({ start: "2026-09-12", end: "2026-09-18" });
  });

  it("étire la plage jusqu'à la fin d'un camp — reconstituée depuis durationDays, pas endDate", () => {
    expect(
      computeTripRange([{ date: "2026-10-01", endDate: null, durationDays: 7 }])
    ).toEqual({ start: "2026-10-01", end: "2026-10-07" });
  });
});

describe("formatTripLabel", () => {
  it("appelle trip.single avec une seule date formatée quand start === end", () => {
    expect(
      formatTripLabel({ start: "2026-09-12", end: "2026-09-12" }, "es", stubTranslator)
    ).toBe("trip.single(start=12 sept)");
  });

  it("appelle trip.range avec les deux bornes formatées quand start !== end", () => {
    expect(
      formatTripLabel({ start: "2026-09-12", end: "2026-09-15" }, "es", stubTranslator)
    ).toBe("trip.range(start=12 sept,end=15 sept)");
  });

  it("formate chaque borne selon la locale passée", () => {
    expect(
      formatTripLabel({ start: "2026-09-12", end: "2026-09-15" }, "en", stubTranslator)
    ).toBe("trip.range(start=Sep 12,end=Sep 15)");
  });
});
