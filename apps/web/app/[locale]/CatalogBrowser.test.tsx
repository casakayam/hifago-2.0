import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CatalogBrowser, type CatalogProduct } from "./CatalogBrowser";
import messages from "@/messages/es.json";

// `@/i18n/navigation`'s Link tire next-intl/navigation → next/navigation, dont la résolution
// casse sous Vitest (Next 16, interop ESM connu, sans rapport avec la logique testée ici). Ce
// test porte sur le filtre/l'état vide de CatalogBrowser, jamais sur la navigation elle-même —
// un simple <a> suffit.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Pas de @testing-library/jest-dom dans ce monorepo (cf. slot-rules-editor.test.tsx) — assertions
// sur des propriétés/queries DOM natives, jamais de matcher jest-dom.
function renderCatalog(products: CatalogProduct[]) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ HomePage: messages.HomePage }}>
      <CatalogBrowser products={products} />
    </NextIntlClientProvider>
  );
}

const PRODUCTS: CatalogProduct[] = [
  {
    id: "1",
    href: "/products/tour-lancha-guatape",
    testId: "catalog-link-tour-lancha-guatape",
    name: "Tour en lancha por el Embalse de Guatapé",
    descriptionSnippet: "Recorrido en lancha por el embalse.",
    type: "activity",
    subtitle: null,
    imageUrl: null,
  },
  {
    id: "2",
    href: "/products/alojamiento-demo",
    testId: "catalog-link-alojamiento-demo",
    name: "Alojamiento PMS-backed (demo)",
    descriptionSnippet: "Dormitorio de demostración.",
    type: "lodging",
    subtitle: null,
    imageUrl: null,
  },
  // Carte GROUPÉE (2026-08-27) : plusieurs logements d'un même établissement tiennent en une seule
  // carte, qui mène à la page établissement et non à une fiche produit. Sans elle, un hôtel à six
  // catégories occupait six cartes de la page d'accueil.
  {
    id: "establishment-abc",
    href: "/establishments/casa-kayam-guatape",
    testId: "catalog-link-establishment-casa-kayam-guatape",
    name: "Casa Kayam Guatapé",
    descriptionSnippet: "Hostal en la colina.",
    type: "lodging",
    subtitle: "6 alojamientos",
    imageUrl: null,
  },
];

describe("CatalogBrowser", () => {
  it("une carte groupée mène à la page établissement et annonce son décompte", () => {
    renderCatalog(PRODUCTS);
    const grouped = screen.getByTestId("catalog-link-establishment-casa-kayam-guatape");
    expect(grouped.getAttribute("href")).toContain("/establishments/casa-kayam-guatape");
    expect(grouped.textContent).toContain("6 alojamientos");
  });

  it("affiche toutes les cartes au départ, sans filtre actif", () => {
    renderCatalog(PRODUCTS);
    expect(screen.queryByTestId("catalog-link-tour-lancha-guatape")).not.toBeNull();
    expect(screen.queryByTestId("catalog-link-alojamiento-demo")).not.toBeNull();
    expect(screen.queryByTestId("catalog-no-results")).toBeNull();
  });

  it("filtre par texte sur le nom, insensible à la casse", () => {
    renderCatalog(PRODUCTS);
    const search = screen.getByTestId("catalog-search").querySelector("input");
    if (!search) throw new Error("champ de recherche introuvable");

    fireEvent.change(search, { target: { value: "LANCHA" } });

    expect(screen.queryByTestId("catalog-link-tour-lancha-guatape")).not.toBeNull();
    expect(screen.queryByTestId("catalog-link-alojamiento-demo")).toBeNull();
  });

  it("affiche l'état vide quand aucun produit ne correspond", () => {
    renderCatalog(PRODUCTS);
    const search = screen.getByTestId("catalog-search").querySelector("input");
    if (!search) throw new Error("champ de recherche introuvable");

    fireEvent.change(search, { target: { value: "inexistant-xyz" } });

    expect(screen.queryByTestId("catalog-no-results")).not.toBeNull();
    expect(screen.queryByTestId("catalog-link-tour-lancha-guatape")).toBeNull();
  });

  it("ne montre aucun produit quand le catalogue est vide", () => {
    renderCatalog([]);
    expect(screen.queryByTestId("catalog-no-results")).not.toBeNull();
  });
});
