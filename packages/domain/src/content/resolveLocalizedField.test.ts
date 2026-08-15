import { describe, expect, it } from "vitest";
import { resolveLocalizedField } from "./resolveLocalizedField";

describe("resolveLocalizedField", () => {
  it("retourne la valeur de la locale demandée quand elle existe", () => {
    expect(resolveLocalizedField({ es: "Hola", en: "Hello" }, "en")).toBe("Hello");
  });

  it("replie sur la locale de repli quand la locale demandée est absente", () => {
    expect(resolveLocalizedField({ es: "Hola" }, "en")).toBe("Hola");
  });

  it("replie sur une locale de repli personnalisée", () => {
    expect(resolveLocalizedField({ pt: "Olá" }, "en", "pt")).toBe("Olá");
  });

  it("replie sur n'importe quelle langue disponible si ni la locale demandée ni le repli n'existent", () => {
    expect(resolveLocalizedField({ pt: "Olá" }, "en")).toBe("Olá");
  });

  it("retourne null pour un champ vide (jamais une chaîne vide silencieuse)", () => {
    expect(resolveLocalizedField({}, "en")).toBeNull();
    expect(resolveLocalizedField(null, "en")).toBeNull();
    expect(resolveLocalizedField(undefined, "en")).toBeNull();
  });

  it("ignore une valeur vide et retombe sur une autre langue disponible", () => {
    expect(resolveLocalizedField({ es: "", en: "Hello" }, "es")).toBe("Hello");
  });
});
