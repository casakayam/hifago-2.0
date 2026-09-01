// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildEstablishmentJsonLd } from "./establishment";

const base = {
  siteUrl: "https://hifago.co",
  locale: "es",
  slug: "casa-kayam",
  name: "Casa Kayam",
};

describe("buildEstablishmentJsonLd — type de lieu", () => {
  it("est un LodgingBusiness quand on y dort", () => {
    expect(buildEstablishmentJsonLd({ ...base, mode: "rooms" })["@type"]).toBe("LodgingBusiness");
    expect(buildEstablishmentJsonLd({ ...base, mode: "whole_house" })["@type"]).toBe(
      "LodgingBusiness"
    );
  });

  it("est un LocalBusiness quand le lieu n'héberge pas", () => {
    expect(buildEstablishmentJsonLd({ ...base, mode: null })["@type"]).toBe("LocalBusiness");
  });
});

describe("buildEstablishmentJsonLd — adresse et coordonnées", () => {
  it("émet l'adresse telle quelle avec le seul composant garanti, le pays", () => {
    // Aucune décomposition n'est persistée : ni ville, ni code postal, ni région.
    expect(buildEstablishmentJsonLd({ ...base, address: "Vereda La Peña, Guatapé" }).address)
      .toMatchObject({
        "@type": "PostalAddress",
        streetAddress: "Vereda La Peña, Guatapé",
        addressCountry: "CO",
      });
  });

  it("n'invente ni ville ni code postal", () => {
    const json = JSON.stringify(buildEstablishmentJsonLd({ ...base, address: "Guatapé" }));
    expect(json).not.toMatch(/addressLocality|postalCode|addressRegion/);
  });

  it("émet geo quand les coordonnées existent", () => {
    expect(buildEstablishmentJsonLd({ ...base, latitude: 6.2329, longitude: -75.1585 }).geo)
      .toMatchObject({ "@type": "GeoCoordinates", latitude: 6.2329, longitude: -75.1585 });
  });

  it("OMET geo quand les coordonnées sont absentes", () => {
    // Elles le sont souvent : le seed ne les peuple jamais. Des coordonnées nulles placeraient
    // l'établissement au large du golfe de Guinée.
    expect(buildEstablishmentJsonLd({ ...base, latitude: null, longitude: null })).not.toHaveProperty("geo");
  });

  it("OMET geo quand une seule des deux coordonnées existe", () => {
    expect(buildEstablishmentJsonLd({ ...base, latitude: 6.2329, longitude: null })).not.toHaveProperty("geo");
  });
});

describe("buildEstablishmentJsonLd — ce qui n'est jamais émis", () => {
  it("porte les horaires d'arrivée et de départ, jamais des heures d'ouverture", () => {
    const result = buildEstablishmentJsonLd({
      ...base,
      mode: "rooms",
      checkInTime: "15:00:00",
      checkOutTime: "11:00:00",
    });
    expect(result).toMatchObject({ checkinTime: "15:00:00", checkoutTime: "11:00:00" });
    expect(JSON.stringify(result)).not.toMatch(/openingHours/);
  });

  it("n'émet ni contact ni notation — les colonnes n'existent pas ou ne sont pas publiques", () => {
    const json = JSON.stringify(
      buildEstablishmentJsonLd({ ...base, mode: "rooms", address: "Guatapé", latitude: 6.2, longitude: -75.1 })
    );
    expect(json).not.toMatch(/telephone|"email"|aggregateRating|ratingValue|"review"/);
  });
});
