import { describe, expect, it } from "vitest";
import {
  emptyStayRates,
  stayRatesFromColumn,
  toStayRatesColumn,
  validateStayRates,
  type DraftStayRates,
} from "./stayRates";

function draft(overrides: Partial<DraftStayRates> = {}): DraftStayRates {
  return { ...emptyStayRates(), ...overrides };
}

describe("validateStayRates", () => {
  it("un brouillon entièrement vide est valide — toute la grille reste optionnelle", () => {
    expect(validateStayRates(emptyStayRates())).toBeNull();
  });

  it("majoration de saison sans mois choisi → erreur", () => {
    expect(validateStayRates(draft({ seasonSurchargePct: "20" }))).toMatch(/mes/);
  });

  it("majoration de saison hors 0-100 → erreur", () => {
    expect(validateStayRates(draft({ seasonMonths: [12], seasonSurchargePct: "150" }))).toMatch(
      /porcentaje/,
    );
    expect(validateStayRates(draft({ seasonMonths: [12], seasonSurchargePct: "-5" }))).toMatch(
      /porcentaje/,
    );
  });

  it("majoration de saison valide avec mois choisis", () => {
    expect(validateStayRates(draft({ seasonMonths: [12, 1], seasonSurchargePct: "20" }))).toBeNull();
  });

  it("majoration week-end sans jour choisi → erreur", () => {
    expect(validateStayRates(draft({ weekendDays: [], weekendSurchargePct: "15" }))).toMatch(/día/);
  });

  it("majoration week-end hors 0-100 → erreur", () => {
    expect(validateStayRates(draft({ weekendSurchargePct: "abc" }))).toMatch(/porcentaje/);
  });

  it("plus de 20 inclusiones → erreur", () => {
    const includes = Array.from({ length: 21 }, (_, i) => `Servicio ${i}`);
    expect(validateStayRates(draft({ includes }))).toMatch(/20 servicios/);
  });

  it("une inclusion trop longue → erreur", () => {
    expect(validateStayRates(draft({ includes: ["x".repeat(81)] }))).toMatch(/80 caracteres/);
  });

  it("dépôt négatif ou non numérique → erreur", () => {
    expect(validateStayRates(draft({ depositCop: "-1" }))).toMatch(/depósito/);
    expect(validateStayRates(draft({ depositCop: "abc" }))).toMatch(/depósito/);
  });

  it("dépôt valide", () => {
    expect(validateStayRates(draft({ depositCop: "200000" }))).toBeNull();
  });
});

describe("toStayRatesColumn", () => {
  it("brouillon entièrement vide → null (même convention que price_tiers)", () => {
    expect(toStayRatesColumn(emptyStayRates())).toBeNull();
  });

  it("les jours de week-end présélectionnés par défaut ne comptent pas comme non-vide", () => {
    // emptyStayRates() présélectionne Ven+Sam (weekendDays) mais aucune majoration n'est saisie.
    expect(toStayRatesColumn(emptyStayRates())).toBeNull();
  });

  it("convertit les pourcentages saisis (0-100) en fractions (0-1)", () => {
    const column = toStayRatesColumn(
      draft({ seasonMonths: [12], seasonSurchargePct: "20", weekendDays: [5, 6], weekendSurchargePct: "10" }),
    );
    expect(column?.season.surcharge_pct).toBe(0.2);
    expect(column?.weekend_surcharge_pct).toBe(0.1);
  });

  it("filtre les inclusiones vides et trie les jours/mois", () => {
    const column = toStayRatesColumn(
      draft({
        seasonMonths: [12, 1],
        seasonSurchargePct: "10",
        includes: ["Wifi", "", "  ", "Piscina"],
      }),
    );
    expect(column?.season.months).toEqual([1, 12]);
    expect(column?.includes).toEqual(["Wifi", "Piscina"]);
  });

  it("dépôt et note vides → null explicite", () => {
    const column = toStayRatesColumn(draft({ depositCop: "150000" }));
    expect(column?.deposit_cop).toBe(150000);
    expect(column?.extra_note).toBeNull();
  });
});

describe("stayRatesFromColumn", () => {
  it("valeur absente ou invalide → brouillon vide", () => {
    expect(stayRatesFromColumn(null)).toEqual(emptyStayRates());
    expect(stayRatesFromColumn(undefined)).toEqual(emptyStayRates());
    expect(stayRatesFromColumn("pas un objet")).toEqual(emptyStayRates());
  });

  it("aller-retour toStayRatesColumn → stayRatesFromColumn préserve les valeurs saisies", () => {
    // Mois/jours déjà triés : toStayRatesColumn trie à l'écriture, un ordre différent en entrée
    // ferait échouer la comparaison stricte ci-dessous sans que ce soit un bug.
    const original = draft({
      seasonMonths: [1, 12],
      seasonSurchargePct: "20",
      seasonNote: "Diciembre y enero",
      weekendDays: [5, 6, 7],
      weekendSurchargePct: "15",
      includes: ["Wifi", "Piscina"],
      depositCop: "200000",
      extraNote: "Llevar toalla",
    });
    const column = toStayRatesColumn(original);
    expect(stayRatesFromColumn(column)).toEqual(original);
  });
});
