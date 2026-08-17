import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StayRatesEditor } from "./stay-rates-editor";
import { emptyStayRates, type DraftStayRates } from "@/lib/products/stayRates";

// Composant contrôlé, sans I/O réseau (spec 12) : même harnais que slot-rules-editor.test.tsx —
// plus fidèle qu'un mock d'onChange vérifié en isolation.
function Harness({ initial = emptyStayRates() as DraftStayRates }) {
  const [value, setValue] = useState<DraftStayRates>(initial);
  return <StayRatesEditor value={value} onChange={setValue} />;
}

// CLAUDE.md §11.5 : cliquer le wrapper racine d'un Checkbox HeroUI v3 laisse l'état inchangé sans
// erreur — seul un clic ciblant le <input> natif niché à l'intérieur fonctionne.
function checkboxInput(testId: string): HTMLInputElement {
  const wrapper = screen.getByTestId(testId);
  const input = wrapper.querySelector("input");
  if (!input) throw new Error(`checkbox input introuvable pour ${testId}`);
  return input;
}

// Pas de @testing-library/jest-dom dans ce monorepo — assertions sur des propriétés DOM natives.
describe("StayRatesEditor", () => {
  it("aucun mois ni jour de week-end coché par défaut (emptyStayRates)", () => {
    render(<Harness />);
    expect(checkboxInput("stay-rates-month-12").checked).toBe(false);
    // weekendDays est présélectionné Ven+Sam côté données (emptyStayRates), reflété dans l'UI.
    expect(checkboxInput("stay-rates-weekend-day-5").checked).toBe(true);
    expect(checkboxInput("stay-rates-weekend-day-6").checked).toBe(true);
    expect(checkboxInput("stay-rates-weekend-day-1").checked).toBe(false);
  });

  it("cocher un mois de temporada alta ne coche que celui-ci", () => {
    render(<Harness />);
    const december = checkboxInput("stay-rates-month-12");
    const january = checkboxInput("stay-rates-month-1");
    fireEvent.click(december);
    expect(december.checked).toBe(true);
    expect(january.checked).toBe(false);
  });

  it("décocher un jour de week-end déjà coché le retire", () => {
    render(<Harness />);
    const friday = checkboxInput("stay-rates-weekend-day-5");
    expect(friday.checked).toBe(true);
    fireEvent.click(friday);
    expect(friday.checked).toBe(false);
  });

  it("« + Agregar servicio incluido » ajoute une ligne, « × » la retire", () => {
    render(<Harness />);
    expect(screen.queryByTestId("stay-rates-include-0")).toBeNull();
    fireEvent.click(screen.getByTestId("add-stay-rates-include-button"));
    expect(screen.queryByTestId("stay-rates-include-0")).not.toBeNull();
    fireEvent.click(screen.getByTestId("remove-stay-rates-include-0"));
    expect(screen.queryByTestId("stay-rates-include-0")).toBeNull();
  });

  it("saisir un service inclus met à jour la valeur du champ", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-stay-rates-include-button"));
    const input = screen.getByTestId("stay-rates-include-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Wifi" } });
    expect(input.value).toBe("Wifi");
  });
});
