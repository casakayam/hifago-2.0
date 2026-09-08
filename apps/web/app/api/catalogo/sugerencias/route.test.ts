// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// LE ROUTE HANDLER LUI-MÊME, exercé pour de vrai — même geste que
// app/api/pms/night-availability/route.test.ts. Ce qu'il contient de propre à lui (le repli de
// locale, le corps d'échec qui ne ressemble pas à un succès, le message Postgres qui ne sort pas)
// n'est vérifié par rien d'autre : la couche est testée séparément, et un e2e intercepte cette URL
// au niveau navigateur.
const state = vi.hoisted(() => ({
  llamadas: [] as { q: string; opciones: { locale: string; limite?: number } }[],
  error: null as Error | null,
  sugerencias: [] as unknown[],
}));

vi.mock("@/lib/catalog/sugerencias", () => ({
  buscarSugerencias: (q: string, opciones: { locale: string; limite?: number }) => {
    state.llamadas.push({ q, opciones });
    if (state.error) return Promise.reject(state.error);
    return Promise.resolve(state.sugerencias);
  },
}));

import { GET } from "./route";

const SUGERENCIA = {
  id: "producto-11111111-1111-1111-1111-111111111111",
  nombre: "Kayak en el embalse",
  tipo: "activity",
  esEstablecimiento: false,
  establecimiento: "Casa Kayam",
  href: "/productos/kayak-embalse",
};

function pedir(consulta: string) {
  return GET(new Request(`https://hifago.test/api/catalogo/sugerencias${consulta}`));
}

beforeEach(() => {
  state.llamadas = [];
  state.error = null;
  state.sugerencias = [];
});

describe("GET /api/catalogo/sugerencias", () => {
  it("rend les suggestions sous la seule clé du contrat", async () => {
    state.sugerencias = [SUGERENCIA];
    const response = await pedir("?q=kayak&locale=es");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sugerencias: [SUGERENCIA] });
  });

  it("passe le texte et la locale demandés à la couche", async () => {
    await pedir("?q=kayak&locale=en");
    expect(state.llamadas).toEqual([{ q: "kayak", opciones: { locale: "en" } }]);
  });

  it("⚠️ retombe sur la locale par défaut plutôt que de rendre 400", async () => {
    // Une locale absente ou inconnue ne fait échouer AUCUN paramètre (même règle que les critères
    // d'URL de l'accueil) : la seule conséquence est un nom résolu en espagnol.
    await pedir("?q=kayak");
    await pedir("?q=kayak&locale=fr");
    await pedir("?q=kayak&locale=");
    expect(state.llamadas.map((l) => l.opciones.locale)).toEqual(["es", "es", "es"]);
  });

  it("rend une liste vide en 200 quand `q` est absent", async () => {
    const response = await pedir("");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sugerencias: [] });
    // La couche décide seule du seuil ; la route lui passe la chaîne vide sans rien redécider.
    expect(state.llamadas).toEqual([{ q: "", opciones: { locale: "es" } }]);
  });

  it("⚠️ en cas de panne : 500, aucun `sugerencias`, aucun message Postgres", async () => {
    state.error = new Error('relation "public.products" does not exist');
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await pedir("?q=kayak&locale=es");
    expect(response.status).toBe(500);
    const cuerpo = await response.json();
    // Une réponse d'échec n'a pas la forme d'une réponse de succès : sans ça, la panne s'afficherait
    // comme « aucun résultat ».
    expect(cuerpo).toEqual({ ok: false, reason: "catalogo_no_disponible" });
    expect(JSON.stringify(cuerpo)).not.toContain("public.products");
    // Le détail reste côté serveur, où il sert à diagnostiquer.
    expect(espia).toHaveBeenCalledTimes(1);
    espia.mockRestore();
  });
});
