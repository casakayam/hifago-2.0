import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProgramEditor } from "./program-editor";
import { emptyProgram, toProgramColumn, type DraftProgram } from "@/lib/products/program";

// Composant contrôlé sans I/O (spec 37) : exercé via un harnais qui tient l'état, comme le fait
// ProductTypeFields en pratique — plus fidèle qu'un onChange mocké vérifié en isolation.
function Harness({
  initial = emptyProgram(),
  durationDays = null,
}: {
  initial?: DraftProgram;
  durationDays?: number | null;
}) {
  const [program, setProgram] = useState<DraftProgram>(initial);
  return <ProgramEditor value={program} onChange={setProgram} durationDays={durationDays} />;
}

function ligne(day: number, index: number): HTMLInputElement {
  return screen.getByTestId(`program-day-${day}-line-${index}`) as HTMLInputElement;
}

describe("ProgramEditor", () => {
  it("ouvre une carte par journée du camp quand la durée est connue", () => {
    render(<Harness durationDays={3} />);
    expect(screen.getByTestId("clear-program-day-1")).toBeTruthy();
    expect(screen.getByTestId("clear-program-day-3")).toBeTruthy();
    expect(screen.queryByTestId("clear-program-day-4")).toBeNull();
  });

  it("reste utilisable quand la durée n'est pas encore saisie — le cas de l'écran de création", () => {
    render(<Harness durationDays={null} />);
    expect(screen.getByTestId("clear-program-day-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("add-program-day-button"));
    expect(screen.getByTestId("clear-program-day-2")).toBeTruthy();
  });

  it("plusieurs lignes dans la même journée — le cas normal, pas une anomalie", () => {
    render(<Harness durationDays={2} />);
    fireEvent.change(ligne(1, 0), { target: { value: "Recogida" } });
    fireEvent.click(screen.getByTestId("add-program-day-1-line-button"));
    fireEvent.change(ligne(1, 1), { target: { value: "Fogata" } });
    expect(ligne(1, 0).value).toBe("Recogida");
    expect(ligne(1, 1).value).toBe("Fogata");
  });

  it("basculer de langue ne perd pas ce qui a été saisi dans l'autre — LA régression à empêcher", () => {
    render(<Harness durationDays={1} />);
    fireEvent.change(ligne(1, 0), { target: { value: "Recogida en Medellín" } });

    fireEvent.click(screen.getByTestId("program-lang-en"));
    expect(ligne(1, 0).value).toBe("");
    fireEvent.change(ligne(1, 0), { target: { value: "Pickup in Medellín" } });

    fireEvent.click(screen.getByTestId("program-lang-es"));
    expect(ligne(1, 0).value).toBe("Recogida en Medellín");
    fireEvent.click(screen.getByTestId("program-lang-en"));
    expect(ligne(1, 0).value).toBe("Pickup in Medellín");
  });

  it("retirer une ligne ne décale pas le contenu des autres", () => {
    render(<Harness durationDays={1} />);
    fireEvent.change(ligne(1, 0), { target: { value: "A" } });
    fireEvent.click(screen.getByTestId("add-program-day-1-line-button"));
    fireEvent.change(ligne(1, 1), { target: { value: "B" } });
    fireEvent.click(screen.getByTestId("remove-program-day-1-line-0"));
    expect(ligne(1, 0).value).toBe("B");
  });

  it("« Vaciar » vide la journée sans la faire disparaître quand elle est dans la durée", () => {
    render(<Harness durationDays={2} />);
    fireEvent.change(ligne(2, 0), { target: { value: "Lancha" } });
    fireEvent.click(screen.getByTestId("clear-program-day-2"));
    expect(screen.getByTestId("clear-program-day-2")).toBeTruthy();
    expect(ligne(2, 0).value).toBe("");
  });

  it("hydrate un programme existant, langue par langue", () => {
    render(
      <Harness
        durationDays={2}
        initial={[{ day: 2, lines: [{ es: "Lancha", en: "Boat ride" }] }]}
      />,
    );
    expect(ligne(2, 0).value).toBe("Lancha");
    fireEvent.click(screen.getByTestId("program-lang-en"));
    expect(ligne(2, 0).value).toBe("Boat ride");
  });

  it("ce qui est saisi produit bien la colonne attendue (bout en bout avec le module pur)", () => {
    function HarnessAvecSortie() {
      const [program, setProgram] = useState<DraftProgram>(emptyProgram());
      return (
        <>
          <ProgramEditor value={program} onChange={setProgram} durationDays={2} />
          <output data-testid="sortie">{JSON.stringify(toProgramColumn(program))}</output>
        </>
      );
    }
    render(<HarnessAvecSortie />);
    fireEvent.change(ligne(1, 0), { target: { value: "Recogida" } });
    fireEvent.change(ligne(2, 0), { target: { value: "Lancha" } });
    expect(JSON.parse(screen.getByTestId("sortie").textContent ?? "null")).toEqual([
      { day: 1, text: { es: "Recogida" } },
      { day: 2, text: { es: "Lancha" } },
    ]);
  });
});
