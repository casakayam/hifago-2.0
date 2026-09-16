import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TypeNavLink } from "./TypeNavLink";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que LinkButton.test.tsx/BackLink.test.tsx, et pour la même raison : `@/i18n/navigation`
// tire next-intl/navigation → next/navigation, dont la résolution casse sous Vitest. L'attribut
// `data-localized` prouve que le lien passe bien par ce `Link`, et pas par un `<a href>` natif ou
// `next/link` — exactement ce que ce composant existe pour garantir (voir son en-tête).
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

function lien(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("a") as HTMLAnchorElement;
}

describe("TypeNavLink", () => {
  it("rend un vrai <a href> via le Link localisé, pas un <a> natif", () => {
    const el = lien(<TypeNavLink label="Actividades" href="/actividades" activo={false} />);
    expect(el.getAttribute("href")).toBe("/actividades");
    expect(el.getAttribute("data-localized")).toBe("true");
  });

  it('pose aria-current="page" seulement quand activo=true', () => {
    const actif = lien(<TypeNavLink label="Actividades" href="/actividades" activo={true} />);
    expect(actif.getAttribute("aria-current")).toBe("page");

    const inactif = lien(<TypeNavLink label="Actividades" href="/actividades" activo={false} />);
    expect(inactif.getAttribute("aria-current")).toBeNull();
  });

  it("expose testId sur le lien", () => {
    const el = lien(<TypeNavLink label="Alojamiento" href="/alojamiento" activo={false} testId="nav-lodging" />);
    expect(el.getAttribute("data-testid")).toBe("nav-lodging");
  });

  // ⚠️ Plus de couleur (retirée avec `chipVariants`/`TypeBadge`, 2026-09-15) : le soulignement est
  // désormais le SEUL signal actif, à vérifier directement plutôt que par comparaison à un badge.
  it("le soulignement additif est le seul signal visuel de l'état actif", () => {
    const actif = lien(<TypeNavLink label="Actividades" href="/actividades" activo={true} />);
    expect(actif.className).toContain("underline");
    expect(actif.className).toContain("underline-offset-4");

    const inactif = lien(<TypeNavLink label="Actividades" href="/actividades" activo={false} />);
    expect(inactif.className).not.toContain("underline-offset-4");
  });
});
