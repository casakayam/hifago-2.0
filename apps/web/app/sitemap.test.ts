// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock du seul client que le sitemap utilise. Même forme que les mocks déjà en place dans
// app/api/pms/*/route.test.ts : un builder chaînable, thenable en bout de chaîne.
const state = vi.hoisted(() => ({
  products: [] as unknown[],
  establishments: [] as unknown[],
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/publicClient", () => ({
  createPublicClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: table === "products" ? state.products : state.establishments,
            error: state.error,
          }).then(resolve),
      });
      return builder;
    },
  }),
}));

import sitemap from "./sitemap";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
  state.products = [];
  state.establishments = [];
  state.error = null;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

const urls = (entries: Awaited<ReturnType<typeof sitemap>>) => entries.map((e) => e.url);

describe("sitemap — accueil", () => {
  it("liste l'accueil dans les deux locales, en URL absolues", async () => {
    expect(urls(await sitemap())).toEqual(["https://hifago.co/es", "https://hifago.co/en"]);
  });

  it("porte x-default sur l'accueil, pointé vers l'espagnol", async () => {
    const [es] = await sitemap();
    expect(es.alternates?.languages).toMatchObject({
      es: "https://hifago.co/es",
      en: "https://hifago.co/en",
      "x-default": "https://hifago.co/es",
    });
  });
});

describe("sitemap — une entrée par locale réellement traduite", () => {
  it("produit deux entrées pour une fiche bilingue, chacune avec la carte complète", async () => {
    state.products = [
      { slug: "tour-lancha", name: { es: "Tour en lancha", en: "Boat tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entries = await sitemap();
    expect(urls(entries)).toContain("https://hifago.co/es/products/tour-lancha");
    expect(urls(entries)).toContain("https://hifago.co/en/products/tour-lancha");

    const en = entries.find((e) => e.url.includes("/en/products/"));
    expect(en?.alternates?.languages).toMatchObject({
      es: "https://hifago.co/es/products/tour-lancha",
      en: "https://hifago.co/en/products/tour-lancha",
      "x-default": "https://hifago.co/es/products/tour-lancha",
    });
  });

  it("n'émet QUE la locale traduite quand la fiche n'existe que dans une langue", async () => {
    // La page /es serait servie en repli, donc noindex (§5.3) : elle n'a rien à faire au sitemap.
    state.products = [
      { slug: "boat-only", name: { en: "Boat tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entries = await sitemap();
    expect(urls(entries)).toContain("https://hifago.co/en/products/boat-only");
    expect(urls(entries)).not.toContain("https://hifago.co/es/products/boat-only");
  });

  it("fait pointer x-default vers la langue servie quand l'espagnol n'est pas traduit", async () => {
    state.products = [
      { slug: "boat-only", name: { en: "Boat tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entry = (await sitemap()).find((e) => e.url.includes("boat-only"));
    // Jamais une URL qu'on vient de déclarer non indexable.
    expect(entry?.alternates?.languages?.["x-default"]).toBe("https://hifago.co/en/products/boat-only");
  });

  it("écarte une fiche sans aucune locale d'interface traduite", async () => {
    // Contenu saisi en français : aucune route publique dédiée, aucune entrée (§5.4).
    state.products = [
      { slug: "seulement-fr", name: { fr: "Tour en bateau" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    expect(urls(await sitemap()).some((u) => u.includes("seulement-fr"))).toBe(false);
  });

  it("écarte une fiche dont le champ JSONB est un scalaire", async () => {
    state.products = [{ slug: "casse", name: "Tour", updated_at: "2026-08-30T10:00:00Z" }];
    expect(urls(await sitemap()).some((u) => u.includes("casse"))).toBe(false);
  });
});

describe("sitemap — établissements et métadonnées d'entrée", () => {
  it("liste les établissements sous leur propre chemin", async () => {
    state.establishments = [
      { slug: "casa-kayam", name: { es: "Casa Kayam", en: "Casa Kayam" }, updated_at: "2026-08-29T08:00:00Z" },
    ];
    expect(urls(await sitemap())).toContain("https://hifago.co/es/establishments/casa-kayam");
  });

  it("reporte updated_at en lastModified", async () => {
    state.products = [
      { slug: "tour-lancha", name: { es: "Tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entry = (await sitemap()).find((e) => e.url.includes("tour-lancha"));
    expect(entry?.lastModified).toBe("2026-08-30T10:00:00Z");
  });

  it("trace une erreur de lecture au lieu de rendre un sitemap vide en silence", async () => {
    // Ne protège PAS du build sans base (un mock rend toujours des données) — le garde-fou réel
    // est le smoke test de bascule. Ici on vérifie seulement qu'une panne laisse une trace.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.error = { message: "connexion refusée" };
    await sitemap();
    expect(spy).toHaveBeenCalled();
  });
});
