// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Même patron de mock que app/sitemap.test.ts : on ne simule que ce que le module utilise.
const state = vi.hoisted(() => ({
  filas: [] as unknown[],
  error: null as { message: string } | null,
  ultimosArgs: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/publicClient", () => ({
  createPublicClient: () => ({
    rpc: (_nombre: string, args: Record<string, unknown>) => {
      state.ultimosArgs = args;
      return Promise.resolve({ data: state.filas, error: state.error });
    },
    storage: {
      from: () => ({
        getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://cdn.test/${ruta}` } }),
      }),
    },
  }),
}));

import { buscarSecciones, buscarTipo } from "./buscar";

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
    fotos: [{ storage_path: "a.webp" }, { storage_path: "b.webp" }],
    total_seccion: 9,
    rango_seccion: 1,
    ...over,
  };
}

beforeEach(() => {
  state.filas = [];
  state.error = null;
  state.ultimosArgs = null;
});

describe("buscarSecciones", () => {
  it("rend les sections dans l'ordre du cahier, et retire les vides", async () => {
    state.filas = [
      fila({ tipo: "camp", slug: "camp-x", rango_seccion: 1, total_seccion: 1 }),
      fila({ tipo: "activity", slug: "kayak", rango_seccion: 1 }),
    ];
    const secciones = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    // activity avant camp (ORDEN_SECCIONES), et ni lodging ni transport ni evento.
    expect(secciones.map((s) => s.tipo)).toEqual(["activity", "camp"]);
  });

  it("résout le nom dans la locale demandée, et retombe sur le slug si rien n'existe", async () => {
    state.filas = [fila(), fila({ slug: "sin-nombre", nombre: {}, rango_seccion: 2 })];
    const [seccion] = await buscarSecciones({}, { porSeccion: 8, locale: "en" });
    expect(seccion.tarjetas[0].nombre).toBe("Kayak on the lake");
    expect(seccion.tarjetas[1].nombre).toBe("sin-nombre");
  });

  it("transforme chaque storage_path en URL publique, sans en perdre", async () => {
    state.filas = [fila()];
    const [seccion] = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(seccion.tarjetas[0].fotos).toEqual([
      { url: "https://cdn.test/a.webp" },
      { url: "https://cdn.test/b.webp" },
    ]);
  });

  it("survit à une offre sans photo", async () => {
    state.filas = [fila({ fotos: null })];
    const [seccion] = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(seccion.tarjetas[0].fotos).toEqual([]);
  });

  it("distingue les quatre formes de prix", async () => {
    state.filas = [
      fila({ slug: "con-monto", rango_seccion: 1 }),
      fila({ slug: "vitrina", precio_cop: null, precio_label: "Consultar", rango_seccion: 2 }),
      fila({ slug: "sin-nada", precio_cop: null, precio_label: null, rango_seccion: 3 }),
      fila({
        slug: "casa-kayam",
        tipo: "lodging",
        es_establecimiento: true,
        precio_cop: null,
        precio_desde: 60000,
        total_seccion: 6,
        rango_seccion: 1,
      }),
    ];
    const secciones = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    const actividades = secciones.find((s) => s.tipo === "activity")!.tarjetas;
    const alojamiento = secciones.find((s) => s.tipo === "lodging")!.tarjetas[0];
    expect(actividades[0].precio).toEqual({ tipo: "monto", cop: 45000 });
    expect(actividades[1].precio).toEqual({ tipo: "texto", label: "Consultar" });
    expect(actividades[2].precio).toBeNull();
    expect(alojamiento.precio).toEqual({ tipo: "desde", cop: 60000 });
  });

  it("⚠️ une carte d'établissement SANS aucun prix chiffré n'affiche pas « desde 0 »", async () => {
    // Depuis que la spec 27 a relâché la contrainte de prix, precio_desde peut être null.
    state.filas = [
      fila({ tipo: "lodging", es_establecimiento: true, precio_cop: null, precio_desde: null }),
    ];
    const [seccion] = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(seccion.tarjetas[0].precio).toBeNull();
  });

  it("envoie un établissement vers sa page et un produit vers la sienne", async () => {
    state.filas = [
      fila({ slug: "kayak", rango_seccion: 1 }),
      fila({
        tipo: "lodging",
        es_establecimiento: true,
        slug: "casa-kayam",
        rango_seccion: 1,
      }),
    ];
    const secciones = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(secciones.find((s) => s.tipo === "activity")!.tarjetas[0].href).toBe("/productos/kayak");
    expect(secciones.find((s) => s.tipo === "lodging")!.tarjetas[0].href).toBe(
      "/establecimientos/casa-kayam"
    );
  });

  it("⚠️ demande une limite globale qui couvre TOUTES les sections plafonnées", async () => {
    // Sans ça, la dernière section serait tronquée par p_limite sans aucune erreur : la page
    // rendrait simplement moins de cartes, et personne ne le verrait.
    await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(state.ultimosArgs).toMatchObject({ p_por_tipo: 8, p_limite: 40 });
  });

  it("restreint à un seul type quand le critère le demande", async () => {
    await buscarSecciones({ tipo: "camp" }, { porSeccion: 8, locale: "es" });
    expect(state.ultimosArgs).toMatchObject({ p_tipos: ["camp"] });
  });

  it("échoue franchement plutôt que de rendre un catalogue vide", async () => {
    state.error = { message: "boom" };
    await expect(buscarSecciones({}, { porSeccion: 8, locale: "es" })).rejects.toBeTruthy();
  });

  it("laisse tomber une ligne dont le type est inconnu, sans casser la page", async () => {
    state.filas = [fila({ tipo: "hotel" }), fila({ slug: "kayak", rango_seccion: 2 })];
    const secciones = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(secciones).toHaveLength(1);
    expect(secciones[0].tarjetas).toHaveLength(1);
  });
});

describe("buscarTipo", () => {
  it("pagine sans plafond par section et dit s'il reste des offres", async () => {
    state.filas = [fila(), fila({ slug: "b", rango_seccion: 2 })];
    const r = await buscarTipo("activity", {}, { limite: 2, desplazamiento: 0, locale: "es" });
    expect(state.ultimosArgs).toMatchObject({ p_por_tipo: undefined, p_limite: 2, p_offset: 0 });
    expect(r.total).toBe(9);
    expect(r.hayMas).toBe(true);
  });

  it("sait qu'il n'y a plus rien après la dernière page", async () => {
    state.filas = [fila({ total_seccion: 2 }), fila({ slug: "b", total_seccion: 2 })];
    const r = await buscarTipo("activity", {}, { limite: 8, desplazamiento: 0, locale: "es" });
    expect(r.hayMas).toBe(false);
  });

  it("rend un total nul sur une page vide, sans lever", async () => {
    state.filas = [];
    const r = await buscarTipo("evento", {}, { limite: 8, desplazamiento: 0, locale: "es" });
    expect(r).toEqual({ tarjetas: [], total: 0, hayMas: false });
  });
});
