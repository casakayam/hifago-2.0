import { describe, expect, it } from "vitest";
import {
  emptyGroupDiscount,
  groupDiscountFromColumns,
  toGroupDiscountColumns,
  validateGroupDiscount,
} from "./groupDiscount";

describe("validateGroupDiscount", () => {
  it("les deux champs vides sont valides — pas de remise configurée pour ce camp", () => {
    expect(validateGroupDiscount(emptyGroupDiscount())).toBeNull();
  });

  it("seuil rempli sans pourcentage → erreur (miroir du CHECK SQL pair)", () => {
    expect(validateGroupDiscount({ thresholdQty: "16", pct: "" })).toMatch(/juntos/);
  });

  it("pourcentage rempli sans seuil → erreur", () => {
    expect(validateGroupDiscount({ thresholdQty: "", pct: "20" })).toMatch(/juntos/);
  });

  it("seuil non entier ou < 1 → erreur", () => {
    expect(validateGroupDiscount({ thresholdQty: "0", pct: "20" })).toMatch(/entero/);
    expect(validateGroupDiscount({ thresholdQty: "3.5", pct: "20" })).toMatch(/entero/);
  });

  it("pourcentage hors 0-100 (exclusif) → erreur", () => {
    expect(validateGroupDiscount({ thresholdQty: "16", pct: "0" })).toMatch(/porcentaje/);
    expect(validateGroupDiscount({ thresholdQty: "16", pct: "100" })).toMatch(/porcentaje/);
    expect(validateGroupDiscount({ thresholdQty: "16", pct: "-5" })).toMatch(/porcentaje/);
  });

  it("seuil et pourcentage valides → aucune erreur", () => {
    expect(validateGroupDiscount({ thresholdQty: "16", pct: "20" })).toBeNull();
  });
});

describe("toGroupDiscountColumns / groupDiscountFromColumns", () => {
  it("brouillon vide → les deux colonnes null", () => {
    expect(toGroupDiscountColumns(emptyGroupDiscount())).toEqual({
      group_discount_threshold_qty: null,
      group_discount_pct: null,
    });
  });

  it("pourcentage entier lisible (20) → fraction en colonne (0.20)", () => {
    expect(toGroupDiscountColumns({ thresholdQty: "16", pct: "20" })).toEqual({
      group_discount_threshold_qty: 16,
      group_discount_pct: 0.2,
    });
  });

  it("aller-retour colonne → brouillon → colonne, exemple de Jérôme (camp 20 places, seuil 16, -20%)", () => {
    const draft = groupDiscountFromColumns(16, 0.2);
    expect(draft).toEqual({ thresholdQty: "16", pct: "20" });
    expect(toGroupDiscountColumns(draft)).toEqual({
      group_discount_threshold_qty: 16,
      group_discount_pct: 0.2,
    });
  });

  it("colonnes null → brouillon vide", () => {
    expect(groupDiscountFromColumns(null, null)).toEqual(emptyGroupDiscount());
    expect(groupDiscountFromColumns(undefined, undefined)).toEqual(emptyGroupDiscount());
  });
});
