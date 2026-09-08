import { describe, expect, it } from "vitest";
import { escribirCriterios, hayCriterios, leerCriterios } from "./criterios";

// Les deux règles que ce module existe pour tenir (spec 28 §7) : rien n'échoue jamais, et une même
// recherche produit toujours la même URL. Les cas ci-dessous sont ceux qu'un humain ou un robot
// produit réellement — pas des cas d'école.

describe("leerCriterios — rien n'échoue jamais", () => {
  it("ignore un nombre de personnes qui n'en est pas un", () => {
    expect(leerCriterios({ personas: "abc" })).toEqual({});
    expect(leerCriterios({ personas: "2.5" })).toEqual({});
    expect(leerCriterios({ personas: "0" })).toEqual({});
    expect(leerCriterios({ personas: "-3" })).toEqual({});
  });

  it("ignore un type et une date qui n'existent pas", () => {
    expect(leerCriterios({ tipo: "hotel" })).toEqual({});
    expect(leerCriterios({ desde: "12/03/2026" })).toEqual({});
    // Passe la regex mais n'existe pas : février n'a jamais 31 jours.
    expect(leerCriterios({ desde: "2026-02-31", hasta: "2026-03-02" })).toEqual({
      desde: "2026-03-02",
      hasta: "2026-03-02",
    });
  });

  it("prend la première valeur quand un paramètre est répété", () => {
    expect(leerCriterios({ q: ["kayak", "buceo"] })).toEqual({ q: "kayak" });
  });

  it("traite une chaîne vide ou blanche comme une absence", () => {
    expect(leerCriterios({ q: "", tag: "   " })).toEqual({});
  });
});

describe("leerCriterios — les dates vont par deux", () => {
  it("transforme une date unique en journée", () => {
    expect(leerCriterios({ desde: "2026-03-12" })).toEqual({
      desde: "2026-03-12",
      hasta: "2026-03-12",
    });
    expect(leerCriterios({ hasta: "2026-03-12" })).toEqual({
      desde: "2026-03-12",
      hasta: "2026-03-12",
    });
  });

  it("ignore une plage inversée EN ENTIER plutôt que de la réordonner", () => {
    // Réordonner ferait chercher autre chose que ce qui est écrit dans l'URL, en silence.
    expect(leerCriterios({ desde: "2026-03-20", hasta: "2026-03-12" })).toEqual({});
  });

  it("accepte une plage d'un seul jour", () => {
    expect(leerCriterios({ desde: "2026-03-12", hasta: "2026-03-12" })).toEqual({
      desde: "2026-03-12",
      hasta: "2026-03-12",
    });
  });
});

describe("escribirCriterios — une recherche, une seule URL", () => {
  it("n'écrit rien quand il n'y a aucun critère", () => {
    expect(escribirCriterios({})).toBe("");
  });

  it("n'écrit jamais un paramètre vide", () => {
    expect(escribirCriterios({ q: "", personas: 0 })).toBe("");
  });

  it("n'écrit une date que si les deux sont posées", () => {
    expect(escribirCriterios({ desde: "2026-03-12" })).toBe("");
  });

  it("fait un aller-retour stable", () => {
    const criterios = {
      q: "kayak",
      tipo: "activity" as const,
      tag: "nautica",
      personas: 3,
      desde: "2026-03-12",
      hasta: "2026-03-15",
    };
    const url = escribirCriterios(criterios);
    const params = Object.fromEntries(new URLSearchParams(url.slice(1)));
    expect(leerCriterios(params)).toEqual(criterios);
  });
});

describe("hayCriterios", () => {
  it("distingue une recherche vide d'une recherche filtrée", () => {
    expect(hayCriterios({})).toBe(false);
    expect(hayCriterios({ q: "kayak" })).toBe(true);
  });
});
