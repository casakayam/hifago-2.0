import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SlotRulesEditor } from "./slot-rules-editor";
import { emptySlotRule, type DraftSlotRule } from "@/lib/products/slotRules";

// Composant contrôlé, sans I/O réseau (spec 11) : ce test l'exerce via un harnais qui tient l'état,
// comme le ferait ProductForm/ProductSlotRulesBlock en pratique — plus fidèle qu'un mock d'onChange
// vérifié en isolation.
function Harness({ initialRules = [] as DraftSlotRule[] }) {
  const [rules, setRules] = useState<DraftSlotRule[]>(initialRules);
  return <SlotRulesEditor rules={rules} onChange={setRules} />;
}

// CLAUDE.md §11.5 : cliquer le wrapper racine d'un Checkbox HeroUI v3 laisse l'état inchangé sans
// erreur — seul un clic ciblant le <input> natif niché à l'intérieur fonctionne (même piège que
// documenté pour Playwright, .locator("input")).
function checkboxInput(testId: string): HTMLInputElement {
  const wrapper = screen.getByTestId(testId);
  const input = wrapper.querySelector("input");
  if (!input) throw new Error(`checkbox input introuvable pour ${testId}`);
  return input;
}

// Pas de @testing-library/jest-dom dans ce monorepo (aucun test composant n'existait avant spec
// 11) : assertions sur des propriétés DOM natives plutôt que des matchers jest-dom, pour ne pas
// ajouter une dépendance supplémentaire pour ce seul fichier.
describe("SlotRulesEditor", () => {
  it("ne montre aucun bloc de règle au départ, seulement le bouton d'ajout", () => {
    render(<Harness />);
    expect(screen.queryByTestId("slot-rules-editor")).not.toBeNull();
    expect(screen.queryByTestId("slot-rule-weekday-1-0")).toBeNull();
    expect(screen.queryByTestId("add-slot-rule-button")).not.toBeNull();
  });

  it("« + Agregar horario » ajoute une règle vide", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-slot-rule-button"));
    expect(screen.queryByTestId("slot-rule-weekday-1-0")).not.toBeNull();
    expect(screen.queryByTestId("slot-rule-start-0")).not.toBeNull();
    expect(screen.queryByTestId("slot-rule-end-0")).not.toBeNull();
  });

  it("cocher un jour ne coche que celui-ci, les autres restent décochés", () => {
    render(<Harness initialRules={[emptySlotRule()]} />);
    const monday = checkboxInput("slot-rule-weekday-1-0");
    const tuesday = checkboxInput("slot-rule-weekday-2-0");

    expect(monday.checked).toBe(false);
    fireEvent.click(monday);
    expect(monday.checked).toBe(true);
    expect(tuesday.checked).toBe(false);
  });

  it("décocher un jour déjà coché le retire", () => {
    render(<Harness initialRules={[emptySlotRule()]} />);
    const monday = checkboxInput("slot-rule-weekday-1-0");
    fireEvent.click(monday);
    expect(monday.checked).toBe(true);
    fireEvent.click(monday);
    expect(monday.checked).toBe(false);
  });

  it("une règle complète et valide affiche la prévisualisation des créneaux générés", () => {
    render(
      <Harness
        initialRules={[
          {
            weekdays: [1, 2, 3, 4, 5, 6],
            startTime: "10:00",
            endTime: "21:00",
            slotDurationMinutes: "60",
            capacity: "4",
          },
        ]}
      />,
    );
    const preview = screen.getByTestId("slot-rule-preview-0");
    // 11 créneaux générés (10h-21h, pas de 60 min), tronqués à 8 avec un compteur — cf.
    // formatSlotPreviewSummary.
    expect(preview.textContent).toContain("10:00–11:00");
    expect(preview.textContent).toContain("(+3 más)");
  });

  it("une règle incomplète n'affiche aucune prévisualisation", () => {
    render(<Harness initialRules={[emptySlotRule()]} />);
    expect(screen.queryByTestId("slot-rule-preview-0")).toBeNull();
  });

  it("« Quitar horario » retire la règle", () => {
    render(<Harness initialRules={[emptySlotRule()]} />);
    expect(screen.queryByTestId("slot-rule-weekday-1-0")).not.toBeNull();
    fireEvent.click(screen.getByTestId("remove-slot-rule-0"));
    expect(screen.queryByTestId("slot-rule-weekday-1-0")).toBeNull();
  });
});
