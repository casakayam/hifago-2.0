import { describe, expect, it } from "vitest";
import { resolvePageParams } from "./resolvePageParams";

describe("resolvePageParams", () => {
  it("retombe sur la page 1 quand le paramètre est absent", () => {
    expect(resolvePageParams({})).toEqual({ page: 1, pageSize: 20, from: 0, to: 19 });
  });

  it("lit la page demandée et calcule les bornes .range() correspondantes", () => {
    expect(resolvePageParams({ page: "3" })).toEqual({ page: 3, pageSize: 20, from: 40, to: 59 });
  });

  it("respecte une taille de page personnalisée", () => {
    expect(resolvePageParams({ page: "2" }, 10)).toEqual({ page: 2, pageSize: 10, from: 10, to: 19 });
  });

  it("retombe sur la page 1 pour une valeur non numérique, jamais une erreur", () => {
    expect(resolvePageParams({ page: "abc" })).toEqual({ page: 1, pageSize: 20, from: 0, to: 19 });
  });

  it("retombe sur la page 1 pour une valeur nulle ou négative", () => {
    expect(resolvePageParams({ page: "0" }).page).toBe(1);
    expect(resolvePageParams({ page: "-5" }).page).toBe(1);
  });

  it("prend la première valeur si le paramètre arrive en tableau", () => {
    expect(resolvePageParams({ page: ["4", "5"] }).page).toBe(4);
  });
});
