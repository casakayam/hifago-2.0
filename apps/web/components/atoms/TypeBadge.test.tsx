import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TypeBadge } from "./TypeBadge";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions DOM
// natives uniquement.
//
// Ces tests ne vérifient JAMAIS une classe CSS de HeroUI par son nom (`chip--accent`…) : ce sont
// des détails d'implémentation d'une dépendance, qu'une montée de version peut renommer sans que
// le composant ait changé de comportement. Ils vérifient ce que l'atome promet : le libellé est
// toujours écrit, un type inconnu ne casse rien, et deux types différents ne se ressemblent pas.

const TYPES_REELS = ["lodging", "activity", "transport", "camp", "evento"];

function rendre(props: { type: string; label: string; testId?: string }) {
  const { container } = render(<TypeBadge {...props} />);
  const badge = container.firstElementChild;
  if (!badge) throw new Error("TypeBadge n'a rien rendu");
  return badge;
}

describe("TypeBadge", () => {
  it("écrit toujours le libellé en toutes lettres — la couleur ne porte jamais l'information seule", () => {
    for (const type of TYPES_REELS) {
      expect(rendre({ type, label: `libellé ${type}` }).textContent).toContain(`libellé ${type}`);
    }
  });

  it("retombe sur un style neutre pour un type inconnu, sans planter ni perdre le libellé", () => {
    // Le cas réel : une migration élargit le CHECK de products.type, la page publique est en ligne
    // avant que ce fichier ne soit mis à jour.
    const inconnu = rendre({ type: "coworking", label: "Coworking" });
    expect(inconnu.textContent).toContain("Coworking");
  });

  it("ne donne pas au type inconnu l'apparence d'un type connu", () => {
    const connu = rendre({ type: "lodging", label: "Alojamiento" }).getAttribute("class");
    const inconnu = rendre({ type: "coworking", label: "Coworking" }).getAttribute("class");
    expect(inconnu).not.toBe(connu);
  });

  it("distingue visuellement les cinq types réels les uns des autres", () => {
    const apparences = TYPES_REELS.map((type) => rendre({ type, label: type }).getAttribute("class"));
    expect(new Set(apparences).size).toBe(TYPES_REELS.length);
  });

  it("expose testId en data-testid, et rien quand il est absent", () => {
    expect(
      rendre({ type: "lodging", label: "Alojamiento", testId: "type-produit" }).getAttribute("data-testid")
    ).toBe("type-produit");
    expect(rendre({ type: "lodging", label: "Alojamiento" }).hasAttribute("data-testid")).toBe(false);
  });

  it("reste un élément en ligne — il s'insère dans un titre ou une ligne de carte", () => {
    expect(rendre({ type: "lodging", label: "Alojamiento" }).tagName).toBe("SPAN");
  });
});
