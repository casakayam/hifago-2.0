import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectorTipo } from "./SelectorTipo";
import type { TipoOferta } from "@/lib/catalog/tipos";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que TypeNavLink.test.tsx.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

// jsdom ne fait AUCUNE mise en page réelle : `offsetWidth`/`clientWidth` valent 0 par défaut pour
// tout le monde — équivalent à "tout tient sur une ligne" (voir le premier test). Pour prouver le
// repli, `offsetWidth`/`clientWidth` sont redéfinis À LA MAIN, indexés par `data-testid`, AVANT le
// premier rendu : le premier `useLayoutEffect` du composant les lit donc dès son premier passage,
// comme un vrai navigateur l'aurait mesuré après mise en page. Même esprit que
// `CarruselConSombra.test.tsx`, adapté à des largeurs cumulées plutôt qu'à un scroll.
class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

function simularAnchos(anchosPorTestId: Record<string, number>) {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      const testId = this.getAttribute("data-testid");
      return testId && testId in anchosPorTestId ? anchosPorTestId[testId] : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      const testId = this.getAttribute("data-testid");
      return testId && testId in anchosPorTestId ? anchosPorTestId[testId] : 0;
    },
  });
}

const TIPOS: { tipo: TipoOferta; label: string; href: string }[] = [
  { tipo: "activity", label: "Actividades", href: "/actividades" },
  { tipo: "lodging", label: "Alojamientos", href: "/alojamientos" },
  { tipo: "transport", label: "Transportes", href: "/transportes" },
  { tipo: "camp", label: "Camps", href: "/camps" },
  { tipo: "evento", label: "Eventos", href: "/eventos" },
];

const PROPS_BASE = {
  tipos: TIPOS,
  etiqueta: "Tipos de oferta",
  masEtiqueta: "Más",
  menosEtiqueta: "Menos",
  testId: "selector-tipos",
};

// Chaque item mesuré à 80px, "Más" à 60px, conteneur à 400px : les 5 items seuls (5×80 + 4×16
// gaps = 464) débordent, mais 3 items + gap + "Más" (3×80 + 2×16 + 16 + 60 = 348) tiennent — le
// 4e ferait 444, qui déborde. Régression du bug réel : l'ancien algorithme (fondé sur `offsetTop`,
// sans jamais compter la largeur de "Más" lui-même) aurait laissé passer 4 items et poussé "Más"
// tout seul à la ligne 2 — précisément le défaut que ce calcul cumulé corrige.
const ANCHOS_DEBORDEMENT = {
  "selector-tipos-activity-item": 80,
  "selector-tipos-lodging-item": 80,
  "selector-tipos-transport-item": 80,
  "selector-tipos-camp-item": 80,
  "selector-tipos-evento-item": 80,
  "selector-tipos-mas-medidor": 60,
  "selector-tipos-fila": 400,
};

describe("SelectorTipo", () => {
  it("sans débordement (défaut jsdom) : les 5 liens réels dans l'ordre, un seul actif, aucun bouton Más", () => {
    const { container, queryByTestId } = render(<SelectorTipo {...PROPS_BASE} tipoActivo="camp" />);
    const liens = Array.from(container.querySelectorAll("a"));
    expect(liens.map((a) => a.textContent)).toEqual([
      "Actividades",
      "Alojamientos",
      "Transportes",
      "Camps",
      "Eventos",
    ]);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    for (const lien of liens) expect(lien.hasAttribute("hidden")).toBe(false);
    expect(queryByTestId("selector-tipos-mas")).toBeNull();
  });

  it("HTML servi (SSR) : les 5 href réels, aucun attribut hidden, tant que rien n'est mesuré", () => {
    const html = renderToStaticMarkup(<SelectorTipo {...PROPS_BASE} />);
    for (const { href } of TIPOS) expect(html).toContain(`href="${href}"`);
    // `(?<!aria-)hidden` : exclut délibérément `aria-hidden="true"`, légitime sur les SVG
    // décoratifs et sur le clone de mesure de "Más" — seul l'attribut `hidden` NU sur un item
    // compterait comme un vrai repli, qui ne doit jamais apparaître tant que rien n'est mesuré.
    expect(html).not.toMatch(/(?<!aria-)hidden/);
    expect(html).not.toContain('data-testid="selector-tipos-mas"');
  });

  it("⚠️ débordement mesuré EN TENANT COMPTE DE LA LARGEUR DE « MÁS » : 2 items cachés, « Más » reste sur la même ligne", () => {
    simularAnchos(ANCHOS_DEBORDEMENT);
    const { getByTestId, queryByTestId } = render(<SelectorTipo {...PROPS_BASE} />);

    expect(getByTestId("selector-tipos-activity").closest("span")?.hasAttribute("hidden")).toBe(false);
    expect(getByTestId("selector-tipos-lodging").closest("span")?.hasAttribute("hidden")).toBe(false);
    expect(getByTestId("selector-tipos-transport").closest("span")?.hasAttribute("hidden")).toBe(false);
    expect(getByTestId("selector-tipos-camp").closest("span")?.hasAttribute("hidden")).toBe(true);
    expect(getByTestId("selector-tipos-evento").closest("span")?.hasAttribute("hidden")).toBe(true);

    const mas = getByTestId("selector-tipos-mas");
    expect(mas.getAttribute("aria-expanded")).toBe("false");
    expect(mas.textContent).toContain("Más");

    fireEvent.click(mas);
    expect(mas.getAttribute("aria-expanded")).toBe("true");
    expect(mas.textContent).toContain("Menos");
    expect(getByTestId("selector-tipos-camp").closest("span")?.hasAttribute("hidden")).toBe(false);
    expect(getByTestId("selector-tipos-evento").closest("span")?.hasAttribute("hidden")).toBe(false);

    fireEvent.click(mas);
    expect(mas.getAttribute("aria-expanded")).toBe("false");
    expect(getByTestId("selector-tipos-camp").closest("span")?.hasAttribute("hidden")).toBe(true);
    expect(queryByTestId("selector-tipos-mas")).not.toBeNull();
  });

  it("le clone de mesure de « Más » est invisible, hors flux, et ne s'affiche jamais aux lecteurs d'écran", () => {
    simularAnchos(ANCHOS_DEBORDEMENT);
    const { getByTestId } = render(<SelectorTipo {...PROPS_BASE} />);
    const medidor = getByTestId("selector-tipos-mas-medidor");
    expect(medidor.getAttribute("aria-hidden")).toBe("true");
    expect(medidor.className).toContain("invisible");
    expect(medidor.className).toContain("absolute");
  });

  it("cible tactile ≥44px sur chaque lien et sur le bouton Más", () => {
    simularAnchos(ANCHOS_DEBORDEMENT);
    const { getByTestId } = render(<SelectorTipo {...PROPS_BASE} />);
    expect(getByTestId("selector-tipos-activity").className).toContain("min-h-11");
    expect(getByTestId("selector-tipos-mas").className).toContain("min-h-11");
  });
});
