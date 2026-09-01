// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import robots from "./robots";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("robots.txt hors production", () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = "preview";
  });

  it("interdit tout le site", () => {
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("n'annonce AUCUN sitemap — on n'indique pas un plan de site qu'on refuse de faire crawler", () => {
    expect(robots().sitemap).toBeUndefined();
  });

  it("reste fermé même quand l'URL configurée est celle de production", () => {
    // Le cas Vercel « All Environments » : l'URL de prod atteint les builds de preview.
    expect(robots().rules).toMatchObject({ disallow: "/" });
  });
});

describe("robots.txt en production", () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = "production";
  });

  it("ouvre le site et annonce le sitemap en URL absolue", () => {
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: "*", allow: "/" });
    expect(result.sitemap).toBe("https://hifago.co/sitemap.xml");
  });

  it("exclut du crawl les redirections d'attribution, dans les deux locales", () => {
    const { disallow } = robots().rules as { disallow: string[] };
    expect(disallow).toContain("/es/r/");
    expect(disallow).toContain("/en/r/");
  });

  it("n'émet AUCUN groupe User-Agent nommé", () => {
    // Un crawler nommé n'obéit qu'à son propre groupe et ignore `*` : un groupe par bot IA sans
    // répétition des Disallow les autoriserait là où le groupe générique les interdit.
    expect(Array.isArray(robots().rules)).toBe(false);
  });
});
