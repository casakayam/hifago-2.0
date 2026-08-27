import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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
function renderView(overrides: { capacity: number | null; unitCount: number | null }) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <ProductDetailView
        name="GLAMPING"
        description={null}
        photoSlides={[]}
        priceDisplay="$ 120.000"
        unit={null}
        capacity={overrides.capacity}
        unitCount={overrides.unitCount}
        reservationMode="lodging"
        occurrenceLabel={null}
        externalBookingUrl={null}
        productId="p1"
        establishmentName="Casa Kayam"
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
