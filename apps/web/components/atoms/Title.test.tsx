import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Title } from "./Title";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le sujet de ce fichier tient en une phrase : `as` décide de la BALISE, `size` décide de
// l'APPARENCE, et l'une ne déteint jamais sur l'autre. C'est la seule chose qui empêche un <h3>
// écrit pour obtenir du petit texte.
function titre(element: React.ReactElement) {
  const { container } = render(element);
  return container.firstElementChild as HTMLElement;
}

describe("Title", () => {
  it("rend la balise demandée par `as`", () => {
    expect(titre(<Title as="h1">Titre</Title>).tagName).toBe("H1");
    expect(titre(<Title as="h2">Titre</Title>).tagName).toBe("H2");
    expect(titre(<Title as="h3">Titre</Title>).tagName).toBe("H3");
  });

  // ⚠️ Le test qui porte la décision : demander une autre taille ne change JAMAIS le niveau.
  it("`size` ne change pas la balise", () => {
    expect(titre(<Title as="h2" size="sm">Disponibilidad</Title>).tagName).toBe("H2");
    expect(titre(<Title as="h2" size="lg">Disponibilidad</Title>).tagName).toBe("H2");
    expect(titre(<Title as="h3" size="lg">Section</Title>).tagName).toBe("H3");
  });

  it("dérive la taille par défaut du niveau : h1→lg, h2→md, h3→sm", () => {
    expect(titre(<Title as="h1">Titre</Title>).className).toBe("text-2xl font-semibold");
    expect(titre(<Title as="h2">Titre</Title>).className).toBe("text-lg font-medium");
    expect(titre(<Title as="h3">Titre</Title>).className).toBe("text-sm font-medium");
  });

  it("applique la taille explicite quand elle est donnée", () => {
    // Le cas réel : les <h2> « availabilityTitle » des trois formulaires de réservation.
    expect(titre(<Title as="h2" size="sm">Disponibilidad</Title>).className).toBe(
      "text-sm font-medium"
    );
    expect(titre(<Title as="h3" size="lg">Section</Title>).className).toBe(
      "text-2xl font-semibold"
    );
  });

  it("expose testId sur la balise de titre", () => {
    const element = titre(
      <Title as="h1" testId="product-name">
        GLAMPING
      </Title>
    );
    expect(element.getAttribute("data-testid")).toBe("product-name");
    expect(element.tagName).toBe("H1");
  });

  it("rend son contenu, y compris un enfant React", () => {
    const element = titre(
      <Title as="h2">
        Casa Kayam <span data-testid="badge">·&nbsp;6</span>
      </Title>
    );
    expect(element.textContent).toContain("Casa Kayam");
    expect(element.querySelector('[data-testid="badge"]')).not.toBeNull();
  });
});
