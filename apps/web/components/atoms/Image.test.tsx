import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Image } from "./Image";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions DOM
// natives uniquement.
//
// Ce que ces tests protègent vraiment, c'est le contrat d'accessibilité et de performance qui
// justifie l'existence de l'atome : `alt` et `sizes` traversent bien jusqu'au <img>, et un produit
// sans photo rend un substitut plutôt qu'un trou (ou pire, une balise <img> sans source).

// ⚠️ Source MATRICIELLE, pas le `/globe.svg` des stories, et c'est le point du test suivant :
// next/image reconnaît un SVG comme non optimisable et supprime alors `sizes` ET `srcset` de la
// balise rendue. Tester le contrat `sizes` sur un SVG l'aurait donc validé à vide.
const SRC = "/photo-produit.jpg";
const SIZES = "(max-width: 640px) 100vw, 50vw";

function rendre(props: Partial<React.ComponentProps<typeof Image>> = {}) {
  const { container } = render(<Image src={SRC} alt="Vue du embalse" sizes={SIZES} {...props} />);
  return container;
}

describe("Image", () => {
  it("rend une <img> avec son alt et son sizes quand la source existe", () => {
    const img = rendre().querySelector("img");
    if (!img) throw new Error("aucune <img> rendue");
    expect(img.getAttribute("alt")).toBe("Vue du embalse");
    expect(img.getAttribute("sizes")).toBe(SIZES);
    // `sizes` n'a de valeur que s'il pilote vraiment un jeu de sources : sans srcset, il ne sert
    // à rien et la raison d'être de l'atome tombe.
    expect(img.getAttribute("srcset")).toContain("w=640");
  });

  it("⚠️ constat : next/image ignore sizes et srcset pour un SVG (source non optimisable)", () => {
    // Non corrigé, à connaître : rendre `sizes` obligatoire par le type ne fait respecter la règle
    // que pour les images matricielles. Sur un SVG la prop est acceptée puis jetée en silence —
    // sans conséquence de bande passante (le vectoriel n'a pas de variantes de taille), mais toute
    // vérification faite sur un SVG mesurerait le vide.
    const img = rendre({ src: "/globe.svg" }).querySelector("img");
    expect(img?.getAttribute("sizes")).toBeNull();
    expect(img?.getAttribute("srcset")).toBeNull();
  });

  it("rend le substitut et AUCUNE balise <img> quand src vaut null", () => {
    const container = rendre({ src: null, testId: "photo" });
    expect(container.querySelector("img")).toBeNull();

    const substitut = container.querySelector('[data-testid="photo-placeholder"]');
    expect(substitut).not.toBeNull();
    // Le substitut n'annonce rien à un lecteur d'écran : il n'y a pas d'image à décrire.
    expect(substitut?.getAttribute("aria-hidden")).toBe("true");
  });

  it("garde le même ratio avec et sans visuel — la carte qui l'accueille ne s'effondre pas", () => {
    const avec = rendre({ ratio: "16/9" }).firstElementChild?.getAttribute("class");
    const sans = rendre({ ratio: "16/9", src: null }).firstElementChild?.getAttribute("class");
    expect(avec).toBe(sans);
  });

  it("applique le ratio 4/3 par défaut, et un ratio différent quand on le demande", () => {
    const defaut = rendre().firstElementChild?.getAttribute("class");
    const explicite = rendre({ ratio: "4/3" }).firstElementChild?.getAttribute("class");
    const carre = rendre({ ratio: "1/1" }).firstElementChild?.getAttribute("class");

    expect(defaut).toBe(explicite);
    expect(carre).not.toBe(defaut);
  });

  it("ne fixe aucune largeur en dur : le conteneur prend celle de son parent", () => {
    const classes = (rendre().firstElementChild?.getAttribute("class") ?? "").split(" ");
    // Une largeur en dur (`w-64`, `max-w-*`) réintroduirait le débordement horizontal que le
    // README interdit ; seul `w-full` est attendu ici.
    expect(classes.filter((c) => c.startsWith("w-") || c.startsWith("max-w-"))).toEqual(["w-full"]);
  });

  it("expose testId en data-testid sur le conteneur, et rien quand il est absent", () => {
    expect(rendre({ testId: "photo" }).firstElementChild?.getAttribute("data-testid")).toBe("photo");
    expect(rendre().firstElementChild?.hasAttribute("data-testid")).toBe(false);
  });
});
