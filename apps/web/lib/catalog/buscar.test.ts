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

import { buscarSecciones, buscarTipo, listarTagsConOferta } from "./buscar";

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

  it("⚠️ un produit portant À LA FOIS un libellé et un montant affiche le LIBELLÉ", async () => {
    // Le cas que rien n'exerçait, et par lequel les trois copies de la règle de prix avaient
    // divergé : `precioDe` testait le montant en premier, `resolverPrecio` (fiche produit, cartes
    // de chambre) teste le libellé. Le même produit s'affichait donc « 45.000 COP » ici et
    // « Consultar » sur sa propre fiche. La contrainte de prix n'interdit PAS de porter les deux.
    state.filas = [fila({ slug: "los-deux", precio_cop: 45000, precio_label: "Consultar" })];
    const [seccion] = await buscarSecciones({}, { porSeccion: 8, locale: "es" });
    expect(seccion.tarjetas[0].precio).toEqual({ tipo: "texto", label: "Consultar" });
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

  it("transmet `sinTag` à la base — la page « Otras actividades » (spec 29 §7a)", async () => {
    state.filas = [fila()];
    await buscarTipo("activity", {}, { limite: 24, desplazamiento: 0, locale: "es", sinTag: true });
    expect(state.ultimosArgs).toMatchObject({ p_sin_tag: true });
  });

  it("n'envoie pas `p_sin_tag` quand on ne le demande pas", async () => {
    // La RPC porte son propre défaut : envoyer `false` à chaque appel de listing n'ajouterait rien
    // et brouillerait les journaux Postgres.
    state.filas = [fila()];
    await buscarTipo("activity", {}, { limite: 24, desplazamiento: 0, locale: "es" });
    expect(state.ultimosArgs).toMatchObject({ p_sin_tag: undefined });
  });
});

function filaTag(over: Record<string, unknown> = {}) {
  return {
    slug: "kayak",
    label: { es: "Kayak", en: "Kayaking" },
    description: { es: "Recorridos por el embalse" },
    image_path: "tags/kayak.webp",
    total: 3,
    es_sin_tag: false,
    ...over,
  };
}

describe("listarTagsConOferta", () => {
  it("résout le nom, le texte et l'URL de l'image dans la locale demandée", async () => {
    state.filas = [filaTag()];
    const [categoria] = await listarTagsConOferta("activity", {}, { locale: "en" });

    expect(categoria).toMatchObject({
      slug: "kayak",
      href: "/actividades/kayak",
      nombre: "Kayaking",
      esSinTag: false,
      testId: "categoria-kayak",
    });
    // La couche résout l'URL publique : un composant ne parle jamais à Storage.
    expect(categoria.foto).toEqual({ url: "https://cdn.test/tags/kayak.webp" });
  });

  it("rend `foto` et `descripcion` à null quand la catégorie n'est pas rédigée", async () => {
    state.filas = [filaTag({ image_path: null, description: null })];
    const [categoria] = await listarTagsConOferta("activity", {}, { locale: "es" });
    expect(categoria.foto).toBeNull();
    expect(categoria.descripcion).toBeNull();
  });

  it("se rabat sur le slug quand aucune langue ne porte de libellé", async () => {
    state.filas = [filaTag({ label: {} })];
    const [categoria] = await listarTagsConOferta("activity", {}, { locale: "es" });
    // Une catégorie sans nom reste CLIQUABLE plutôt que d'afficher un vide.
    expect(categoria.nombre).toBe("kayak");
  });

  // ⚠️ LE test de l'ordre. Sans `Intl.Collator`, un tri naïf range « Ñandú » après « Zip line » et
  // « Édredon » après « Zumba » : la base ne connaît ni la locale ni la collation, c'est pour ça
  // que le tri n'est pas en SQL.
  it("classe par ordre alphabétique de la locale, accents et « ñ » compris", async () => {
    state.filas = [
      filaTag({ slug: "zip", label: { es: "Zip line" } }),
      filaTag({ slug: "nandu", label: { es: "Ñandú" } }),
      filaTag({ slug: "buceo", label: { es: "Buceo" } }),
    ];
    const categorias = await listarTagsConOferta("activity", {}, { locale: "es" });
    expect(categorias.map((c) => c.nombre)).toEqual(["Buceo", "Ñandú", "Zip line"]);
  });

  // ⚠️ « Otras actividades » n'est PAS une catégorie parmi les autres : c'est ce qui reste. La
  // ranger alphabétiquement la ferait passer pour une catégorie éditoriale de plus.
  it("place la tuile « sans tag » en DERNIER, hors de l'ordre alphabétique", async () => {
    state.filas = [
      filaTag({ slug: "zip", label: { es: "Zip line" } }),
      filaTag({ es_sin_tag: true, slug: null, label: null, description: null, image_path: null }),
      filaTag({ slug: "buceo", label: { es: "Buceo" } }),
    ];
    const categorias = await listarTagsConOferta("activity", {}, { locale: "es" });

    expect(categorias.map((c) => c.slug)).toEqual(["buceo", "zip", "otras"]);
    // ⚠️ Son nom reste VIDE : il vient des messages next-intl, pas de la base. Cette couche ne
    // traduit rien.
    expect(categorias[2]).toMatchObject({
      esSinTag: true,
      nombre: "",
      descripcion: null,
      foto: null,
      href: "/actividades/otras",
    });
  });

  it("transmet les critères à la base — l'index respecte la recherche en cours", async () => {
    state.filas = [];
    await listarTagsConOferta(
      "activity",
      { q: "kayak", personas: 3, desde: "2026-03-12", hasta: "2026-03-15" },
      { locale: "es" }
    );
    expect(state.ultimosArgs).toMatchObject({
      p_tipo: "activity",
      p_query: "kayak",
      p_personas: 3,
      p_desde: "2026-03-12",
      p_hasta: "2026-03-15",
    });
  });

  it("lève quand la base échoue — jamais un index vide qui aurait l'air normal", async () => {
    state.error = { message: "boom" };
    await expect(listarTagsConOferta("activity", {}, { locale: "es" })).rejects.toBeTruthy();
  });
});
