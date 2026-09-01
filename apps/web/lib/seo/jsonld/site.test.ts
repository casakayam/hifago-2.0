// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildWebSiteJsonLd } from "./site";

describe("buildWebSiteJsonLd", () => {
  it("nomme le site et pointe vers l'accueil de la locale", () => {
    expect(buildWebSiteJsonLd("https://hifago.co", "es", "Hifago", "Actividades en Guatapé")).toMatchObject({
      "@type": "WebSite",
      name: "Hifago",
      description: "Actividades en Guatapé",
      url: "https://hifago.co/es",
      inLanguage: "es",
    });
  });

  it("n'annonce ni logo ni action de recherche", () => {
    // Pas d'asset de marque, et la recherche du catalogue est un filtre en mémoire sans URL de
    // résultats : déclarer l'un ou l'autre serait une promesse creuse.
    const json = JSON.stringify(buildWebSiteJsonLd("https://hifago.co", "es", "Hifago"));
    expect(json).not.toMatch(/logo|potentialAction|SearchAction/);
  });
});
