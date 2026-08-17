import { describe, expect, it } from "vitest";
import { emptyTier } from "./priceTiers";
import { emptyStayRates } from "./stayRates";
import { emptyRoomType, toRoomTypeRows, validateRoomTypes, type DraftRoomType } from "./hotelRooms";

function room(overrides: Partial<DraftRoomType> = {}): DraftRoomType {
  return { ...emptyRoomType(), capacity: "6", priceCop: "40000", ...overrides };
}

describe("validateRoomTypes", () => {
  it("un tableau vide est valide — les chambres restent optionnelles à la saisie", () => {
    expect(validateRoomTypes([])).toBeNull();
  });

  it("une chambre en prix simple, entièrement remplie, est valide", () => {
    expect(validateRoomTypes([room()])).toBeNull();
  });

  it("capacité manquante ou non entière → erreur", () => {
    expect(validateRoomTypes([room({ capacity: "0" })])).toMatch(/capacidad/);
    expect(validateRoomTypes([room({ capacity: "abc" })])).toMatch(/capacidad/);
  });

  it("quantité renseignée mais non entière → erreur ; quantité vide acceptée", () => {
    expect(validateRoomTypes([room({ quantity: "0" })])).toMatch(/cantidad de habitaciones/);
    expect(validateRoomTypes([room({ quantity: "" })])).toBeNull();
  });

  it("prix simple manquant ou <= 0 → erreur", () => {
    expect(validateRoomTypes([room({ priceCop: "0" })])).toMatch(/precio/);
    expect(validateRoomTypes([room({ priceCop: "" })])).toMatch(/precio/);
  });

  it("prix par tramos invalides → erreur remontée de validatePriceTiers", () => {
    const invalid = room({
      priceMode: "tiers",
      priceTiers: [{ minQty: "", maxQty: "", priceCop: "" }],
    });
    expect(validateRoomTypes([invalid])).toMatch(/tramo/);
  });

  it("prix par tramos valides → valide", () => {
    const valid = room({
      priceMode: "tiers",
      priceTiers: [{ minQty: "1", maxQty: "2", priceCop: "50000" }],
    });
    expect(validateRoomTypes([valid])).toBeNull();
  });

  it("cantidad mínima > máxima → erreur", () => {
    expect(validateRoomTypes([room({ minQty: "5", maxQty: "2" })])).toMatch(/mínima/);
  });

  it("prix par période (stay_rates) invalide → erreur remontée de validateStayRates", () => {
    const invalid = room({ stayRates: { ...emptyStayRates(), seasonSurchargePct: "20" } });
    expect(validateRoomTypes([invalid])).toMatch(/mes/);
  });
});

describe("emptyRoomType", () => {
  it("part sur un dortoir, prix simple, un tramo vide, tout le reste vide", () => {
    expect(emptyRoomType()).toEqual({
      kind: "dorm",
      name: {},
      description: {},
      capacity: "",
      quantity: "",
      priceMode: "simple",
      priceCop: "",
      priceTiers: [emptyTier()],
      minQty: "",
      maxQty: "",
      stayRates: emptyStayRates(),
      photos: [],
      savedPhotos: [],
    });
  });
});

describe("toRoomTypeRows", () => {
  it("nom vide → repli sur un libellé dérivé du type", () => {
    const rows = toRoomTypeRows([room({ kind: "dorm", name: {} }), room({ kind: "private", name: {} })]);
    expect(rows[0].name).toEqual({ es: "Dormitorio" });
    expect(rows[1].name).toEqual({ es: "Habitación privada" });
  });

  it("nom renseigné → conservé tel quel, description vide → null", () => {
    const rows = toRoomTypeRows([room({ name: { es: "Dormitorio mixto", en: "Mixed dorm" } })]);
    expect(rows[0].name).toEqual({ es: "Dormitorio mixto", en: "Mixed dorm" });
    expect(rows[0].description).toBeNull();
  });

  it("kind est conservé tel quel, indépendamment du nom", () => {
    const rows = toRoomTypeRows([room({ kind: "private", name: { es: "Habitación doble" } })]);
    expect(rows[0].kind).toBe("private");
  });

  it("min_qty/max_qty renseignés → convertis en nombres, pas seulement en null", () => {
    const rows = toRoomTypeRows([room({ minQty: "1", maxQty: "4" })]);
    expect(rows[0].min_qty).toBe(1);
    expect(rows[0].max_qty).toBe(4);
  });

  it("prix simple → price_tiers null, price_cop = le prix saisi", () => {
    const rows = toRoomTypeRows([room({ priceCop: "45000" })]);
    expect(rows[0].price_cop).toBe(45000);
    expect(rows[0].price_tiers).toBeNull();
  });

  it("prix par tramos → price_cop = tramo le plus bas, price_tiers rempli", () => {
    const rows = toRoomTypeRows([
      room({
        priceMode: "tiers",
        priceTiers: [
          { minQty: "3", maxQty: "4", priceCop: "80000" },
          { minQty: "1", maxQty: "2", priceCop: "60000" },
        ],
      }),
    ]);
    expect(rows[0].price_cop).toBe(60000);
    expect(rows[0].price_tiers).toEqual([
      { min_qty: 3, max_qty: 4, price_cop: 80000 },
      { min_qty: 1, max_qty: 2, price_cop: 60000 },
    ]);
  });

  it("stay_rates vide → null ; renseigné → converti (mécanisme spec 12 réutilisé tel quel)", () => {
    expect(toRoomTypeRows([room()])[0].stay_rates).toBeNull();
    const withStayRates = room({
      stayRates: { ...emptyStayRates(), seasonMonths: [12, 1], seasonSurchargePct: "20" },
    });
    const rows = toRoomTypeRows([withStayRates]);
    expect(rows[0].stay_rates?.season.months).toEqual([1, 12]);
    expect(rows[0].stay_rates?.season.surcharge_pct).toBe(0.2);
  });

  it("quantité/min/max vides → null ; sort respecte l'ordre du tableau", () => {
    const rows = toRoomTypeRows([room(), room()]);
    expect(rows[0].quantity).toBeNull();
    expect(rows[0].min_qty).toBeNull();
    expect(rows[0].max_qty).toBeNull();
    expect(rows[0].sort).toBe(0);
    expect(rows[1].sort).toBe(1);
  });
});
