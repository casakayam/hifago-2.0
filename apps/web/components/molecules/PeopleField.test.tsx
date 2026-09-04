import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PeopleField } from "./PeopleField";

// Pas de @testing-library/jest-dom — assertions DOM natives uniquement.
//
// ⚠️ PIÈGE DE TEST DU DÉPÔT : le contenu d'un popover FERMÉ n'est pas dans le DOM. Chaque test qui
// vise un bouton du pas-à-pas ouvre le popover d'abord ; le premier fige justement l'absence.
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

const LIBELLES_PAS = { increment: "Añadir una persona", decrement: "Quitar una persona" };

function accord(nombre: number): string {
  return nombre === 1 ? "1 persona" : `${nombre} personas`;
}

function Harnais({
  valeurInitiale = null,
  max,
  onChange,
}: {
  valeurInitiale?: number | null;
  max?: number;
  onChange?: (v: number | null) => void;
}) {
  const [nombre, setNombre] = useState<number | null>(valeurInitiale);
  return (
    <PeopleField
      value={nombre}
      onChange={(v) => {
        setNombre(v);
        onChange?.(v);
      }}
      max={max}
      placeholderLabel="Personas"
      valueLabel={nombre === null ? undefined : accord(nombre)}
      fieldLabel="¿Cuántas personas?"
      stepLabels={LIBELLES_PAS}
      testId="personas"
    />
  );
}

function declencheur(): HTMLElement {
  return screen.getByTestId("personas-trigger");
}

function ouvrir() {
  act(() => {
    fireEvent.pointerDown(declencheur(), { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(declencheur(), { pointerType: "mouse", button: 0 });
    fireEvent.click(declencheur());
  });
}

describe("PeopleField", () => {
  it("⚠️ ne rend RIEN du pas-à-pas tant que le popover est fermé", () => {
    render(<Harnais valeurInitiale={2} />);
    expect(screen.queryByTestId("personas-increment")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("affiche le placeholder sans valeur, et le libellé ACCORDÉ avec, valeur incluse dans le nom", () => {
    const { unmount } = render(<Harnais />);
    expect(declencheur().textContent).toBe("Personas");
    unmount();

    render(<Harnais valeurInitiale={3} />);
    // Le nom accessible porte le nom du filtre ET sa valeur — la valeur seule ne dirait pas de quoi
    // il s'agit, et « Personas » seul ne dirait pas qu'un nombre est déjà choisi.
    expect(declencheur().textContent).toBe("¿Cuántas personas? : 3 personas");
  });

  it("⚠️ nomme ses deux boutons avec les libellés reçus, jamais avec ceux de react-aria", () => {
    // Mesuré : sans `aria-label`, react-aria nomme ses boutons « Increase » et « Decrease », EN
    // ANGLAIS EN DUR, sur une interface espagnole. Même défaut que « Today, » / « , selected » de
    // react-day-picker, que `Calendar` corrige de la même façon.
    render(<Harnais valeurInitiale={2} />);
    ouvrir();

    expect(screen.getByTestId("personas-increment").getAttribute("aria-label")).toBe(
      "Añadir una persona"
    );
    expect(screen.getByTestId("personas-decrement").getAttribute("aria-label")).toBe(
      "Quitar una persona"
    );
    // Le champ porte un libellé VISIBLE, pas seulement un nom accessible.
    expect(document.querySelector('[role="dialog"] label')?.textContent).toBe("¿Cuántas personas?");
  });

  it("incrémente et décrémente, et remonte le nombre", () => {
    const change = vi.fn();
    render(<Harnais valeurInitiale={2} onChange={change} />);
    ouvrir();

    act(() => {
      screen.getByTestId("personas-increment").click();
    });
    expect(change).toHaveBeenLastCalledWith(3);
    expect(declencheur().textContent).toBe("¿Cuántas personas? : 3 personas");

    act(() => {
      screen.getByTestId("personas-decrement").click();
    });
    expect(change).toHaveBeenLastCalledWith(2);
  });

  it("⚠️ un champ vidé remonte null, jamais NaN", () => {
    // react-aria envoie `NaN` quand le champ est vide. Le laisser passer mettrait `NaN` dans les
    // critères de recherche, et `NaN !== NaN` rendrait toute comparaison en aval fausse en silence.
    const change = vi.fn();
    render(<Harnais valeurInitiale={2} onChange={change} />);
    ouvrir();

    const champ = screen.getByTestId("personas-input");
    act(() => {
      fireEvent.change(champ, { target: { value: "" } });
      fireEvent.blur(champ);
    });
    expect(change).toHaveBeenLastCalledWith(null);
    expect(change.mock.calls.every(([valeur]) => !Number.isNaN(valeur))).toBe(true);
  });

  it("désactivé : le déclencheur ne s'ouvre pas", () => {
    render(
      <PeopleField
        value={2}
        onChange={() => {}}
        placeholderLabel="Personas"
        valueLabel="2 personas"
        fieldLabel="¿Cuántas personas?"
        stepLabels={LIBELLES_PAS}
        isDisabled
        testId="personas"
      />
    );
    ouvrir();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
