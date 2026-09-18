import { describe, expect, it } from "vitest";
import { resolverPrograma } from "./programa";

const PROGRAMA = [
  { day: 1, text: { es: "Recogida en Medellín", en: "Pickup in Medellín" } },
  { day: 2, text: { es: "Lancha por el embalse" } },
  { day: 1, text: { es: "Fogata", en: "Campfire" } },
];

describe("resolverPrograma", () => {
  it("regroupe par journée en préservant l'ordre d'apparition des lignes", () => {
    expect(resolverPrograma(PROGRAMA, "es")).toEqual([
      { dia: 1, lineas: ["Recogida en Medellín", "Fogata"] },
      { dia: 2, lineas: ["Lancha por el embalse"] },
    ]);
  });

  it("résout la locale demandée", () => {
    expect(resolverPrograma(PROGRAMA, "en")?.[0].lineas).toEqual(["Pickup in Medellín", "Campfire"]);
  });

  it("retombe sur l'espagnol pour une ligne non traduite — c'est le repli, pas un défaut", () => {
    expect(resolverPrograma(PROGRAMA, "en")?.[1].lineas).toEqual(["Lancha por el embalse"]);
  });

  it("trie les journées même si la colonne ne l'est pas", () => {
    expect(resolverPrograma([{ day: 3, text: { es: "C" } }, { day: 1, text: { es: "A" } }], "es"))
      .toEqual([{ dia: 1, lineas: ["A"] }, { dia: 3, lineas: ["C"] }]);
  });

  it("rend null plutôt que de throw sur une colonne absente ou corrompue", () => {
    for (const valeur of [null, undefined, {}, "texto", 7, [], [null], [{ day: 0, text: { es: "x" } }],
                          [{ day: 1 }], [{ day: 1, text: { es: "   " } }]]) {
      expect(() => resolverPrograma(valeur, "es")).not.toThrow();
      expect(resolverPrograma(valeur, "es")).toBeNull();
    }
  });

  it("ignore une ligne illisible sans jeter tout le programme", () => {
    expect(resolverPrograma([{ day: 1, text: { es: "Sí" } }, { day: 2, text: null }], "es"))
      .toEqual([{ dia: 1, lineas: ["Sí"] }]);
  });
});
