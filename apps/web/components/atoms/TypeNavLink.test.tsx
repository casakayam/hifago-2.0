import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TypeBadge } from "./TypeBadge";
import { TypeNavLink } from "./TypeNavLink";
import type { TipoOferta } from "@/lib/catalog/tipos";

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

const TIPOS: TipoOferta[] = ["activity", "lodging", "transport", "camp", "evento"];

describe("TypeNavLink", () => {
  it("rend un vrai <a href> via le Link localisé, pas un <a> natif", () => {
    const el = lien(<TypeNavLink tipo="activity" label="Actividades" href="/actividades" activo={false} />);
    expect(el.getAttribute("href")).toBe("/actividades");
    expect(el.getAttribute("data-localized")).toBe("true");
  });

  it('pose aria-current="page" seulement quand activo=true', () => {
    const actif = lien(<TypeNavLink tipo="activity" label="Actividades" href="/actividades" activo={true} />);
    expect(actif.getAttribute("aria-current")).toBe("page");

    const inactif = lien(<TypeNavLink tipo="activity" label="Actividades" href="/actividades" activo={false} />);
    expect(inactif.getAttribute("aria-current")).toBeNull();
  });

  it("expose testId sur le lien", () => {
    const el = lien(
      <TypeNavLink tipo="lodging" label="Alojamiento" href="/alojamiento" activo={false} testId="nav-lodging" />
    );
    expect(el.getAttribute("data-testid")).toBe("nav-lodging");
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ LA PREUVE D'IDENTITÉ AVEC `TypeBadge` — le style ne doit JAMAIS diverger du badge existant
  // ─────────────────────────────────────────────────────────────────────────────────────────
  //
  // `STYLES_PAR_TYPE`/`STYLE_INCONNU` sont mesurés au contraste WCAG dans `TypeBadge.tsx` : les
  // recopier ferait diverger les deux au premier ajout de type. On compare donc les classes réelles
  // plutôt que de deviner la table. `Chip` de HeroUI pose `data-slot="chip"` sur son span racine.
  for (const tipo of TIPOS) {
    it(`reprend exactement les classes du badge TypeBadge pour le type ${tipo}`, () => {
      const { container: badgeContainer } = render(<TypeBadge type={tipo} label="x" />);
      const badge = badgeContainer.querySelector('[data-slot="chip"]') as HTMLElement;
      expect(badge).not.toBeNull();
      const classesBadge = badge.className.split(/\s+/).filter(Boolean);

      const el = lien(<TypeNavLink tipo={tipo} label="x" href="/x" activo={false} />);
      const classesLien = el.className.split(/\s+/).filter(Boolean);

      for (const classe of classesBadge) {
        expect(classesLien).toContain(classe);
      }
    });
  }
});
