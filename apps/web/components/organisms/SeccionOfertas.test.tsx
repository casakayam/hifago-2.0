import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { SeccionOfertas } from "./SeccionOfertas";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

// ⚠️ La carte est REMPLACÉE par une doublure, et c'est le point de ce fichier : on teste la
// SECTION — le niveau du titre, le nombre de `<li>`, la mise en page, le lien « Ver más » et la
// propagation de `prioridad`. La vraie carte appelle `useTranslations` et monte un carrousel ;
// la garder ici ferait échouer ces tests pour des raisons qui n'ont rien à voir avec la section,
// et les rendrait dépendants d'un composant écrit par un autre agent. Même geste que
// `ProductDetailView.test.tsx`, qui neutralise ses quatre formulaires et sa galerie.
//
// La doublure REND ses props en attributs `data-*` : c'est la seule façon d'observer ce que la
// section transmet réellement, plutôt que de faire confiance au type.
vi.mock("@/components/molecules/TarjetaOferta", () => ({
  TarjetaOferta: ({
    oferta,
    variante,
    locale,
    prioridad,
  }: {
    oferta: OfertaTarjeta;
    variante: "grilla" | "lista";
    locale: string;
    prioridad?: boolean;
  }) => (
    <article
      data-testid={oferta.testId}
      data-variante={variante}
      data-locale={locale}
      data-prioridad={String(prioridad)}
    >
      {oferta.nombre}
    </article>
  ),
}));

function tarjeta(n: number): OfertaTarjeta {
  return {
    clave: `p-${n}`,
    href: `/productos/oferta-${n}`,
    nombre: `Oferta ${n}`,
    establecimiento: "Casa Kayam",
    precio: { tipo: "monto", cop: 80000 },
    fotos: [{ url: "/globe.svg" }],
    tipo: "activity",
    capacidad: null,
    nAlojamientos: null,
    testId: `tarjeta-${n}`,
  };
}

const TARJETAS = [tarjeta(1), tarjeta(2), tarjeta(3)];

type Sobrecarga = Partial<React.ComponentProps<typeof SeccionOfertas>>;

function rendu(sobrecarga: Sobrecarga = {}) {
  const { container } = render(
    <SeccionOfertas
      titulo="Actividades"
      hrefVerMas="/actividades?personas=2"
      labelVerMas="Ver todas las actividades"
      variante="grilla"
      tarjetas={TARJETAS}
      locale="es"
      testId="seccion"
      {...sobrecarga}
    />
  );
  return {
    container,
    seccion: container.querySelector("section") as HTMLElement,
    lista: container.querySelector("ul") as HTMLElement,
  };
}

describe("SeccionOfertas", () => {
  it("rend un <section> nommé, avec son titre en <h2>", () => {
    const { seccion } = rendu();
    expect(seccion).not.toBeNull();
    // Sans nom accessible, un <section> n'est pas un repère de navigation : c'est une div.
    expect(seccion.getAttribute("aria-label")).toBe("Actividades");
    const titre = seccion.querySelector("h2") as HTMLElement;
    expect(titre).not.toBeNull();
    expect(titre.textContent).toBe("Actividades");
    // Le niveau ne se devine pas : aucun autre niveau n'est posé par la section.
    expect(seccion.querySelector("h1")).toBeNull();
    expect(seccion.querySelector("h3")).toBeNull();
  });

  it("respecte le niveau demandé par la page plutôt qu'un niveau deviné", () => {
    const { seccion } = rendu({ tituloAs: "h2" });
    expect((seccion.querySelector("h2") as HTMLElement).textContent).toBe("Actividades");
  });

  it("rend exactement un <li> par carte, jamais un de plus", () => {
    const { lista } = rendu();
    const items = lista.querySelectorAll("li");
    expect(items.length).toBe(TARJETAS.length);
    for (const [index, t] of TARJETAS.entries()) {
      const carte = items[index].querySelector(`[data-testid="${t.testId}"]`) as HTMLElement;
      expect(carte).not.toBeNull();
      expect(carte.textContent).toBe(t.nombre);
    }
  });

  it("ne rend aucun <li> quand la section n'a pas de carte, sans planter", () => {
    const { lista, container } = rendu({ tarjetas: [] });
    expect(lista.querySelectorAll("li").length).toBe(0);
    // Le lien reste servi : c'est la page qui décide de ne pas rendre une section vide (spec §8),
    // pas le composant, qui n'a pas la vue d'ensemble pour ça.
    expect(container.querySelector('[data-testid="seccion-ver-mas"]')).not.toBeNull();
  });

  it("porte le href et le libellé reçus sur son lien « Ver más »", () => {
    const { container } = rendu();
    const lien = container.querySelector('[data-testid="seccion-ver-mas"]') as HTMLAnchorElement;
    expect(lien.tagName).toBe("A");
    expect(lien.getAttribute("href")).toBe("/actividades?personas=2");
    expect(lien.textContent).toBe("Ver todas las actividades");
    // ⚠️ Le lien passe par le `Link` de @/i18n/navigation (que la doublure marque) : lui seul
    // conserve le préfixe de langue. Un <a href="/actividades"> renverrait un anglophone sur une
    // page sans langue.
    expect(lien.getAttribute("data-localized")).toBe("true");
    // 44 px de cible tactile, et une zone cliquable qui s'arrête au texte.
    expect(lien.className).toContain("min-h-11");
  });

  it("accepte un libellé DIFFÉRENT pour les activités, dont le « Ver más » mène à un index de tags", () => {
    const { container } = rendu({
      hrefVerMas: "/actividades",
      labelVerMas: "Explorar por categoría",
    });
    const lien = container.querySelector('[data-testid="seccion-ver-mas"]') as HTMLAnchorElement;
    expect(lien.getAttribute("href")).toBe("/actividades");
    expect(lien.textContent).toBe("Explorar por categoría");
  });

  it("pose la grille responsive en variante « grilla » — 1 colonne, 2 à md, 3 à lg", () => {
    const { lista } = rendu({ variante: "grilla" });
    for (const classe of ["grid", "grid-cols-1", "md:grid-cols-2", "lg:grid-cols-3", "gap-4"]) {
      expect(lista.className).toContain(classe);
    }
    // Aucune largeur en dur : ce sont les colonnes qui s'ajoutent, jamais le conteneur qui se fige.
    expect(lista.className).not.toMatch(/\b(w|min-w|max-w)-\[/);
  });

  it("n'emploie AUCUNE classe de grille en variante « lista »", () => {
    const { lista } = rendu({ variante: "lista" });
    expect(lista.className).not.toContain("grid");
    expect(lista.className).toContain("flex");
    expect(lista.className).toContain("flex-col");
  });

  it("transmet la variante et la locale à chacune de ses cartes", () => {
    const { container } = rendu({ variante: "lista", locale: "en" });
    const cartes = container.querySelectorAll("article");
    expect(cartes.length).toBe(TARJETAS.length);
    for (const carte of cartes) {
      expect(carte.getAttribute("data-variante")).toBe("lista");
      expect(carte.getAttribute("data-locale")).toBe("en");
    }
  });

  // ⚠️ LE test du fichier. Une seule image de toute la page est le LCP : la première carte de la
  // première section. `prioridad` propagé à tout le monde poserait huit préchargements sur la
  // première section, dont sept sous la ligne de flottaison — la régression Core Web Vitals que
  // la prop `loading` de PhotoStrip existe précisément pour empêcher.
  it("ne rend prioritaire QUE la première carte d'une section prioritaire", () => {
    const { container } = rendu({ prioridad: true });
    const cartes = [...container.querySelectorAll("article")];
    expect(cartes.map((c) => c.getAttribute("data-prioridad"))).toEqual(["true", "false", "false"]);
  });

  it("ne rend AUCUNE carte prioritaire dans une section qui ne l'est pas", () => {
    const { container } = rendu();
    const cartes = [...container.querySelectorAll("article")];
    expect(cartes.map((c) => c.getAttribute("data-prioridad"))).toEqual(["false", "false", "false"]);
    // Absence de la prop ≠ prioritaire : le défaut est le cas le plus fréquent (4 sections sur 5).
    const { container: explicite } = rendu({ prioridad: false });
    expect(
      [...explicite.querySelectorAll("article")].every(
        (c) => c.getAttribute("data-prioridad") === "false"
      )
    ).toBe(true);
  });

  it("omet ses data-testid quand la page ne lui en donne pas", () => {
    const { container, seccion } = rendu({ testId: undefined });
    expect(seccion.hasAttribute("data-testid")).toBe(false);
    // Jamais de "undefined-ver-mas" : un testId absent ne fabrique pas un identifiant bancal.
    const identifiants = [...container.querySelectorAll("[data-testid]")].map((n) =>
      n.getAttribute("data-testid")
    );
    // Les seuls restants viennent des CARTES, qui portent le leur dans leurs données (spec §0).
    expect(identifiants).toEqual(TARJETAS.map((t) => t.testId));
    expect(container.innerHTML).not.toContain("undefined");
  });

  it("livre ses cartes et son lien dans le HTML SERVI, pas à l'hydratation", () => {
    // La raison d'être de ce test : les cinq sections SONT le contenu indexable de l'accueil. Si
    // elles n'arrivaient qu'après hydratation, Google verrait une page vide sous la barre de
    // recherche, et le maillage vers les listings n'existerait pas.
    const html = renderToStaticMarkup(
      <SeccionOfertas
        titulo="Actividades"
        hrefVerMas="/actividades"
        labelVerMas="Ver todas"
        variante="grilla"
        tarjetas={TARJETAS}
        locale="es"
        testId="seccion"
      />
    );
    expect(html).toContain("<h2");
    expect(html).toContain("Oferta 1");
    expect(html).toContain("Oferta 3");
    expect(html).toContain('href="/actividades"');
  });

  // ⚠️ Une règle documentée que rien ne vérifie n'est pas une règle : c'est un souhait
  // (CLAUDE.md §11.20). Celle-ci est invisible au typecheck, au lint ET en dev — un `"use client"`
  // ajouté ici par distraction ferait descendre cinq sections de huit cartes dans le navigateur
  // sans qu'aucun outil ne s'en plaigne, et un import de `@hifago/ui` casserait `next build` à
  // « Collecting page data » (CLAUDE.md §11.16). D'où une lecture du TEXTE du fichier.
  it("reste un Server Component : ni « use client », ni le moindre import de @hifago/ui", () => {
    // ⚠️ `new URL("./x", import.meta.url)` NE MARCHE PAS ici : sous l'environnement jsdom, le
    // constructeur `URL` global est celui de jsdom, qui résout un chemin relatif contre le
    // `baseURI` du document (`http://localhost:3000/…`) au lieu de la base passée en argument.
    // `fileURLToPath` de node:url n'a pas ce défaut.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "SeccionOfertas.tsx"),
      "utf8"
    );
    const sansCommentaires = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sansCommentaires).not.toContain('"use client"');
    expect(sansCommentaires).not.toContain("@hifago/ui");
  });
});
