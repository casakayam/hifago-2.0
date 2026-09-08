// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Même patron de mock que buscar.test.ts : on ne simule que ce que le module utilise — ici, `rpc`
// seul (une suggestion ne porte aucune photo, donc aucun appel à Storage).
const state = vi.hoisted(() => ({
  filas: [] as unknown[],
  error: null as { message: string } | null,
  llamadas: [] as { nombre: string; args: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/publicClient", () => ({
  createPublicClient: () => ({
    rpc: (nombre: string, args: Record<string, unknown>) => {
      state.llamadas.push({ nombre, args });
      return Promise.resolve({ data: state.filas, error: state.error });
    },
    storage: {
      from: () => ({
        getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://cdn.test/${ruta}` } }),
      }),
    },
  }),
}));

import { buscarSugerencias } from "./sugerencias";

function fila(over: Record<string, unknown> = {}) {
  return {
    tipo: "activity",
    es_establecimiento: false,
    id: "11111111-1111-1111-1111-111111111111",
    slug: "kayak-embalse",
    nombre: { es: "Kayak en el embalse", en: "Kayak on the lake" },
    descripcion: { es: "Descripción" },
    precio_cop: 45000,
    precio_desde: null,
    precio_label: null,
    establecimiento: { slug: "casa-kayam", nombre: { es: "Casa Kayam" } },
    fotos: [{ storage_path: "a.webp" }],
    total_seccion: 9,
    rango_seccion: 1,
    ...over,
  };
}

beforeEach(() => {
  state.filas = [];
  state.error = null;
  state.llamadas = [];
});

describe("buscarSugerencias", () => {
  it("⚠️ n'interroge PAS la base sous deux caractères", async () => {
    // Une barre qui interroge le catalogue dès la première lettre fait une requête par frappe, pour
    // un résultat qui ne veut rien dire. Le seuil est ici, pas seulement dans l'anti-rebond client.
    expect(await buscarSugerencias("", { locale: "es" })).toEqual([]);
    expect(await buscarSugerencias("k", { locale: "es" })).toEqual([]);
    expect(await buscarSugerencias("  a  ", { locale: "es" })).toEqual([]);
    expect(state.llamadas).toHaveLength(0);
  });

  it("cherche dès deux caractères, sur le texte détouré", async () => {
    await buscarSugerencias("  ka  ", { locale: "es" });
    expect(state.llamadas).toHaveLength(1);
    expect(state.llamadas[0].nombre).toBe("search_catalog");
    expect(state.llamadas[0].args.p_query).toBe("ka");
  });

  it("⚠️ ne demande AUCUN plafond par type : les meilleures correspondances, pas huit par section", async () => {
    await buscarSugerencias("kayak", { locale: "es" });
    expect(state.llamadas[0].args).not.toHaveProperty("p_por_tipo");
  });

  it("transmet la limite demandée — multipliée par la réserve — et six par défaut", async () => {
    // ⚠️ Ce test affirmait `p_limite === limite` avant le 2026-09-08. Il encodait donc le défaut
    // qu'il était censé protéger : demander exactement le nombre affiché à une requête triée PAR
    // TYPE, c'est demander « les six premières activités ». Le facteur cinq (une section) est ce
    // qui garantit d'atteindre la dernière — voir le bloc « L'ORDRE » plus bas.
    await buscarSugerencias("kayak", { locale: "es" });
    expect(state.llamadas[0].args.p_limite).toBe(30);
    await buscarSugerencias("kayak", { locale: "es", limite: 3 });
    expect(state.llamadas[1].args.p_limite).toBe(15);
  });

  it("mappe un produit : id de carte, chemin de produit, établissement porteur", async () => {
    state.filas = [fila()];
    const [sugerencia] = await buscarSugerencias("kayak", { locale: "es" });
    expect(sugerencia).toEqual({
      id: "producto-11111111-1111-1111-1111-111111111111",
      nombre: "Kayak en el embalse",
      tipo: "activity",
      esEstablecimiento: false,
      establecimiento: "Casa Kayam",
      href: "/productos/kayak-embalse",
    });
  });

  it("mappe un établissement : chemin d'établissement, et aucun porteur", async () => {
    state.filas = [
      fila({
        tipo: "lodging",
        es_establecimiento: true,
        id: "22222222-2222-2222-2222-222222222222",
        slug: "casa-kayam",
        nombre: { es: "Casa Kayam" },
        establecimiento: null,
      }),
    ];
    const [sugerencia] = await buscarSugerencias("casa", { locale: "es" });
    expect(sugerencia).toEqual({
      id: "establecimiento-22222222-2222-2222-2222-222222222222",
      nombre: "Casa Kayam",
      tipo: "lodging",
      esEstablecimiento: true,
      establecimiento: null,
      href: "/establecimientos/casa-kayam",
    });
  });

  it("résout le nom dans la locale demandée", async () => {
    state.filas = [fila()];
    const [sugerencia] = await buscarSugerencias("kayak", { locale: "en" });
    expect(sugerencia.nombre).toBe("Kayak on the lake");
  });

  it("retombe sur le slug quand aucune langue ne porte de nom", async () => {
    // Une suggestion sans libellé serait une ligne vide et cliquable — le slug reste lisible.
    state.filas = [fila({ nombre: {}, slug: "sin-nombre" })];
    const [sugerencia] = await buscarSugerencias("sin", { locale: "es" });
    expect(sugerencia.nombre).toBe("sin-nombre");
    expect(sugerencia.href).toBe("/productos/sin-nombre");
  });

  it("laisse tomber une ligne dont le type est inconnu, sans casser la barre", async () => {
    state.filas = [fila({ tipo: "hotel" }), fila({ slug: "kayak" })];
    const sugerencias = await buscarSugerencias("kayak", { locale: "es" });
    expect(sugerencias).toHaveLength(1);
    expect(sugerencias[0].href).toBe("/productos/kayak");
  });

  it("⚠️ LÈVE sur erreur Supabase plutôt que de rendre une liste vide", async () => {
    // Une liste vide se lit « aucun résultat » : avaler l'erreur ferait afficher un catalogue vide
    // à la place d'une panne (CLAUDE.md §4.4).
    state.error = { message: "boom" };
    await expect(buscarSugerencias("kayak", { locale: "es" })).rejects.toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // L'ORDRE — le défaut trouvé par la revue du 2026-09-08
  // ─────────────────────────────────────────────────────────────────────────────────────────
  //
  // `search_catalog` finit par `order by c.tipo, c.rango_seccion`, un ordre pensé pour l'accueil
  // qui range ses cinq sections. `products.type` est du texte : activity < camp < evento < lodging
  // < transport. Demander six lignes à cette requête, c'est donc demander « les six premières
  // ACTIVITÉS » — et la carte d'un établissement, de type `lodging`, est servie en dernier.
  //
  // Reproduit en réel contre le Postgres local : taper « Casa Kayam » proposait l'hôtel ; en
  // ajoutant cinq activités au même établissement, le même appel rendait six `activity` et l'hôtel
  // avait disparu. Le prédicat texte couvre le nom de l'établissement, donc son nom fait
  // correspondre TOUS ses produits.
  //
  // ⚠️ L'ancien test de ce fichier était structurellement aveugle à ça : il mockait la RPC et
  // n'assertait que l'absence de `p_por_tipo`, c'est-à-dire la même croyance que le code.

  it("⚠️ demande une RÉSERVE à la base, jamais juste le nombre affiché", async () => {
    state.filas = [];

    await buscarSugerencias("casa", { locale: "es", limite: 6 });

    // Six lignes demandées à un ordre trié par type, ce sont six activités. La réserve est ce qui
    // garantit d'atteindre la dernière section, quelle que soit la répartition.
    expect(state.llamadas[0].args.p_limite).toBe(30);
  });

  it("⚠️ remonte l'ÉTABLISSEMENT quand son nom est tapé, même noyé sous ses propres offres", async () => {
    // Exactement la forme que rend la base : les activités d'abord (tri alphabétique du type),
    // l'établissement en dernier.
    state.filas = [
      ...Array.from({ length: 6 }, (_, i) =>
        fila({
          id: `aaaaaaaa-0000-0000-0000-00000000000${i}`,
          slug: `actividad-${i}`,
          nombre: { es: `Paseo ${i} desde Casa Kayam` },
        })
      ),
      fila({
        tipo: "lodging",
        es_establecimiento: true,
        id: "bbbbbbbb-0000-0000-0000-000000000001",
        slug: "casa-kayam-guatape",
        nombre: { es: "Casa Kayam Guatapé" },
        establecimiento: null,
      }),
    ];

    const sugerencias = await buscarSugerencias("casa kayam", { locale: "es", limite: 6 });

    // Sans le classement par pertinence, cette assertion échoue : les six activités remplissent la
    // liste et l'établissement tombe hors du plafond.
    expect(sugerencias[0].esEstablecimiento).toBe(true);
    expect(sugerencias[0].href).toBe("/establecimientos/casa-kayam-guatape");
    expect(sugerencias).toHaveLength(6);
  });

  it("le classement ignore la casse ET les accents, comme le filtre de la base", async () => {
    // La base cherche en `unaccent` : un classement plus strict que le filtre remonterait une
    // correspondance moins bonne quand on tape sans accent.
    state.filas = [
      fila({ slug: "otro", nombre: { es: "Tour por el embalse de Guatapé" } }),
      fila({
        id: "cccccccc-0000-0000-0000-000000000001",
        slug: "guatape-directo",
        nombre: { es: "Guatapé en lancha" },
      }),
    ];

    const sugerencias = await buscarSugerencias("guatape", { locale: "es", limite: 6 });

    expect(sugerencias[0].nombre).toBe("Guatapé en lancha");
  });
});
