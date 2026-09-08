import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import type { SearchPanelLabels } from "@/components/organisms/SearchPanel";
import { BuscadorInicio } from "./BuscadorInicio";

// LA MOITIÉ QUI MANQUAIT (2026-09-08, revue adversariale du lot D).
//
// `BuscadorInicio.test.tsx` vérifiait que la région d'état est MONTÉE au repos et vide — la moitié
// accessibilité de la règle. Personne ne vérifiait qu'elle DIT quelque chose quand il se passe
// quelque chose. Mesuré par la revue : retirer `useTransition` en entier — l'import, l'état, la
// transition autour de `router.push`, et donc tout le signal de navigation — laissait
// **515 tests sur 515 au vert**, `eslint` à zéro et aucun `scripts/check-*.sh` en défaut. La moitié
// du commit 222d8fe pouvait disparaître sans qu'un seul garde-fou bouge : exactement le §11.20
// (« une règle documentée que rien ne vérifie n'est pas une règle : c'est un souhait »).
//
// ⚠️ FICHIER SÉPARÉ, et c'est la raison d'être de ce fichier plutôt qu'un test de plus à côté :
// `vi.mock("react")` est GLOBAL au module. Forcer `useTransition` à rendre `true` dans le fichier
// voisin figerait ses quatorze autres tests dans un état de navigation permanent.
vi.mock("react", async (importOriginal) => {
  const reel = await importOriginal<typeof import("react")>();
  return { ...reel, useTransition: () => [true, reel.startTransition] as const };
});

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

describe("BuscadorInicio — le signal de navigation", () => {
  it("annonce la recherche en cours dans la région d'état", () => {
    render(
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

    // ⚠️ Le libellé vient du VRAI catalogue : si la clé `buscando` est renommée ou supprimée, ce
    // test rougit au lieu de laisser une région muette partir en production.
    expect(screen.getByTestId("buscador-estado").textContent).toBe(MESSAGES.HomePage.buscando);
  });
});
