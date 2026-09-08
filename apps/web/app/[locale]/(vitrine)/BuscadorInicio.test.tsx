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
  HomePage: {
    personas: { valueLabel: "{count, plural, one {# persona} other {# personas}}" },
    secciones: { activity: "Actividades", lodging: "Alojamientos" },
    tiposSingular: { activity: "Actividad", lodging: "Alojamiento" },
    buscando: "Buscando…",
    sugerencias: {
      metaEstablecimiento: "Establecimiento",
      metaOferta: "{tipo} · {establecimiento}",
      metaOfertaSinLugar: "{tipo}",
      atajoTipo: "{count, plural, one {# oferta} other {# ofertas}}",
    },
  },
};

const ATAJOS = [
  { tipo: "activity" as const, total: 12 },
  { tipo: "lodging" as const, total: 3 },
];

function vue(criteriosIniciales: Criterios) {
  return (
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <BuscadorInicio
        criteriosIniciales={criteriosIniciales}
        aujourdIso={AUJOURDHUI}
        localeCodigo="es"
        labels={LABELS}
        atajosTipo={ATAJOS}
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

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Les suggestions (Tranche 2)
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("propose les raccourcis de type AVANT la première frappe, sans aucune requête", () => {
    const fetchEspion = vi.fn();
    vi.stubGlobal("fetch", fetchEspion);
    monter();

    act(() => champ().focus());

    // `menuTrigger="focus"` ouvre la liste à la prise de focus : elle ne doit pas être vide.
    expect(screen.getByText("Actividades")).not.toBeNull();
    expect(screen.getByText("12 ofertas")).not.toBeNull();
    expect(screen.getByText("Alojamientos")).not.toBeNull();
    expect(screen.getByText("3 ofertas")).not.toBeNull();
    expect(fetchEspion).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("ne demande aucune suggestion sous deux caractères", async () => {
    const fetchEspion = vi.fn();
    vi.stubGlobal("fetch", fetchEspion);
    vi.useFakeTimers();
    monter();

    taper("k");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(fetchEspion).not.toHaveBeenCalled();

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("demande les suggestions au catalogue et compose leur ligne secondaire", async () => {
    const fetchEspion = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sugerencias: [
          {
            id: "producto-1",
            nombre: "Kayak en el Embalse",
            tipo: "activity",
            esEstablecimiento: false,
            establecimiento: "Casa Kayam",
            href: "/productos/kayak-embalse",
          },
          {
            id: "establecimiento-2",
            nombre: "Casa Kayam",
            tipo: "lodging",
            esEstablecimiento: true,
            establecimiento: null,
            href: "/establecimientos/casa-kayam",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchEspion);
    vi.useFakeTimers();
    monter();

    taper("kayak");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(fetchEspion).toHaveBeenCalledTimes(1);
    expect(String(fetchEspion.mock.calls[0][0])).toBe(
      "/api/catalogo/sugerencias?q=kayak&locale=es"
    );
    // La composition du libellé vit ICI, jamais dans lib/catalog (spec 28 §6).
    expect(screen.getByText("Actividad · Casa Kayam")).not.toBeNull();
    expect(screen.getByText("Establecimiento")).not.toBeNull();
    // Le préfixe de langue est posé à la main : `SearchBar` rend un <a href> NATIF.
    const lien = screen.getByText("Kayak en el Embalse").closest("a");
    expect(lien?.getAttribute("href")).toBe("/es/productos/kayak-embalse");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("un raccourci de type change les critères sans quitter la page", () => {
    // ⚠️ Sans texte saisi, à dessein : les raccourcis de type ne s'affichent QUE sous le seuil de
    // deux caractères — dès qu'on tape, la liste montre les correspondances du catalogue. Ils ne
    // se combinent donc jamais avec une recherche texte, mais bien avec les filtres venus de
    // l'URL, et c'est ce que ce test vérifie.
    monter({ personas: 4 });

    act(() => champ().focus());
    act(() => {
      (screen.getByText("Alojamientos").closest('[role="option"]') as HTMLElement).click();
    });

    // Le filtre hérité de l'URL est CONSERVÉ, et l'adresse passe par `escribirCriterios`, seul
    // maître de son écriture — un raccourci n'est pas un chemin d'écriture d'URL parallèle.
    expect(pushMock).toHaveBeenCalledWith("/?tipo=lodging&personas=4");
  });

  it("porte une région d'état MONTÉE AU REPOS, et vide", () => {
    monter();

    // ⚠️ La règle que ce test protège n'est pas « le texte apparaît » mais « la région existe
    // avant d'avoir quelque chose à dire » : un `role="status"` monté au moment où son contenu
    // arrive n'est PAS annoncé par un lecteur d'écran. C'est la faute classique du motif, et elle
    // est invisible à l'œil comme au typecheck.
    const estado = screen.getByTestId("buscador-estado");
    expect(estado.getAttribute("role")).toBe("status");
    expect(estado.getAttribute("aria-live")).toBe("polite");
    expect(estado.textContent).toBe("");
  });

  it("se resynchronise sur l'URL quand elle change sous lui (retour arrière)", () => {
    const { rerender } = monter({ q: "kayak" });

    taper("kaya");
    rerender(vue({ q: "lancha", personas: 3 }));

    expect(champ().value).toBe("lancha");
  });
});
