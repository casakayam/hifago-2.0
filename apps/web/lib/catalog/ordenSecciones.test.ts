import { describe, expect, it } from "vitest";
import { ordenarTipos } from "./ordenSecciones";

// Spec 28 Tranche 3 (cahier §2b.5) : absents d'abord dans l'ordre habituel, présents ensuite dans
// le leur. `ORDEN_SECCIONES` = ["activity", "lodging", "transport", "camp", "evento"].

describe("ordenarTipos", () => {
  it("garde l'ordre habituel quand le panier est vide", () => {
    expect(ordenarTipos(new Set())).toEqual([
      "activity",
      "lodging",
      "transport",
      "camp",
      "evento",
    ]);
  });

  it("garde l'ordre habituel quand les cinq types sont au panier", () => {
    // Tous présents : la partition ne fait que déplacer un groupe vide, l'ordre relatif ne bouge pas.
    expect(
      ordenarTipos(new Set(["activity", "lodging", "transport", "camp", "evento"]))
    ).toEqual(["activity", "lodging", "transport", "camp", "evento"]);
  });

  it("pousse un seul type présent en dernier, sans toucher au reste", () => {
    expect(ordenarTipos(new Set(["lodging"]))).toEqual([
      "activity",
      "transport",
      "camp",
      "evento",
      "lodging",
    ]);
  });

  it("⚠️ garde l'ordre HABITUEL des présents entre eux, pas l'ordre d'ajout au panier", () => {
    // `camp` ajouté avant `activity` au panier ne doit pas faire passer `camp` devant `activity`
    // parmi les types déjà présents — c'est précisément ce qui distingue cette règle de la
    // variante écartée « suivre le dernier ajout ».
    expect(ordenarTipos(new Set(["camp", "activity"]))).toEqual([
      "lodging",
      "transport",
      "evento",
      "activity",
      "camp",
    ]);
  });
});
