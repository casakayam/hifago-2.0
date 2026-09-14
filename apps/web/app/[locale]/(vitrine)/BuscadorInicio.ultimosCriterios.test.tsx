import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import type { SearchPanelLabels } from "@/components/organisms/SearchPanel";
import { BuscadorInicio } from "./BuscadorInicio";

// Spec 28 Tranche 3 : c'est ICI que « critères conservés » prend corps, puisque la fiche produit
// ne porte jamais les critères dans son URL (spec 28 §4) — voir `useAddToCart.ts`, qui relit ce
// que ce composant mémorise.
//
// ⚠️ FICHIER SÉPARÉ de `BuscadorInicio.estado.test.tsx`, même raison qu'elle : `vi.mock("react")`
// y force `useTransition` à rendre `true` en PERMANENCE, ce qui figerait les tests ci-dessous dans
// un état de navigation permanent sans rapport avec ce qu'ils vérifient.

const guardar = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/catalog/ultimosCriterios", () => ({
  guardarUltimosCriterios: (sufijo: string) => guardar(sufijo),
}));

// Bouchons jsdom exigés par le sous-arbre react-aria de `SearchPanel` — mêmes que le fichier voisin.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;
window.IntersectionObserver ??= ObservateurInerte as unknown as typeof window.IntersectionObserver;
if (!globalThis.CSS) (globalThis as { CSS?: unknown }).CSS = {};
globalThis.CSS.escape ??= ((valeur: string) =>
  valeur.replace(/([^\w-])/g, "\\$1")) as typeof CSS.escape;

const LABELS: SearchPanelLabels = {
  search: {
    label: "Buscar actividades",
    placeholder: "¿Qué quieres hacer?",
    submitLabel: "Buscar",
    emptyLabel: "No encontramos nada.",
  },
  dates: {
    placeholderLabel: "Fechas",
    calendar: { complet: "Completo", selectionne: "seleccionado", aujourdhui: "hoy" },
  },
  people: {
    placeholderLabel: "Personas",
    fieldLabel: "¿Cuántas personas?",
    stepLabels: { increment: "Añadir una persona", decrement: "Quitar una persona" },
  },
};

const MESSAGES = loadMessages("es");

function montar(criteriosIniciales: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <BuscadorInicio
        criteriosIniciales={criteriosIniciales}
        aujourdIso="2026-09-15"
        localeCodigo="es"
        labels={LABELS}
        atajosTipo={[{ tipo: "activity", total: 12 }]}
      />
    </NextIntlClientProvider>
  );
}

describe("BuscadorInicio — mémorisation des critères (spec 28 Tranche 3)", () => {
  it("mémorise les critères déjà présents dans l'URL au montage", () => {
    montar({ q: "kayak", personas: 2 });
    expect(guardar).toHaveBeenCalledWith("?q=kayak&personas=2");
  });

  it("mémorise l'absence de critères — jamais rien laissé de périmé", () => {
    montar({});
    expect(guardar).toHaveBeenCalledWith("");
  });

  it("⚠️ re-mémorise à chaque changement de signature d'URL (retour arrière compris)", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="es" messages={MESSAGES}>
        <BuscadorInicio
          criteriosIniciales={{ q: "kayak" }}
          aujourdIso="2026-09-15"
          localeCodigo="es"
          labels={LABELS}
          atajosTipo={[{ tipo: "activity", total: 12 }]}
        />
      </NextIntlClientProvider>
    );
    guardar.mockClear();

    rerender(
      <NextIntlClientProvider locale="es" messages={MESSAGES}>
        <BuscadorInicio
          criteriosIniciales={{}}
          aujourdIso="2026-09-15"
          localeCodigo="es"
          labels={LABELS}
          atajosTipo={[{ tipo: "activity", total: 12 }]}
        />
      </NextIntlClientProvider>
    );

    // La mémoire suit la recherche VIDÉE : elle ne reste pas bloquée sur "kayak".
    expect(guardar).toHaveBeenCalledWith("");
  });
});
