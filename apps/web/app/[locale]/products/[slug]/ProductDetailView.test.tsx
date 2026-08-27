import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { LodgingKind } from "@hifago/domain";
import { ProductDetailView } from "./ProductDetailView";
import messages from "@/messages/es.json";

// Même mock de navigation que CatalogBrowser.test.tsx (cf. son commentaire) : `@/i18n/navigation`
// tire next-intl/navigation → next/navigation, dont la résolution casse sous Vitest. Le lien de
// retour au catalogue n'est pas le sujet ici.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Les formulaires de réservation ont leurs propres dépendances (calendrier, panier, appels
// LobbyPMS côté client) et ne sont pas le sujet : ce fichier ne teste QUE la ligne de faits
// capacité/quantité ajoutée le 2026-08-26. Les neutraliser garde le test rapide et non fragile.
vi.mock("./ReservationForm", () => ({ ReservationForm: () => null }));
vi.mock("./HotelReservationForm", () => ({ HotelReservationForm: () => null }));
vi.mock("./LodgingReservationForm", () => ({ LodgingReservationForm: () => null }));
vi.mock("./SlotReservationForm", () => ({ SlotReservationForm: () => null }));
vi.mock("./ProductPhotos", () => ({ ProductPhotos: () => null }));

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
function renderView(overrides: {
  capacity: number | null;
  unitCount: number | null;
  lodgingKind?: LodgingKind | null;
  unit?: string | null;
}) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <ProductDetailView
        name="GLAMPING"
        description={null}
        photoSlides={[]}
        priceDisplay="$ 120.000"
        unit={overrides.unit ?? null}
        capacity={overrides.capacity}
        unitCount={overrides.unitCount}
        lodgingKind={overrides.lodgingKind ?? null}
        reservationMode="lodging"
        occurrenceLabel={null}
        externalBookingUrl={null}
        productId="p1"
        establishmentName="Casa Kayam"
        establishmentSlug="casa-kayam"
        establishmentDescription={null}
        establishmentAddress={null}
        establishmentPhotoSlides={[]}
        roomTypes={[]}
        roomAvailability={[]}
        roomRates={[]}
        priceCop={120000}
        lodgingPriceTiers={null}
        lodgingMaxQty={1}
        isPmsBacked
        availability={[]}
        productDateRates={[]}
        productSlots={[]}
      />
    </NextIntlClientProvider>
  );
}

describe("ProductDetailView — capacité et nombre d'unités (2026-08-26)", () => {
  it("affiche les deux quand LobbyPMS les a fournis", () => {
    renderView({ capacity: 2, unitCount: 3 });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("2 personas");
    expect(facts).toContain("3");
  });

  // Le libellé compte autant que la valeur : `quantity` est le parc TOTAL du type, pas ce qui
  // reste libre cette nuit (pour un logement PMS-backed, cette réponse vient de Lobby en direct).
  // Annoncer « disponibles » serait un mensonge au client, d'où cette garde explicite.
  it("dit « en total », jamais « disponibles »", () => {
    renderView({ capacity: 2, unitCount: 3 });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("en total");
    expect(facts).not.toContain("disponible");
  });

  it("affiche la moitié présente sans séparateur orphelin", () => {
    renderView({ capacity: 2, unitCount: null });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("2 personas");
    expect(facts).not.toContain("·");
  });

  // Cas majoritaire du catalogue : la ligne entière disparaît, jamais un bloc vide.
  it("ne rend rien quand le produit n'a ni capacité ni quantité", () => {
    renderView({ capacity: null, unitCount: null });
    expect(screen.queryByTestId("product-lodging-facts")).toBeNull();
  });

  it("accorde le singulier", () => {
    renderView({ capacity: 1, unitCount: 8 });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("1 persona");
    expect(facts).not.toContain("1 personas");
  });
});

// products.lodging_kind (2026-08-27). C'est l'information la plus structurante d'une fiche
// d'hébergement — « on y dort seul ou à huit ? » — et elle arrivait jusqu'ici depuis LobbyPMS pour
// être jetée au moment de lier.
describe("ProductDetailView — nature du couchage", () => {
  it("nomme le dortoir avant la capacité", () => {
    renderView({ capacity: 1, unitCount: 8, lodgingKind: "dorm" });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts.startsWith("Cama en dormitorio")).toBe(true);
    expect(facts).toContain("8 en total");
  });

  it("nomme la chambre privée", () => {
    renderView({ capacity: 2, unitCount: 3, lodgingKind: "private" });
    expect(screen.getByTestId("product-lodging-facts").textContent).toContain("Habitación privada");
  });

  // La valeur que LobbyPMS ne peut pas fournir : elle n'arrive que d'un choix manuel du partenaire,
  // et c'est justement le cas réel de la v1 en production (Bania Travel).
  it("nomme la maison entière", () => {
    renderView({ capacity: 8, unitCount: 1, lodgingKind: "whole_house" });
    expect(screen.getByTestId("product-lodging-facts").textContent).toContain("Casa entera");
  });

  // Une chambre peut n'avoir que ça : la ligne doit apparaître pour elle seule, sans séparateur.
  it("s'affiche seule quand ni capacité ni quantité ne sont connues", () => {
    renderView({ capacity: null, unitCount: null, lodgingKind: "private" });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toBe("Habitación privada");
  });
});

// `unit` est une unité de PRIX, distincte de lodging_kind. `per_house` a été ajouté à la contrainte
// le 2026-08-27 (la v1 l'a depuis toujours) ; rien ne l'écrit encore côté application, mais la
// fiche doit savoir l'afficher le jour où quelque chose le fera — sinon un prix de maison entière
// se lirait comme un prix par personne.
describe("ProductDetailView — unité de prix", () => {
  it("dit « por persona » pour per_person", () => {
    renderView({ capacity: null, unitCount: null, unit: "per_person" });
    expect(screen.getByTestId("product-price").textContent).toContain("por persona");
  });

  it("dit « por la casa entera » pour per_house", () => {
    renderView({ capacity: null, unitCount: null, unit: "per_house" });
    expect(screen.getByTestId("product-price").textContent).toContain("por la casa entera");
  });

  // per_two reste délibérément sans suffixe : le prix d'une chambre double n'a rien à préciser.
  it("n'ajoute aucun suffixe pour per_two", () => {
    renderView({ capacity: null, unitCount: null, unit: "per_two" });
    expect(screen.getByTestId("product-price").textContent).toBe("$ 120.000");
  });
});
