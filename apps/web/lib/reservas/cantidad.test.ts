import { describe, expect, it } from "vitest";
import { limitarCantidad } from "./cantidad";

describe("limitarCantidad", () => {
  it("laisse passer une valeur dans les bornes", () => {
    expect(limitarCantidad(3, 8)).toBe(3);
  });

  it("remonte à 1 ce qui est sous la borne basse", () => {
    expect(limitarCantidad(0, 8)).toBe(1);
    expect(limitarCantidad(-5, 8)).toBe(1);
  });

  it("plafonne au maximum", () => {
    expect(limitarCantidad(99, 8)).toBe(8);
  });

  it("un maximum de zéro laisse quand même saisir 1 — sinon la borne haute passe sous la basse", () => {
    expect(limitarCantidad(1, 0)).toBe(1);
    expect(limitarCantidad(5, 0)).toBe(1);
  });

  it("NaN retombe sur 1 — c'est la garde qui n'existait que dans UN des trois formulaires", () => {
    // `Math.max(NaN, 1)` vaut NaN, et `setQty(NaN)` passait sans rien casser de visible :
    // le champ se vidait, le bouton restait actif. Spec 30 §7a, duplication n°1.
    expect(limitarCantidad(Number.NaN, 8)).toBe(1);
  });

  it("l'infini retombe sur 1, jamais sur le maximum", () => {
    // Un plafonnement à `max` serait défendable, mais un nombre non fini vient toujours d'une
    // saisie cassée : repartir de 1 est le seul comportement qui ne prétend rien.
    expect(limitarCantidad(Number.POSITIVE_INFINITY, 8)).toBe(1);
    expect(limitarCantidad(Number.NEGATIVE_INFINITY, 8)).toBe(1);
  });
});
