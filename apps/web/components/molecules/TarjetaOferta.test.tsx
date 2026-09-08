import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { formatCop } from "@hifago/domain";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { TarjetaOferta } from "./TarjetaOferta";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions DOM
// natives uniquement.
//
// Ce que ces tests protègent : les trois décisions qui justifient l'existence de la molécule
// (en-tête du composant) et qui ne se voient PAS à l'œil sur un rendu correct —
//   • le texte alternatif calculé « <nom>, foto i de n », avec le bon rang et le bon total ;
//   • les quatre formes du prix, dont deux qui doivent NE RIEN rendre ou ne rien formater ;
//   • la priorité de chargement, qui ne laisse aucune trace visible.

// Même mock que Card.test.tsx : `@/i18n/navigation` tire next-intl/navigation → next/navigation,
// dont la résolution casse sous Vitest. `data-localized` prouve que le lien de la carte est bien le
// Link localisé et pas un `<a>` nu — sans quoi le préfixe de locale serait perdu.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

// ⚠️ Messages FOURNIS ICI, pas chargés depuis messages/es/HomePage.json : les clés `fotoAlt` et
// `precioDesde` sont écrites par le lot i18n de l'accueil, en parallèle de celui-ci. Un test qui
// dépendrait du fichier échouerait selon l'ordre des lots — et surtout il ne dirait plus quelle
// FORME de message le composant attend. Ici le format ICU est sous les yeux, à côté des assertions.
const MESSAGES = {
  HomePage: {
    fotoAlt: "{nombre}, foto {indice} de {total}",
    precioDesde: "Desde",
  },
};

// ⚠️ Trois API de navigateur qu'Embla (le Carousel de PhotoStrip) appelle au MONTAGE et que jsdom
// n'implémente pas — sans ces bouchons, tout rendu lève depuis un effet passif. Repris tels quels
// de PhotoStrip.test.tsx, y compris la raison de les poser ici plutôt que dans une configuration
// partagée : `vitest.config.ts` est commun à tous les agents.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

window.IntersectionObserver ??= ObservateurInerte as unknown as typeof window.IntersectionObserver;
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

const NOMBRE = "Cabaña entera sobre el embalse";

// ⚠️ Une URL de photo DISTINCTE par test : `ReactDOM.preload` écrit dans le `<head>` du document,
// dédoublonne par URL, et rien ne nettoie le `<head>` entre deux tests. Sources MATRICIELLES,
// jamais des SVG : next/image jette `sizes` et `srcset` d'une source non optimisable, et la moitié
// des assertions mesurerait le vide (cf. Image.test.tsx).
function fotos(prefixe: string, nombre: number) {
  return Array.from({ length: nombre }, (_, i) => ({ url: `/${prefixe}-${i}.jpg` }));
}

function oferta(patch: Partial<OfertaTarjeta> = {}): OfertaTarjeta {
  return {
    clave: "producto-1",
    href: "/productos/cabana-embalse",
    nombre: NOMBRE,
    establecimiento: "Casa Kayam Guatapé",
    precio: { tipo: "monto", cop: 180000 },
    fotos: fotos("defaut", 1),
    tipo: "lodging",
    testId: "tarjeta-cabana-embalse",
    ...patch,
  };
}

function rendre(
  patch: Partial<OfertaTarjeta> = {},
  opciones: { variante?: "grilla" | "lista"; prioridad?: boolean } = {}
) {
  const datos = oferta(patch);
  const { container } = render(
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <TarjetaOferta
        oferta={datos}
        variante={opciones.variante ?? "grilla"}
        prioridad={opciones.prioridad}
        locale="es"
      />
    </NextIntlClientProvider>
  );
  return {
    datos,
    carte: container.querySelector(`[data-testid="${datos.testId}"]`) as HTMLElement,
    precio: container.querySelector(`[data-testid="${datos.testId}-precio"]`),
    images: Array.from(container.querySelectorAll("img")),
    container,
  };
}

describe("TarjetaOferta", () => {
  it("rend le nom en h3, l'établissement, le prix formaté, et un lien vers l'offre", () => {
    const { carte, precio, datos } = rendre();

    // `titleAs="h3"` : le titre de la carte vit sous le `<h2>` d'une section (spec 28 §5), et un
    // niveau deviné produirait un saut de hiérarchie sur un écran qui porte cinq sections.
    expect(carte.querySelector("h3")?.textContent).toBe(NOMBRE);
    expect(carte.querySelector("p")?.textContent).toBe("Casa Kayam Guatapé");

    const lien = carte.querySelector(`[data-testid="${datos.testId}-link"]`) as HTMLElement;
    expect(lien.getAttribute("href")).toBe("/productos/cabana-embalse");
    // Le lien passe par `@/i18n/navigation`, jamais un `<a href>` nu — sinon le préfixe de locale
    // est perdu et un hispanophone atterrit sur la version anglaise.
    expect(lien.getAttribute("data-localized")).toBe("true");

    expect(precio?.textContent).toBe(formatCop(180000, "es"));
    // Le montant est bien FORMATÉ, pas recopié : « 180.000 » et non « 180000 ».
    expect(precio?.textContent).toContain("180.000");
  });

  it("sans établissement : aucun sous-titre, et rien qui laisse sa place vide", () => {
    const { carte } = rendre({ establecimiento: null });
    expect(carte.querySelector("p")).toBeNull();
    expect(carte.textContent).toContain(NOMBRE);
  });

  it("sans prix : aucun bloc de prix, et AUCUN conteneur de contenu vide", () => {
    // ⚠️ La deuxième moitié compte autant que la première : `Card` n'ouvre son `Card.Content` que
    // si des enfants lui parviennent. Passer un `<span>` vide aurait laissé un écart sous le titre
    // sur toutes les offres sans prix — un défaut visuel, donc invisible à un test qui ne
    // regarderait que le testId du prix. Cas limite « Offre sans prix chiffré » de la spec 28 §0.
    const { carte, precio } = rendre({ precio: null, fotos: fotos("sin-precio", 1) });
    expect(precio).toBeNull();
    expect(carte.querySelector("[data-slot='card-content']")).toBeNull();
  });

  it('prix "desde" : le libellé traduit ET le montant, dans un seul élément', () => {
    const { precio } = rendre({
      precio: { tipo: "desde", cop: 95000 },
      fotos: fotos("desde", 1),
    });
    // Un seul nœud porte les deux : un lecteur d'écran lit « Desde 95.000 COP » d'une traite, et
    // l'espace entre les deux est bien rendu (un retour à la ligne JSX l'aurait mangé).
    expect(precio?.textContent).toBe(`Desde ${formatCop(95000, "es")}`);
  });

  it('⚠️ prix "texto" : rendu tel quel, JAMAIS formaté en COP', () => {
    // Règle métier : un evento porte un `price_label` en texte libre (cahier admin §3c). Le passer
    // à `formatCop` rendrait « 0 COP » — un prix faux affiché avec l'aplomb d'un prix juste.
    const { precio } = rendre({
      precio: { tipo: "texto", label: "Entrada libre" },
      tipo: "evento",
      fotos: fotos("texto", 1),
    });
    expect(precio?.textContent).toBe("Entrada libre");
    expect(precio?.textContent).not.toContain("COP");
  });

  it("calcule l'alt de chaque photo : « <nom>, foto i de n »", () => {
    // ⚠️ Le rang ET le total sont vérifiés sur trois photos : un alt qui répéterait « foto 1 de 1 »
    // partout serait indiscernable du bon à l'œil, et c'est le seul texte que reçoit un utilisateur
    // de lecteur d'écran sur un carrousel. Calculé ici et pas dans `lib/catalog/` (spec 28 §6).
    const { images } = rendre({ fotos: fotos("alt", 3) });
    expect(images.map((img) => img.getAttribute("alt"))).toEqual([
      `${NOMBRE}, foto 1 de 3`,
      `${NOMBRE}, foto 2 de 3`,
      `${NOMBRE}, foto 3 de 3`,
    ]);
  });

  it("offre sans photo : le substitut de PhotoStrip, aucune balise <img>", () => {
    // Cas limite de la spec 28 §0 : la carte garde sa forme au lieu de se tasser.
    const { carte, images, datos } = rendre({ fotos: [] });
    expect(images.length).toBe(0);
    const substitut = carte.querySelector(
      `[data-testid="${datos.testId}-fotos-photo-0-placeholder"]`
    );
    expect(substitut).not.toBeNull();
    expect(substitut?.getAttribute("aria-hidden")).toBe("true");
  });

  it("⚠️ prioridad : la première photo perd son loading=lazy — sans prioridad, elle le garde", () => {
    // Invariant 6 de la spec 28 §0 : `priority` sur la première carte de la première section (le
    // LCP), `lazy` partout ailleurs. Mesuré sur Next 16.3.0 (cf. Image.test.tsx) : `priority` ne
    // pose RIEN sur la balise, il RETIRE `loading="lazy"` — c'est donc son absence qui le prouve.
    const prioritaire = rendre({ fotos: fotos("lcp", 2) }, { prioridad: true });
    expect(prioritaire.images[0].hasAttribute("loading")).toBe(false);
    // ⚠️ La deuxième reste lazy même sur la carte prioritaire : Embla monte TOUS les slides, et
    // tout précharger annulerait le bénéfice recherché.
    expect(prioritaire.images[1].getAttribute("loading")).toBe("lazy");

    const ordinaire = rendre({ fotos: fotos("hors-lcp", 2) });
    expect(ordinaire.images.map((img) => img.getAttribute("loading"))).toEqual(["lazy", "lazy"]);
  });

  it("le sizes et la mise en page suivent la variante", () => {
    // `sizes` est la seule chose que la carte sait et que `PhotoStrip` ne peut pas deviner. En
    // grille il suit les points de rupture de `SeccionOfertas` ; en liste il vaut la largeur exacte
    // de la vignette de `Card layout="row"`.
    const grille = rendre({ fotos: fotos("sizes-grilla", 1) });
    expect(grille.images[0].getAttribute("sizes")).toBe(
      "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
    );

    const liste = rendre({ fotos: fotos("sizes-lista", 1) }, { variante: "lista" });
    expect(liste.images[0].getAttribute("sizes")).toBe("64px");
    // `flex-row` est la classe que `Card` pose pour `layout="row"` : sans cette assertion, une
    // carte qui resterait en `stack` passerait tous les autres tests au vert.
    expect(liste.carte.className).toContain("flex-row");
  });
});
