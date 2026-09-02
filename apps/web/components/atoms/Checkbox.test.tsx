import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Checkbox } from "./Checkbox";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
function rendu(element: React.ReactElement) {
  const { container } = render(element);
  return {
    container,
    racine: container.querySelector('[data-slot="checkbox"]') as HTMLElement,
    input: container.querySelector("input") as HTMLInputElement,
  };
}

describe("Checkbox", () => {
  it("rend son libellé et son état", () => {
    const { racine, input } = rendu(
      <Checkbox label="Quiero recibir ofertas" isSelected onChange={() => {}} testId="consent" />
    );
    expect(racine.textContent).toBe("Quiero recibir ofertas");
    expect(input.checked).toBe(true);
    expect(racine.getAttribute("data-testid")).toBe("consent");
  });

  // ⚠️ CLAUDE.md §11 point 5 : cliquer le wrapper racine d'un Checkbox HeroUI laisse l'état
  // INCHANGÉ, sans lever d'erreur — un piège silencieux, qui fait passer un test pour vert alors
  // qu'il ne teste rien. Seul un clic sur l'<input> fonctionne. Les deux moitiés sont vérifiées
  // ici pour que le piège reste documenté par du code exécuté, pas par un commentaire.
  it("bascule au clic sur l'input, et pas au clic sur la racine (piège §11.5)", () => {
    const onChange = vi.fn();
    const { racine, input } = rendu(
      <Checkbox label="Ofertas" isSelected={false} onChange={onChange} />
    );
    fireEvent.click(racine);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("relie son texte d'aide et son erreur à la case", () => {
    const { container, input } = rendu(
      <Checkbox
        label="Acepto las condiciones"
        isSelected={false}
        onChange={() => {}}
        hint="Puedes darte de baja cuando quieras"
        error="Debes aceptar para continuar"
        testId="cgu"
      />
    );
    const aide = container.querySelector('[data-testid="cgu-hint"]') as HTMLElement;
    const erreur = container.querySelector('[data-testid="cgu-error"]') as HTMLElement;
    // ⚠️ Contrairement aux trois autres champs, aucun conteneur react-aria ne pose ce lien : il est
    // écrit à la main dans le composant. S'il disparaissait, rien à l'écran ne le montrerait.
    const decrits = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(decrits).toContain(aide.id);
    expect(decrits).toContain(erreur.id);
  });

  it("ne décrit rien quand il n'y a ni aide ni erreur", () => {
    const { input } = rendu(<Checkbox label="Ofertas" isSelected={false} onChange={() => {}} />);
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("se marque invalide quand une erreur est fournie", () => {
    const { racine } = rendu(
      <Checkbox label="Acepto" isSelected={false} onChange={() => {}} error="Obligatorio" />
    );
    expect(racine.getAttribute("data-invalid")).toBe("true");
  });

  // ⚠️ La couleur elle-même n'est plus décidée ici : `.error-message` est recalibrée pour le thème
  // vitrine dans packages/ui/src/styles/globals.css (2026-09-02), parce que trois autres champs la
  // rendaient au jeton d'aplat `--danger` — 3.56:1, sous le seuil WCAG de 4.5:1. Ce test vérifie
  // donc que Checkbox passe bien par cette décision partagée au lieu d'en réécrire une locale.
  it("écrit son erreur avec la classe d'erreur partagée, pas une couleur locale", () => {
    const { container } = rendu(
      <Checkbox label="Acepto" isSelected={false} onChange={() => {}} error="Obligatorio" testId="c" />
    );
    const erreur = container.querySelector('[data-testid="c-error"]') as HTMLElement;
    expect(erreur.className).toContain("error-message");
    expect(erreur.className).not.toContain("[color:");
  });

  it("garde une cible tactile d'au moins 44 px sur toute la ligne", () => {
    const { racine } = rendu(<Checkbox label="Ofertas" isSelected={false} onChange={() => {}} />);
    expect(racine.className).toContain("min-h-11");
  });

  it("se désactive", () => {
    const { input } = rendu(
      <Checkbox label="Ofertas" isSelected={false} onChange={() => {}} isDisabled />
    );
    expect(input.hasAttribute("disabled")).toBe(true);
  });
});
