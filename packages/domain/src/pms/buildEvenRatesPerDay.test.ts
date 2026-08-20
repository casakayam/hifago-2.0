import { describe, expect, it } from "vitest";
import { buildEvenRatesPerDay } from "./buildEvenRatesPerDay";

describe("buildEvenRatesPerDay", () => {
  it("répartit également un total qui se divise sans reste", () => {
    expect(buildEvenRatesPerDay("2028-09-01", "2028-09-03", 200000)).toEqual([
      { date: "2028-09-01", price: 100000 },
      { date: "2028-09-02", price: 100000 },
    ]);
  });

  it("la somme reste EXACTEMENT le total même quand la division a un reste", () => {
    const rates = buildEvenRatesPerDay("2028-09-01", "2028-09-04", 100000);
    expect(rates).toHaveLength(3);
    const sum = rates.reduce((acc, r) => acc + r.price, 0);
    expect(sum).toBe(100000);
    // Les deux premières nuits portent la part entière (33333), la dernière absorbe le reste.
    expect(rates[0]).toEqual({ date: "2028-09-01", price: 33333 });
    expect(rates[1]).toEqual({ date: "2028-09-02", price: 33333 });
    expect(rates[2]).toEqual({ date: "2028-09-03", price: 33334 });
  });

  it("une seule nuit → tout le total sur cette nuit", () => {
    expect(buildEvenRatesPerDay("2028-09-01", "2028-09-02", 100000)).toEqual([
      { date: "2028-09-01", price: 100000 },
    ]);
  });

  it("end_date <= start_date → tableau vide, jamais une exception", () => {
    expect(buildEvenRatesPerDay("2028-09-03", "2028-09-01", 100000)).toEqual([]);
    expect(buildEvenRatesPerDay("2028-09-01", "2028-09-01", 100000)).toEqual([]);
  });
});
