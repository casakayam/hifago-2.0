// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { getSiteUrl, isProductionSite } from "./siteUrl";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getSiteUrl", () => {
  it("replie sur le port de dev local quand la variable est absente", () => {
    delete process.env.NEXT_PUBLIC_WEB_APP_URL;
    expect(getSiteUrl()).toBe("http://localhost:3100");
  });

  it("retire la barre oblique finale — sinon metadataBase produirait des URL à double slash", () => {
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co/";
    expect(getSiteUrl()).toBe("https://hifago.co");
  });

  it("traite une variable vide ou blanche comme absente", () => {
    process.env.NEXT_PUBLIC_WEB_APP_URL = "   ";
    expect(getSiteUrl()).toBe("http://localhost:3100");
  });
});

describe("isProductionSite", () => {
  it("est faux hors production, même si l'URL configurée est celle de production", () => {
    // Le cas qui motive ce prédicat : une variable Vercel « All Environments » porte l'URL de
    // production jusque dans les builds de preview. Seul VERCEL_ENV distingue les deux.
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
    process.env.VERCEL_ENV = "preview";
    expect(isProductionSite()).toBe(false);
  });

  it("est faux quand VERCEL_ENV est absent (dev local, CI)", () => {
    delete process.env.VERCEL_ENV;
    expect(isProductionSite()).toBe(false);
  });

  it("n'est vrai que sur le déploiement de production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isProductionSite()).toBe(true);
  });
});
