import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { BarraNavegacion } from "./BarraNavegacion";

// Même mock que TypeNavLink.test.tsx : nécessaire dès que ce fichier importe TypeNavLink, qui passe
// par le Link localisé de `@/i18n/navigation`.
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

describe("BarraNavegacion", () => {
  it("rend deux <nav> distincts, avec des aria-label différents", () => {
    const { container } = render(
      <BarraNavegacion
        migas={[{ nombre: "Inicio", href: "/" }, { nombre: "Alojamientos" }]}
        migasEtiqueta="Ruta de navegación"
        locale="es"
        tipos={TIPOS}
        tipoActivo="lodging"
        tiposEtiqueta="Tipos de oferta"
      />
    );
    const navs = Array.from(container.querySelectorAll("nav"));
    expect(navs).toHaveLength(2);
    expect(new Set(navs.map((n) => n.getAttribute("aria-label")))).toEqual(
      new Set(["Ruta de navegación", "Tipos de oferta"])
    );
  });

  // ⚠️ LE test de ce fichier : protège apps/web/e2e/categorias.spec.ts et listados.spec.ts, qui
  // ciblent [data-testid="migas"] et comptent un nombre EXACT de a[href] à l'intérieur. Si les
  // onglets de type finissaient dans ce même repère, ces specs e2e déjà en place casseraient.
  //
  // ⚠️ Les libellés du fil ("Buceo") sont volontairement différents des 5 types (TIPOS) : réutiliser
  // "Actividades" comme nom de miette ET comme libellé d'onglet ferait échouer la vérification
  // ci-dessous par coïncidence de texte, pas par un vrai défaut du composant.
  it("le testid migas ne contient QUE ce que Migas seul produirait, jamais les onglets", () => {
    const { container } = render(
      <BarraNavegacion
        migas={[{ nombre: "Inicio", href: "/" }, { nombre: "Buceo", href: "/actividades/buceo" }, { nombre: "Kayak" }]}
        migasEtiqueta="Ruta de navegación"
        locale="es"
        tipos={TIPOS}
        tipoActivo="activity"
        tiposEtiqueta="Tipos de oferta"
      />
    );
    const migas = container.querySelector('[data-testid="migas"]') as HTMLElement;
    expect(migas).not.toBeNull();
    // 3 items, le dernier sans href (page courante) : exactement 2 <a href> attendus, comme Migas
    // seul en rendrait pour la même liste.
    expect(migas.querySelectorAll("a[href]")).toHaveLength(2);
    // Aucun des 5 onglets de type n'est un descendant du repère du fil.
    for (const { label } of TIPOS) {
      expect(Array.from(migas.querySelectorAll("a")).some((a) => a.textContent === label)).toBe(false);
    }
  });

  it("rend les 5 onglets dans l'ordre reçu, un seul actif", () => {
    const { container } = render(
      <BarraNavegacion
        migas={[{ nombre: "Inicio" }]}
        migasEtiqueta="Ruta de navegación"
        locale="es"
        tipos={TIPOS}
        tipoActivo="camp"
        tiposEtiqueta="Tipos de oferta"
      />
    );
    const selector = container.querySelector('[data-testid="selector-tipos"]') as HTMLElement;
    const liens = Array.from(selector.querySelectorAll("a"));
    expect(liens.map((a) => a.textContent)).toEqual([
      "Actividades",
      "Alojamientos",
      "Transportes",
      "Camps",
      "Eventos",
    ]);
    const actifs = selector.querySelectorAll('[aria-current="page"]');
    expect(actifs).toHaveLength(1);
    expect(actifs[0].textContent).toBe("Camps");
  });

  it("aucun onglet actif quand tipoActivo est absent (cas de la home)", () => {
    const { container } = render(
      <BarraNavegacion
        migas={[{ nombre: "Inicio" }]}
        migasEtiqueta="Ruta de navegación"
        locale="es"
        tipos={TIPOS}
        tiposEtiqueta="Tipos de oferta"
      />
    );
    // ⚠️ Scopé au sélecteur de type, PAS à tout le container : le <nav data-testid="migas"> porte
    // lui-même un aria-current="page" sur son unique miette ("Inicio") — comportement de HeroUI
    // Breadcrumbs, déjà documenté et testé dans Migas.test.tsx, indépendant de tipoActivo.
    const selector = container.querySelector('[data-testid="selector-tipos"]') as HTMLElement;
    expect(selector.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });
});
