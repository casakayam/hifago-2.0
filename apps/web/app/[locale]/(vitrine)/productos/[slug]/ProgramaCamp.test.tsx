import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgramaCamp } from "./ProgramaCamp";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
const PROGRAMA = [
  { dia: 1, lineas: ["Recogida en Medellín", "Fogata al llegar"] },
  { dia: 3, lineas: ["Lancha por el embalse"] },
];

function renderPrograma(salidaIso: string | null, programa = PROGRAMA) {
  return render(
    <ProgramaCamp
      programa={programa}
      salidaIso={salidaIso}
      locale="es"
      titulo="El plan, día a día"
      etiquetaDia={(dia) => `Día ${dia}`}
      etiquetaDiaConFecha={(dia, fecha) => `Día ${dia} · ${fecha}`}
    />,
  );
}

describe("ProgramaCamp", () => {
  it("sans salida, n'affiche que le jour relatif — une date n'est jamais inventée", () => {
    renderPrograma(null);
    expect(screen.getByTestId("programa-camp-dia-1").textContent).toBe("Día 1");
    expect(screen.getByTestId("programa-camp-dia-3").textContent).toBe("Día 3");
  });

  it("avec une salida, date chaque journée depuis le départ (día 1 = jour du départ)", () => {
    renderPrograma("2026-11-15");
    const jour1 = screen.getByTestId("programa-camp-dia-1").textContent ?? "";
    const jour3 = screen.getByTestId("programa-camp-dia-3").textContent ?? "";
    expect(jour1.startsWith("Día 1 · ")).toBe(true);
    expect(jour1).toContain("15");
    // Le jour 3 tombe deux jours après le départ, pas trois.
    expect(jour3).toContain("17");
  });

  it("rend toutes les lignes d'une journée, dans l'ordre reçu", () => {
    renderPrograma(null);
    const lignes = [...document.querySelectorAll("li li")].map((n) => n.textContent);
    expect(lignes).toEqual(["Recogida en Medellín", "Fogata al llegar", "Lancha por el embalse"]);
  });

  it("le titre est un h2 — jamais un h3, qui rouvrirait le saut de hiérarchie de la fiche", () => {
    renderPrograma(null);
    expect(screen.getByText("El plan, día a día").tagName).toBe("H2");
  });

  it("un programme vide ne rend rien plutôt qu'un bloc titré sans contenu", () => {
    const { container } = renderPrograma(null, []);
    expect(container.innerHTML).toBe("");
  });

  it("tout le contenu est rendu d'emblée : rien derrière une interaction ni masqué par la largeur", () => {
    const { container } = renderPrograma("2026-11-15");
    expect(container.querySelectorAll("details").length).toBe(0);
    expect(container.innerHTML).not.toContain("hidden ");
  });
});
