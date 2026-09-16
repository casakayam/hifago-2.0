import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EventoReservationForm } from "./EventoReservationForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Même patron que ReservationForm.test.tsx : navigation et panier neutralisés, seule la réaction
// du calendrier/des badges aux props (capacityMode/occurrences) est le sujet.
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const addLine = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine }) }));

// HORLOGE FIGÉE (même raison que ReservationForm.test.tsx) : le calendrier masque le passé via
// `disabled={{ before: startOfTodayInBogota() }}`.
const TODAY = new Date(2026, 5, 1, 12);
const OCCURRENCE_A = "2026-06-10";
const OCCURRENCE_B = "2026-06-17";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  addLine.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

type Occurrence = {
  date: string;
  capacity: number | null;
  booked: number | null;
  registeredQty: number | null;
};

function renderForm(
  capacityMode: "unlimited" | "metered" | "rsvp",
  occurrences: Occurrence[],
  minQty?: number
) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <EventoReservationForm
        productId="p1"
        // Le repli de `products.max_qty` posé par la couche catalogue — la vraie valeur, jamais une
        // constante propre au formulaire.
        maxQty={20}
        capacityMode={capacityMode}
        occurrences={occurrences}
        minQty={minQty}
      />
    </NextIntlClientProvider>
  );
}

// Retour Gabriel (2026-09-15) : l'evento doit afficher un calendrier, comme les trois autres
// formulaires de réservation — pas une liste de cartes (première version rejetée).
describe("EventoReservationForm — calendrier, jamais une liste de cartes", () => {
  it("seules les dates d'occurrence sont cliquables, jamais les autres jours du mois", () => {
    renderForm("unlimited", [
      { date: OCCURRENCE_A, capacity: null, booked: null, registeredQty: null },
      { date: OCCURRENCE_B, capacity: null, booked: null, registeredQty: null },
    ]);

    expect(document.querySelector('[data-date="2026-06-10"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-17"]')?.hasAttribute("disabled")).toBe(false);
    // Un jour du mois qui n'est PAS une occurrence reste désactivé.
    expect(document.querySelector('[data-date="2026-06-11"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("aucune liste de cartes d'édition n'est rendue (composant camp, jamais réutilisé tel quel)", () => {
    renderForm("unlimited", [{ date: OCCURRENCE_A, capacity: null, booked: null, registeredQty: null }]);

    expect(screen.queryByTestId("evento-occurrence-cards")).toBeNull();
    expect(screen.queryByTestId("edition-cards")).toBeNull();
  });
});

describe("EventoReservationForm — capacityMode 'unlimited' (aucun compteur, jamais désactivé)", () => {
  it("ajoute au panier sans afficher de badge de places", () => {
    renderForm("unlimited", [{ date: OCCURRENCE_A, capacity: null, booked: null, registeredQty: null }]);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);

    expect(screen.queryByTestId("evento-rsvp-count")).toBeNull();
    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: OCCURRENCE_A, qty: 1 });
  });
});

describe("EventoReservationForm — capacityMode 'metered' (cupo dur, décompte réel)", () => {
  it("un jour complet reste sélectionné dans le mois mais le bouton d'ajout se désactive", () => {
    renderForm("metered", [
      { date: OCCURRENCE_A, capacity: 5, booked: 5, registeredQty: null },
      { date: OCCURRENCE_B, capacity: 5, booked: 2, registeredQty: null },
    ]);

    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);
    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(true);

    fireEvent.click(document.querySelector('[data-date="2026-06-17"]')!);
    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);
  });
});

describe("EventoReservationForm — capacityMode 'rsvp' (aforo informatif, jamais bloquant)", () => {
  it("affiche le compteur inscrits/aforo mais reste réservable au-delà du plafond", () => {
    // registeredQty (20) dépasse capacity (15) : décision actée, jamais désactivé (aforo informatif).
    renderForm("rsvp", [{ date: OCCURRENCE_A, capacity: 15, booked: null, registeredQty: 20 }]);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);

    expect(screen.getByTestId("evento-rsvp-count").textContent).toBe("20/15 inscritos");
    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);
  });
});
