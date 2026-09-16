import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CarruselConSombra } from "./CarruselConSombra";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// jsdom ne fait AUCUNE mise en page réelle : `scrollWidth`/`clientWidth`/`scrollLeft` valent 0 par
// défaut, quel que soit le contenu rendu. Pour prouver le comportement (dégradé qui apparaît quand
// il reste du contenu à droite, disparaît une fois défilé jusqu'au bord), ces trois propriétés sont
// redéfinies à la main sur le conteneur mesuré, puis un événement `scroll` réel est déclenché pour
// forcer le composant à relire ces valeurs — exactement ce qu'un vrai navigateur ferait au scroll.

class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

function definirDimensiones(
  el: HTMLElement,
  dims: { scrollWidth: number; clientWidth: number; scrollLeft: number }
) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: dims.scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: dims.clientWidth });
  Object.defineProperty(el, "scrollLeft", { configurable: true, value: dims.scrollLeft });
}

describe("CarruselConSombra", () => {
  it("rend les enfants transmis, tels quels", () => {
    const { getByTestId } = render(
      <CarruselConSombra testId="carrusel">
        <span data-testid="enfant">Contenu</span>
      </CarruselConSombra>
    );
    expect(getByTestId("enfant").textContent).toBe("Contenu");
    // Le conteneur qui défile porte le testId direct — pas de suffixe, c'est la racine visible.
    expect(getByTestId("carrusel")).not.toBeNull();
  });

  it("n'affiche aucun des deux dégradés tant qu'aucun dépassement n'est mesuré (contenu qui tient déjà)", () => {
    const { getByTestId } = render(
      <CarruselConSombra testId="carrusel">
        <span>Contenu</span>
      </CarruselConSombra>
    );
    // jsdom mesure 0/0/0 par défaut — équivalent à un contenu qui tient déjà dans le conteneur.
    for (const id of ["carrusel-sombra-izquierda", "carrusel-sombra-derecha"]) {
      const sombra = getByTestId(id);
      expect(sombra.className).toContain("opacity-0");
      expect(sombra.className).not.toContain("opacity-100");
    }
  });

  it("⚠️ affiche le dégradé de droite quand il reste du contenu à faire défiler, et le retire une fois arrivé au bord", () => {
    const { getByTestId } = render(
      <CarruselConSombra testId="carrusel">
        <span>Contenu</span>
      </CarruselConSombra>
    );
    const conteneur = getByTestId("carrusel");
    const sombra = getByTestId("carrusel-sombra-derecha");

    // 1000px de contenu dans une fenêtre de 300px, pas encore défilé : 700px restent à droite.
    definirDimensiones(conteneur, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    fireEvent.scroll(conteneur);
    expect(sombra.className).toContain("opacity-100");

    // Défilé jusqu'au bord exact (1000 - 300 = 700) : plus rien à droite, le dégradé disparaît.
    definirDimensiones(conteneur, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 700 });
    fireEvent.scroll(conteneur);
    expect(sombra.className).toContain("opacity-0");
    expect(sombra.className).not.toContain("opacity-100");
  });

  it("⚠️ affiche le dégradé de GAUCHE une fois qu'on a défilé, et le retire de retour au tout début", () => {
    const { getByTestId } = render(
      <CarruselConSombra testId="carrusel">
        <span>Contenu</span>
      </CarruselConSombra>
    );
    const conteneur = getByTestId("carrusel");
    const sombraGauche = getByTestId("carrusel-sombra-izquierda");

    // Tout au début : rien à gauche, le dégradé reste éteint.
    definirDimensiones(conteneur, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    fireEvent.scroll(conteneur);
    expect(sombraGauche.className).toContain("opacity-0");

    // Défilé de 400px : il reste du contenu à gauche, le dégradé s'allume.
    definirDimensiones(conteneur, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 400 });
    fireEvent.scroll(conteneur);
    expect(sombraGauche.className).toContain("opacity-100");
  });

  it("les deux dégradés sont décoratifs : `aria-hidden` et `pointer-events-none`, jamais un obstacle au clic ou à l'assistance", () => {
    const { getByTestId } = render(
      <CarruselConSombra testId="carrusel">
        <span>Contenu</span>
      </CarruselConSombra>
    );
    for (const id of ["carrusel-sombra-izquierda", "carrusel-sombra-derecha"]) {
      const sombra = getByTestId(id);
      expect(sombra.getAttribute("aria-hidden")).toBe("true");
      expect(sombra.className).toContain("pointer-events-none");
    }
  });
});
