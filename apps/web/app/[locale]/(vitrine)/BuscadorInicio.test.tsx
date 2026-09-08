import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SearchPanelLabels } from "@/components/organisms/SearchPanel";
import type { Criterios } from "@/lib/catalog/tipos";
import { BuscadorInicio } from "./BuscadorInicio";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ces tests protègent, c'est LA TRADUCTION critères → URL. `SearchPanel` est déjà testé
// (la recombinaison texte + filtres) ; ici on ne re-teste pas le panneau, on vérifie ce que ce
// fichier ajoute et lui seul : l'état initial dérivé de l'URL, et l'adresse réellement poussée —
// dont le report de `tipo`/`tag`, la seule ligne dont l'oubli ne se verrait NULLE PART (le
// visiteur perdrait son filtre en silence, la page rendrait normalement).

// Les factories de `vi.mock` sont hoistées avant toute déclaration `const` : `vi.hoisted()` est la
// façon officielle de partager l'espion avec le corps des tests (cf. PartnersFilterBar.test.tsx).
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

// `@/i18n/navigation` tire next-intl/navigation → next/navigation, dont la résolution casse sous
// Vitest (Next 16, interop ESM connu). Ce test porte sur l'URL CONSTRUITE, jamais sur la
// navigation elle-même : un espion suffit — et il vérifie au passage que le routeur employé est
// bien le localisé, puisque c'est celui-là qui est bouchonné.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Bouchons jsdom exigés par le sous-arbre react-aria de `SearchPanel` (ComboBox + Popover) —
// mêmes que SearchPanel.test.tsx, qui les a mesurés un à un.
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
globalThis.CSS.escape ??= ((valeur: string) => valeur.replace(/([^\w-])/g, "\\$1")) as typeof CSS.escape;

const AUJOURDHUI = "2026-09-15";

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
    valueLabel: "4 personas",
    stepLabels: { increment: "Añadir una persona", decrement: "Quitar una persona" },
  },
};

// Le composant traduit UNE seule chose lui-même — `personas.valueLabel`, un pluriel accordé sur le
// nombre choisi, que la page ne peut pas fournir puisque ce nombre est un état client. D'où ce
// provider : sans lui, `useTranslations` lève et les neuf tests tombent d'un coup.
const MESSAGES = {
  HomePage: { personas: { valueLabel: "{count, plural, one {# persona} other {# personas}}" } },
};

function vue(criteriosIniciales: Criterios) {
  return (
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <BuscadorInicio
        criteriosIniciales={criteriosIniciales}
        aujourdIso={AUJOURDHUI}
        localeCodigo="es"
        labels={LABELS}
      />
    </NextIntlClientProvider>
  );
}

function monter(criteriosIniciales: Criterios = {}) {
  return render(vue(criteriosIniciales));
}

// `testId` vaut « buscador » par défaut, et `SearchPanel` en préfixe ses enfants.
function champ(): HTMLInputElement {
  return screen.getByTestId("buscador-bar-input") as HTMLInputElement;
}

/** Parade du §11.7 : sur un ComboBox HeroUI, on TAPE d'abord, on désigne ensuite. */
function taper(texte: string) {
  act(() => {
    champ().focus();
    fireEvent.change(champ(), { target: { value: texte } });
  });
}

/** `Entrée` sans suggestion active vaut « Rechercher » — le contrat mesuré de `SearchBar`. */
function soumettre() {
  act(() => {
    fireEvent.keyDown(champ(), { key: "Enter" });
  });
}

beforeEach(() => {
  pushMock.mockClear();
});

describe("BuscadorInicio", () => {
  it("dérive l'état initial des critères de l'URL", () => {
    monter({ q: "kayak", desde: "2026-09-18", hasta: "2026-09-22", personas: 4 });

    expect(champ().value).toBe("kayak");
    expect(screen.getByTestId("buscador-dates-trigger").textContent).toBe("Fechas : 18–22 sept");
    expect(screen.getByTestId("buscador-people-trigger").textContent).toBe(
      "¿Cuántas personas? : 4 personas"
    );
  });

  it("pousse le texte tapé dans l'URL", () => {
    monter();

    taper("kayak");
    soumettre();

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/?q=kayak");
  });

  it("pousse `/` quand aucun critère n'est posé", () => {
    // ⚠️ Pas `/?` ni `/?q=` : une recherche vide et l'accueil nue doivent être LA MÊME URL, sinon
    // le canonical auto-référent en fabrique deux (lib/catalog/criterios.ts, règle 2).
    monter();

    soumettre();

    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("⚠️ reporte `tipo` et `tag`, que le panneau ne gère pas", () => {
    // LE test de ce fichier. Les perdre effacerait en silence un filtre présent dans l'URL : la
    // page se rendrait normalement, sur tout le catalogue, sans qu'aucune erreur ne le signale.
    monter({ tipo: "lodging", tag: "agua" });

    taper("kayak");
    soumettre();

    expect(pushMock).toHaveBeenCalledWith("/?q=kayak&tipo=lodging&tag=agua");
  });

  it("une seule date choisie dans le calendrier donne desde = hasta", () => {
    monter();

    act(() => {
      const declencheur = screen.getByTestId("buscador-dates-trigger");
      fireEvent.pointerDown(declencheur, { pointerType: "mouse", button: 0 });
      fireEvent.pointerUp(declencheur, { pointerType: "mouse", button: 0 });
      fireEvent.click(declencheur);
    });
    act(() => {
      (document.querySelector('[data-date="2026-09-18"]') as HTMLButtonElement).click();
    });
    soumettre();

    expect(pushMock).toHaveBeenCalledWith("/?desde=2026-09-18&hasta=2026-09-18");
  });

  it("une plage sans borne de fin retombe elle aussi sur desde = hasta", () => {
    // Le cas que le TYPE autorise (`PlageCalendrier.fin` est `string | null`) même si
    // `leerCriterios` pose toujours les deux dates : sans le repli, `escribirCriterios` jetterait
    // la plage à moitié écrite et la date disparaîtrait de l'URL sans un mot.
    monter({ desde: "2026-09-18" });

    soumettre();

    expect(pushMock).toHaveBeenCalledWith("/?desde=2026-09-18&hasta=2026-09-18");
  });

  it("pousse le nombre de personnes hérité de l'URL avec le reste", () => {
    monter({ personas: 4 });

    taper("lancha");
    soumettre();

    expect(pushMock).toHaveBeenCalledWith("/?q=lancha&personas=4");
  });

  // Spec 28 §9 : « le panneau se resynchronise depuis l'URL — jamais depuis son état interne, qui
  // n'est pas la source de vérité ». Les deux moitiés comptent autant l'une que l'autre, et ce sont
  // deux régressions opposées : ne pas resynchroniser laisse le bouton « précédent » afficher des
  // champs qui ne décrivent plus les résultats ; resynchroniser trop (en comparant l'objet de
  // props, reconstruit à chaque rendu) efface la saisie en cours à chaque frappe.
  it("garde la saisie en cours tant que l'URL ne bouge pas", () => {
    const { rerender } = monter({ q: "kayak" });
    expect(champ().value).toBe("kayak");

    taper("kaya");
    rerender(vue({ q: "kayak" }));

    expect(champ().value).toBe("kaya");
  });

  it("se resynchronise sur l'URL quand elle change sous lui (retour arrière)", () => {
    const { rerender } = monter({ q: "kayak" });

    taper("kaya");
    rerender(vue({ q: "lancha", personas: 3 }));

    expect(champ().value).toBe("lancha");
  });
});
