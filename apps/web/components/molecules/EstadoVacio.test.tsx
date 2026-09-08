import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EstadoVacio, type EstadoVacioProps } from "./EstadoVacio";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le sujet de ce fichier : cet état vide n'entre PAS dans la hiérarchie des titres de la page.
// C'est une règle invisible à l'œil (deux `<p>` centrés et deux `<h*>` centrés se ressemblent
// exactement) et qui casserait donc en silence, le jour où quelqu'un « améliorerait » le titre en
// y passant l'atome `Title`. Elle est tenue ici, explicitement.

function rendre(props: EstadoVacioProps) {
  const { container } = render(<EstadoVacio {...props} />);
  const racine = container.firstElementChild as HTMLElement;
  if (!racine) throw new Error("EstadoVacio n'a rien rendu");
  return racine;
}

const TITULO = "No encontramos ofertas para tu búsqueda";
const DESCRIPCION = "Prueba con otras fechas, con menos personas o quita algún filtro.";

describe("EstadoVacio", () => {
  it("rend le titre reçu, tel quel", () => {
    const racine = rendre({ titulo: TITULO });
    expect(racine.textContent).toBe(TITULO);
  });

  it("rend la description quand elle est fournie", () => {
    const racine = rendre({ titulo: TITULO, descripcion: DESCRIPCION });
    const paragraphes = racine.querySelectorAll("p");

    expect(paragraphes.length).toBe(2);
    expect(paragraphes[0].textContent).toBe(TITULO);
    expect(paragraphes[1].textContent).toBe(DESCRIPCION);
  });

  // ⚠️ Le complément qui compte : sans description, on ne rend pas un élément vide. Un `<p>` vide
  // laisserait le `gap-2` du conteneur ouvrir un blanc que rien ne remplit, et un lecteur d'écran
  // annoncerait un paragraphe fantôme.
  it("n'ajoute AUCUN élément quand la description est absente", () => {
    const racine = rendre({ titulo: TITULO });

    expect(racine.querySelectorAll("p").length).toBe(1);
    expect(racine.children.length).toBe(1);
  });

  // La règle que ce composant existe pour tenir : spec 28 §0 — un seul <h1>, les titres de section
  // sont des <h2>. L'état vide ne prend AUCUN niveau, sinon la structure de titres de l'accueil
  // changerait selon qu'il y a des résultats ou non.
  it("ne rend aucun titre HTML, ni avec ni sans description", () => {
    expect(rendre({ titulo: TITULO }).querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(
      rendre({ titulo: TITULO, descripcion: DESCRIPCION }).querySelector("h1, h2, h3, h4, h5, h6")
    ).toBeNull();
  });

  it("expose testId sur le conteneur, et préfixe ses deux enfants", () => {
    const racine = rendre({ titulo: TITULO, descripcion: DESCRIPCION, testId: "sin-resultados" });

    expect(racine.getAttribute("data-testid")).toBe("sin-resultados");
    expect(
      racine.querySelector('[data-testid="sin-resultados-titulo"]')?.textContent
    ).toBe(TITULO);
    expect(
      racine.querySelector('[data-testid="sin-resultados-descripcion"]')?.textContent
    ).toBe(DESCRIPCION);
  });

  it("ne pose aucun data-testid quand testId est absent", () => {
    const racine = rendre({ titulo: TITULO, descripcion: DESCRIPCION });

    expect(racine.hasAttribute("data-testid")).toBe(false);
    expect(racine.querySelectorAll("[data-testid]").length).toBe(0);
  });
});
