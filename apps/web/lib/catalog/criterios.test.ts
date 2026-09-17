import { describe, expect, it } from "vitest";
import {
  MAX_PAGINAS,
  escribirCriterios,
  hayCriterios,
  hrefAlojamientosCompatibles,
  hrefAlojamientosParaEvento,
  hrefRetornoCarrito,
  leerAlojamientoParaCamp,
  leerAlojamientoParaEvento,
  leerCriterios,
  leerDesdeCarrito,
  leerPagina,
} from "./criterios";

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

describe("leerPagina", () => {
  it("lit une page valide", () => {
    expect(leerPagina({ pagina: "3" })).toBe(3);
  });

  it("retombe sur 1 sur tout ce qui n'est pas un entier positif", () => {
    // Aucun de ces cas n'échoue : une URL est recopiée de travers, tronquée par un client mail,
    // ou fabriquée par un robot. La règle du dépôt est la même partout — ignoré, jamais 400.
    for (const valeur of ["abc", "0", "-2", "1.5", "", " ", undefined]) {
      expect(leerPagina({ pagina: valeur })).toBe(1);
    }
    expect(leerPagina({})).toBe(1);
  });

  it("⚠️ plafonne : une page hors bornes ne fait pas demander des millions de lignes", () => {
    // LE test de cette fonction. `pagina` multiplie la limite SQL, et ces pages sont publiques et
    // anonymes : sans ce plafond, `?pagina=99999` est un vecteur de charge à une seule requête.
    expect(leerPagina({ pagina: String(MAX_PAGINAS) })).toBe(MAX_PAGINAS);
    expect(leerPagina({ pagina: String(MAX_PAGINAS + 1) })).toBe(1);
    expect(leerPagina({ pagina: "99999" })).toBe(1);
  });

  it("ne fuit jamais dans les critères : escribirCriterios ne l'écrit pas", () => {
    // La régression qu'on empêche : `pagina` recopié dans les liens « Ver más » de l'accueil et
    // dans le canonical, deux endroits où il n'a rien à faire.
    const criterios = leerCriterios({ q: "kayak", pagina: "3" });
    expect(escribirCriterios(criterios)).toBe("?q=kayak");
  });
});

describe("leerDesdeCarrito", () => {
  it("répond vrai uniquement sur la valeur exacte \"1\"", () => {
    expect(leerDesdeCarrito({ desdeCarrito: "1" })).toBe(true);
    expect(leerDesdeCarrito({})).toBe(false);
    expect(leerDesdeCarrito({ desdeCarrito: "0" })).toBe(false);
    expect(leerDesdeCarrito({ desdeCarrito: "true" })).toBe(false);
  });

  it("prend la première valeur quand le paramètre est répété", () => {
    expect(leerDesdeCarrito({ desdeCarrito: ["1", "0"] })).toBe(true);
  });

  it("ne fuit jamais dans les critères : escribirCriterios ne l'écrit pas", () => {
    const criterios = leerCriterios({ q: "kayak", desdeCarrito: "1" });
    expect(escribirCriterios(criterios)).toBe("?q=kayak");
  });
});

describe("hrefRetornoCarrito", () => {
  it("pose le flag seul quand il n'y a aucun critère", () => {
    expect(hrefRetornoCarrito({})).toBe("/?desdeCarrito=1");
  });

  it("ajoute le flag à la suite des critères existants", () => {
    expect(hrefRetornoCarrito({ q: "kayak" })).toBe("/?q=kayak&desdeCarrito=1");
  });
});

describe("hrefAlojamientosCompatibles — redirection camp → hébergement (2026-09-15)", () => {
  it("construit /alojamientos avec desde/hasta/personas et le drapeau contextuel", () => {
    expect(
      hrefAlojamientosCompatibles({ desde: "2026-10-05", hasta: "2026-10-09", personas: 2 })
    ).toBe("/alojamientos?personas=2&desde=2026-10-05&hasta=2026-10-09&alojamientoParaCamp=1");
  });
});

describe("leerAlojamientoParaCamp", () => {
  it("répond vrai uniquement sur la valeur exacte \"1\"", () => {
    expect(leerAlojamientoParaCamp({ alojamientoParaCamp: "1" })).toBe(true);
    expect(leerAlojamientoParaCamp({})).toBe(false);
    expect(leerAlojamientoParaCamp({ alojamientoParaCamp: "0" })).toBe(false);
  });

  it("ne fuit jamais dans les critères : escribirCriterios ne l'écrit pas", () => {
    const criterios = leerCriterios({ q: "kayak", alojamientoParaCamp: "1" });
    expect(escribirCriterios(criterios)).toBe("?q=kayak");
  });
});

describe("hrefAlojamientosParaEvento — redirection evento → hébergement (2026-09-16)", () => {
  it("construit /alojamientos avec desde/hasta/personas et le drapeau contextuel evento", () => {
    expect(
      hrefAlojamientosParaEvento({ desde: "2026-10-05", hasta: "2026-10-06", personas: 2 })
    ).toBe("/alojamientos?personas=2&desde=2026-10-05&hasta=2026-10-06&alojamientoParaEvento=1");
  });
});

describe("leerAlojamientoParaEvento", () => {
  it("répond vrai uniquement sur la valeur exacte \"1\"", () => {
    expect(leerAlojamientoParaEvento({ alojamientoParaEvento: "1" })).toBe(true);
    expect(leerAlojamientoParaEvento({})).toBe(false);
    expect(leerAlojamientoParaEvento({ alojamientoParaEvento: "0" })).toBe(false);
  });

  it("ne fuit jamais dans les critères : escribirCriterios ne l'écrit pas", () => {
    const criterios = leerCriterios({ q: "kayak", alojamientoParaEvento: "1" });
    expect(escribirCriterios(criterios)).toBe("?q=kayak");
  });
});
