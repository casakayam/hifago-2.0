import { describe, expect, it } from "vitest";
import { limpiarDescripcion } from "./descripcionEditorial";

// Ce que ce fichier protège n'est PAS de la cosmétique de saisie : c'est l'indexation de la page de
// catégorie sur la vitrine. `hasNativeContent` (apps/web, partagé avec le sitemap) déclare une
// locale « native » dès que la chaîne est non blanche — une valeur vide conservée ferait donc
// indexer une page au texte vide, dans une langue où personne n'a rien écrit.

describe("limpiarDescripcion", () => {
  it("garde les langues réellement saisies, ébarbées", () => {
    expect(limpiarDescripcion({ es: "  Recorridos por el embalse  ", en: "Lake tours" })).toEqual({
      es: "Recorridos por el embalse",
      en: "Lake tours",
    });
  });

  // ⚠️ LE cas. Un admin qui rédige l'espagnol, bascule sur l'anglais, tape un espace et repart :
  // sans ce filtrage, la page `/en/actividades/<slug>` se déclarerait traduite et serait indexée
  // avec un texte vide.
  it("RETIRE une langue vide ou blanche, au lieu de la conserver à vide", () => {
    expect(limpiarDescripcion({ es: "Buceo guiado", en: "   " })).toEqual({ es: "Buceo guiado" });
    expect(limpiarDescripcion({ es: "Buceo guiado", en: "" })).toEqual({ es: "Buceo guiado" });
  });

  it("rend `null` quand rien n'est saisi — jamais un objet vide", () => {
    // `{}` vaudrait « objet présent mais vide » en base : il faudrait alors le distinguer de
    // `null` à chaque lecture, pour exactement le même sens.
    expect(limpiarDescripcion({})).toBeNull();
    expect(limpiarDescripcion({ es: "", en: "  " })).toBeNull();
  });

  it("n'invente aucune langue et ne réordonne rien", () => {
    // Le jeu de langues du CONTENU partenaire est ouvert (CLAUDE.md §5.1) : cette fonction ne
    // connaît ni `es` ni `en`, elle ne fait que filtrer ce qu'on lui donne.
    expect(limpiarDescripcion({ pt: "Passeios de barco" })).toEqual({ pt: "Passeios de barco" });
  });
});
