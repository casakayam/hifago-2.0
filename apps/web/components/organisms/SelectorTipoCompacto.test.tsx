import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectorTipoCompacto } from "./SelectorTipoCompacto";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que TypeNavLink.test.tsx/LanguageSwitcher.test.tsx : `@/i18n/navigation` tire
// next-intl/navigation → next/navigation, dont la résolution casse sous Vitest.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

const TIPOS = [
  { tipo: "activity" as const, label: "Actividades", href: "/actividades" },
  { tipo: "lodging" as const, label: "Alojamientos", href: "/alojamientos" },
  { tipo: "transport" as const, label: "Transportes", href: "/transportes" },
  { tipo: "camp" as const, label: "Camps", href: "/camps" },
  { tipo: "evento" as const, label: "Eventos", href: "/eventos" },
];

function rendu(tipoActivo?: (typeof TIPOS)[number]["tipo"]) {
  const { container } = render(
    <SelectorTipoCompacto tipos={TIPOS} tipoActivo={tipoActivo} etiqueta="Tipos de oferta" testId="sel" />
  );
  return {
    container,
    declencheur: container.querySelector('[data-testid="sel-trigger"]') as HTMLButtonElement,
    panneau: container.querySelector('[data-testid="sel-panneau"]') as HTMLElement,
  };
}

describe("SelectorTipoCompacto", () => {
  it("affiche le libellé du type actif sur le déclencheur", () => {
    expect(rendu("lodging").declencheur.textContent).toContain("Alojamientos");
  });

  it("affiche l'étiquette générique quand aucun type n'est actif (cas de la home)", () => {
    expect(rendu(undefined).declencheur.textContent).toContain("Tipos de oferta");
  });

  it("propose les 5 types, chacun en vrai lien vers sa route", () => {
    const { container } = rendu("lodging");
    for (const { tipo, href } of TIPOS) {
      const lien = container.querySelector(`[data-testid="sel-${tipo}"]`) as HTMLAnchorElement;
      expect(lien.tagName).toBe("A");
      expect(lien.getAttribute("href")).toBe(href);
      expect(lien.getAttribute("data-localized")).toBe("true");
    }
  });

  it("marque le type actif autrement que par un signe visuel", () => {
    const { container } = rendu("camp");
    expect((container.querySelector('[data-testid="sel-camp"]') as HTMLElement).getAttribute("aria-current")).toBe(
      "page"
    );
    expect(
      (container.querySelector('[data-testid="sel-lodging"]') as HTMLElement).getAttribute("aria-current")
    ).toBeNull();
  });

  // ⚠️ Mesuré en rendu SERVEUR, même raison que LanguageSwitcher : un Dropdown/Popover de HeroUI ne
  // contient AUCUN de ses liens dans le HTML servi tant qu'il est fermé — ici ce sont les 5 routes
  // de catalogue, indexées via le maillage interne, sur l'écran que Googlebot indexe en priorité.
  it("laisse ses 5 liens dans le HTML SERVI alors qu'il est fermé", () => {
    const html = renderToStaticMarkup(
      <SelectorTipoCompacto tipos={TIPOS} tipoActivo="lodging" etiqueta="Tipos de oferta" testId="sel" />
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden=");
    for (const { href } of TIPOS) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("annonce son état et ce qu'il commande", () => {
    const { declencheur, panneau } = rendu("lodging");
    expect(declencheur.getAttribute("aria-expanded")).toBe("false");
    expect(declencheur.getAttribute("aria-controls")).toBe(panneau.id);
    expect(panneau.hasAttribute("hidden")).toBe(true);

    fireEvent.click(declencheur);
    expect(declencheur.getAttribute("aria-expanded")).toBe("true");
    expect(panneau.hasAttribute("hidden")).toBe(false);
  });

  it("se ferme par Échap et rend le focus au déclencheur", () => {
    const { declencheur, panneau } = rendu("lodging");
    fireEvent.click(declencheur);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panneau.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(declencheur);
  });

  it("se ferme au clic à l'extérieur", () => {
    const { declencheur, panneau } = rendu("lodging");
    fireEvent.click(declencheur);
    expect(panneau.hasAttribute("hidden")).toBe(false);
    fireEvent.mouseDown(document.body);
    expect(panneau.hasAttribute("hidden")).toBe(true);
  });

  it("se ferme au clic sur une entrée", () => {
    const { container, declencheur, panneau } = rendu("lodging");
    fireEvent.click(declencheur);
    fireEvent.click(container.querySelector('[data-testid="sel-camp"]') as HTMLElement);
    expect(panneau.hasAttribute("hidden")).toBe(true);
  });

  it("garde une cible tactile de 44 px sur le déclencheur et sur chaque entrée", () => {
    const { container, declencheur } = rendu("lodging");
    expect(declencheur.className).toContain("min-h-11");
    for (const { tipo } of TIPOS) {
      expect((container.querySelector(`[data-testid="sel-${tipo}"]`) as HTMLElement).className).toContain("min-h-11");
    }
  });
});
