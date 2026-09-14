import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardarUltimosCriterios, leerUltimosCriterios } from "./ultimosCriterios";

beforeEach(() => {
  sessionStorage.clear();
});

describe("guardarUltimosCriterios / leerUltimosCriterios — aller-retour", () => {
  it("relit exactement ce qui a été écrit", () => {
    guardarUltimosCriterios("?q=kayak&personas=2&desde=2026-03-12&hasta=2026-03-15");
    expect(leerUltimosCriterios()).toEqual({
      q: "kayak",
      personas: 2,
      desde: "2026-03-12",
      hasta: "2026-03-15",
    });
  });

  it("rend {} quand rien n'a jamais été écrit", () => {
    expect(leerUltimosCriterios()).toEqual({});
  });

  it("écrit sans condition : une chaîne vide efface la mémoire précédente", () => {
    // Un visiteur qui a cherché « kayak » puis a effacé sa recherche doit voir la mémoire suivre —
    // pas rester bloquée sur « kayak ».
    guardarUltimosCriterios("?q=kayak");
    guardarUltimosCriterios("");
    expect(leerUltimosCriterios()).toEqual({});
  });

  it("survit à un contenu corrompu dans le stockage", () => {
    sessionStorage.setItem("hifago:ultimosCriterios", "n'importe quoi %%%");
    expect(leerUltimosCriterios()).toEqual({});
  });
});

describe("rien n'échoue jamais, même si sessionStorage lève", () => {
  it("guardarUltimosCriterios avale une exception de setItem", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => guardarUltimosCriterios("?q=kayak")).not.toThrow();
    spy.mockRestore();
  });

  it("leerUltimosCriterios avale une exception de getItem et rend {}", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(leerUltimosCriterios()).toEqual({});
    spy.mockRestore();
  });
});
