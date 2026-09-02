import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PageShell } from "./PageShell";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions sur
// des propriétés/queries DOM natives uniquement.
//
// Ce fichier teste la SÉMANTIQUE, pas l'apparence : qu'il n'y a qu'un <main>, qu'il ne contient
// aucun landmark ni titre de sa propre initiative, et que chaque variant garde sa largeur. Les
// classes exactes sont vérifiées parce qu'elles SONT le contrat de cet atome — il n'a rien d'autre.
function shell(variant: "large" | "narrow" | "centered", children = <p>contenu</p>) {
  const { container } = render(<PageShell variant={variant}>{children}</PageShell>);
  const main = container.firstElementChild as HTMLElement;
  return { container, main };
}

describe("PageShell", () => {
  it("rend un <main>, et un seul élément racine", () => {
    const { container, main } = shell("large");
    expect(container.children.length).toBe(1);
    expect(main.tagName).toBe("MAIN");
    expect(container.querySelectorAll("main").length).toBe(1);
  });

  // ⚠️ Le garde-fou principal : une coquille qui rendrait un titre ou un landmark de son côté
  // produirait plusieurs <h1>/<header> par page dès qu'une page en ajoute un. Le niveau appartient
  // à Title, <header>/<footer> appartiennent au layout (vague 2).
  it("ne rend ni titre, ni <header>, ni <footer>, ni <nav>", () => {
    const { main } = shell("centered");
    expect(main.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(main.querySelector("header, footer, nav")).toBeNull();
  });

  it("borne la largeur à max-w-3xl en variant large", () => {
    const { main } = shell("large");
    expect(main.className).toContain("max-w-3xl");
    expect(main.className).toContain("mx-auto");
  });

  it("borne la largeur à max-w-2xl en variant narrow", () => {
    const { main } = shell("narrow");
    expect(main.className).toContain("max-w-2xl");
    expect(main.className).not.toContain("max-w-3xl");
  });

  it("centre sans borner la largeur en variant centered", () => {
    const { main } = shell("centered");
    expect(main.className).toContain("items-center");
    expect(main.className).toContain("justify-center");
    expect(main.className).not.toContain("max-w-");
    // Le `text-center` de verify-email est l'alignement du contenu de cette page, pas la coquille.
    expect(main.className).not.toContain("text-center");
  });

  it("applique le même gap-6 et le même p-6 sm:p-8 aux trois variants", () => {
    for (const variant of ["large", "narrow", "centered"] as const) {
      const { main } = shell(variant);
      // Un seul gap : le `gap-4` de deux pages était une dérive, pas une décision.
      expect(main.className).toContain("gap-6");
      expect(main.className).not.toContain("gap-4");
      // Mobile d'abord : 24 px de marge sur petit écran, 32 px à partir de `sm`.
      expect(main.className).toContain("p-6");
      expect(main.className).toContain("sm:p-8");
    }
  });

  it("expose testId sur le <main>", () => {
    const { container } = render(
      <PageShell variant="large" testId="page-accueil">
        <p>contenu</p>
      </PageShell>
    );
    expect(container.querySelector('[data-testid="page-accueil"]')?.tagName).toBe("MAIN");
  });

  it("rend ses enfants tels quels", () => {
    const { main } = shell("narrow", <p data-testid="enfant">bonjour</p>);
    expect(main.querySelector('[data-testid="enfant"]')?.textContent).toBe("bonjour");
  });
});
