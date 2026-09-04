import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { es } from "date-fns/locale";
import type { SearchSuggestion } from "./SearchBar";
import { SearchPanel, type SearchCriteria, type SearchPanelLabels } from "./SearchPanel";

// Pas de @testing-library/jest-dom — assertions DOM natives uniquement.
//
// Ce que ces tests protègent, c'est LA JONCTION : `SearchBar.onSubmit` ne rend que le TEXTE TAPÉ
// (contrat mesuré à la vague 7 — `Entrée` seul ne déclenche rien dans un `ComboBox` react-aria,
// six lignes ont été écrites pour qu'il vaille « Rechercher »). Ce composant existe pour recombiner
// ce texte avec ses filtres. Si la recombinaison saute, la recherche part sans dates ni personnes
// et RIEN ne le signale.
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
// react-aria retrouve une option par son id (`useSelectableCollection`) — jsdom expose `CSS` sans
// `escape`, et toute navigation clavier dans la liste lèverait sans ce bouchon.
if (!globalThis.CSS) (globalThis as { CSS?: unknown }).CSS = {};
globalThis.CSS.escape ??= ((valeur: string) => valeur.replace(/([^\w-])/g, "\\$1")) as typeof CSS.escape;

const AUJOURDHUI = "2026-09-15";

const SUGGESTIONS: SearchSuggestion[] = [
  { id: "p-kayak", label: "Kayak en el Embalse", meta: "Actividad en Guatapé", kind: "product" },
  { id: "c-acuaticas", label: "Actividades acuáticas", meta: "12 actividades", kind: "category" },
];

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

const REMPLI: SearchCriteria = {
  query: "",
  dates: { debut: "2026-09-18", fin: "2026-09-22" },
  people: 4,
};

function Harnais({
  initial = REMPLI,
  onSubmit,
  onSuggestionSelect,
  onCriteriaChange,
}: {
  initial?: SearchCriteria;
  onSubmit?: (c: SearchCriteria) => void;
  onSuggestionSelect?: (s: SearchSuggestion) => void;
  onCriteriaChange?: (c: SearchCriteria) => void;
}) {
  const [criteres, setCriteres] = useState<SearchCriteria>(initial);
  return (
    <SearchPanel
      criteria={criteres}
      onCriteriaChange={(c) => {
        setCriteres(c);
        onCriteriaChange?.(c);
      }}
      onSubmit={(c) => onSubmit?.(c)}
      suggestions={SUGGESTIONS}
      onSuggestionSelect={(s) => onSuggestionSelect?.(s)}
      aujourdIso={AUJOURDHUI}
      locale={es}
      labels={LABELS}
      testId="panneau"
    />
  );
}

function champ(): HTMLInputElement {
  return screen.getByTestId("panneau-bar-input") as HTMLInputElement;
}

/**
 * ⚠️ PIÈGE DE TEST DU DÉPÔT (CLAUDE.md §11 point 7) : sur un `ComboBox` HeroUI, agir sur une liste
 * NON filtrée échoue par intermittence à committer la sélection. La parade vérifiée est de TAPER
 * une requête d'abord, puis de désigner l'option par son nom. Elle est appliquée partout ici.
 */
function taper(texte: string) {
  act(() => {
    champ().focus();
    fireEvent.change(champ(), { target: { value: texte } });
  });
}

describe("SearchPanel", () => {
  it("⚠️ Entrée soumet les TROIS critères, pas seulement le texte", () => {
    // LE test du lot. `SearchBar.onSubmit` ne rend que le texte : sans la recombinaison de
    // `SearchPanel`, la recherche partirait sans dates ni personnes, en silence.
    const soumis = vi.fn();
    render(<Harnais onSubmit={soumis} />);

    taper("kayak");
    act(() => {
      fireEvent.keyDown(champ(), { key: "Enter" });
    });

    expect(soumis).toHaveBeenCalledTimes(1);
    expect(soumis.mock.calls[0][0]).toEqual({
      query: "kayak",
      dates: { debut: "2026-09-18", fin: "2026-09-22" },
      people: 4,
    });
  });

  it("le bouton Buscar soumet les mêmes trois critères", () => {
    const soumis = vi.fn();
    render(<Harnais onSubmit={soumis} />);

    taper("lancha");
    // ⚠️ `Échap` d'abord : tant que la liste de suggestions est ouverte, react-aria pose
    // `aria-hidden` sur tout ce qui l'entoure, donc le bouton n'est pas dans l'arbre
    // d'accessibilité — constat de la vague 7, et c'est aussi le parcours réel.
    act(() => {
      fireEvent.keyDown(champ(), { key: "Escape" });
    });
    act(() => {
      const bouton = screen.getByRole("button", { name: "Buscar" });
      fireEvent.pointerDown(bouton, { pointerType: "mouse", button: 0 });
      fireEvent.pointerUp(bouton, { pointerType: "mouse", button: 0 });
      fireEvent.click(bouton);
    });

    expect(soumis.mock.calls[0][0]).toEqual({
      query: "lancha",
      dates: { debut: "2026-09-18", fin: "2026-09-22" },
      people: 4,
    });
  });

  it("la frappe remonte dans les critères sans rien soumettre", () => {
    const change = vi.fn();
    const soumis = vi.fn();
    render(<Harnais onCriteriaChange={change} onSubmit={soumis} />);

    taper("kay");
    expect(change).toHaveBeenLastCalledWith({ ...REMPLI, query: "kay" });
    expect(soumis).not.toHaveBeenCalled();
  });

  it("remonte la suggestion activée", () => {
    const choisie = vi.fn();
    render(<Harnais onSuggestionSelect={choisie} />);

    taper("kayak");
    act(() => {
      // Parade du §11.7 : on a tapé d'abord, on désigne l'option par son NOM, et on emploie les
      // événements POINTEUR que react-aria écoute (`usePress`).
      const option = screen.getByRole("option", { name: /Actividades acuáticas/ });
      fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
      fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
      fireEvent.click(option);
    });

    expect(choisie).toHaveBeenCalledTimes(1);
    expect(choisie.mock.calls[0][0].id).toBe("c-acuaticas");
  });

  it("expose les deux filtres, nommés avec leur valeur courante", () => {
    render(<Harnais />);
    expect(screen.getByTestId("panneau-dates-trigger").textContent).toBe("Fechas : 18–22 sept");
    expect(screen.getByTestId("panneau-people-trigger").textContent).toBe(
      "¿Cuántas personas? : 4 personas"
    );
  });

  it("⚠️ un quatrième filtre s'ajoutera dans le TYPE, sans toucher aux signatures", () => {
    // Ce test ne vérifie pas un comportement, il fige une FORME d'API : les critères voyagent dans
    // un objet, jamais en trois props. C'est ce qui évite de rouvrir ce composant à chaque filtre —
    // le type d'activité, déjà présent dans `CatalogBrowser`, arrivera par là.
    const soumis = vi.fn();
    render(<Harnais initial={{ query: "", dates: null, people: null }} onSubmit={soumis} />);

    taper("kayak");
    act(() => {
      fireEvent.keyDown(champ(), { key: "Enter" });
    });
    expect(Object.keys(soumis.mock.calls[0][0]).sort()).toEqual(["dates", "people", "query"]);
  });
});
