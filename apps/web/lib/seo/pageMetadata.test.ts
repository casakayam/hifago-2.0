// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPageMetadata } from "./pageMetadata";

const pathFor = (locale: string) => `/${locale}/productos/tour-lancha`;

describe("buildPageMetadata — page traduite", () => {
  it("pose un canonical auto-référent", () => {
    const meta = buildPageMetadata({ locale: "en", pathFor, title: "Boat tour" });
    expect(meta.alternates?.canonical).toBe("/en/productos/tour-lancha");
  });

  it("n'ajoute aucune directive robots — la page est indexable", () => {
    expect(buildPageMetadata({ locale: "es", pathFor, title: "Tour" }).robots).toBeUndefined();
  });

  it("déclare x-default sur l'espagnol", () => {
    const { languages } = buildPageMetadata({ locale: "es", pathFor, title: "Tour" }).alternates!;
    expect(languages).toMatchObject({
      es: "/es/productos/tour-lancha",
      en: "/en/productos/tour-lancha",
      "x-default": "/es/productos/tour-lancha",
    });
  });
});

describe("buildPageMetadata — page servie en repli", () => {
  const nativeLocales = ["es"];

  it("passe en noindex mais reste suivable", () => {
    const meta = buildPageMetadata({ locale: "en", pathFor, title: "Tour", nativeLocales });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("fait pointer le canonical vers la langue source, pas vers elle-même", () => {
    const meta = buildPageMetadata({ locale: "en", pathFor, title: "Tour", nativeLocales });
    expect(meta.alternates?.canonical).toBe("/es/productos/tour-lancha");
  });

  it("ne déclare PAS la locale non traduite comme une version linguistique", () => {
    const { languages } = buildPageMetadata({ locale: "en", pathFor, title: "Tour", nativeLocales })
      .alternates!;
    expect(languages).not.toHaveProperty("en");
    expect(languages).toMatchObject({ es: "/es/productos/tour-lancha", "x-default": "/es/productos/tour-lancha" });
  });

  it("fait pointer x-default vers la langue servie quand l'espagnol n'est pas traduit", () => {
    const meta = buildPageMetadata({ locale: "es", pathFor, title: "Boat", nativeLocales: ["en"] });
    expect(meta.alternates?.canonical).toBe("/en/productos/tour-lancha");
    expect(meta.alternates?.languages?.["x-default"]).toBe("/en/productos/tour-lancha");
  });
});

describe("buildPageMetadata — OpenGraph", () => {
  it("porte le territoire colombien pour l'espagnol et l'URL canonique", () => {
    const meta = buildPageMetadata({ locale: "es", pathFor, title: "Tour", description: "Guatapé" });
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: "Hifago",
      locale: "es_CO",
      url: "/es/productos/tour-lancha",
      title: "Tour",
      description: "Guatapé",
    });
  });

  it("fait pointer l'URL OpenGraph vers le canonical, jamais vers la page en repli", () => {
    const meta = buildPageMetadata({ locale: "en", pathFor, title: "Tour", nativeLocales: ["es"] });
    expect(meta.openGraph).toMatchObject({ url: "/es/productos/tour-lancha" });
  });
});
