import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ReservationForm } from "./ReservationForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Même patron que LodgingReservationForm.test.tsx : navigation et panier neutralisés, seule la
// réaction du calendrier aux props est le sujet.
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const addLine = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine }) }));

// HORLOGE FIGÉE (même raison que LodgingReservationForm.test.tsx) : le calendrier masque le passé
// via `disabled={{ before: startOfTodayInBogota() }}` — sans horloge fixe, les dates testées
// tomberaient hors du mois affiché ou dans le passé selon le jour d'exécution.
const TODAY = new Date(2026, 5, 1, 12);
const DEPARTURE = "2026-06-10";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  addLine.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderForm(durationDays?: number, minQty?: number) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <ReservationForm
        productId="p1"
        availability={[{ date: DEPARTURE, capacity: 5, booked: 0 }]}
        durationDays={durationDays}
        minQty={minQty}
      />
    </NextIntlClientProvider>
  );
}

// Couvre le correctif du 2026-09-13 : un camp (`duration_days` > 1) ne pose qu'UNE ligne
// `product_availability` par départ (jamais une par jour, cf. mockData/README.md) — sans ce
// correctif, seul le jour de départ était cliquable et le reste de la semaine semblait indisponible
// (retour Jérôme : « le calendrier du camp me montre la date du 1er octobre et pas la semaine
// entière »).
describe("ReservationForm — semaine d'un camp (durationDays > 1)", () => {
  it("laisse cliquer n'importe quel jour de la semaine du départ, jamais au-delà", () => {
    renderForm(3); // départ 10/06 + 2 jours = semaine 10-11-12

    expect(document.querySelector('[data-date="2026-06-10"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-11"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-12"]')?.hasAttribute("disabled")).toBe(false);
    // Le jour suivant la semaine du départ n'est PAS un jour bookable — durationDays ne doit pas
    // "déborder" sur le reste du calendrier.
    expect(document.querySelector('[data-date="2026-06-13"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("un clic sur un jour DE LA SEMAINE (pas le départ) sélectionne quand même le départ réel", () => {
    renderForm(3);

    // 11/06 n'existe dans aucune ligne product_availability (seul 10/06 en porte une) : avant le
    // correctif, ce jour restait "sans disponibilité trouvée" et le bouton d'ajout restait désactivé.
    fireEvent.click(document.querySelector('[data-date="2026-06-11"]')!);

    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: DEPARTURE, qty: 1 });
  });
});

describe("ReservationForm — durationDays absent (activité/transport, comportement inchangé)", () => {
  it("seul le jour effectivement en disponibilité reste cliquable", () => {
    renderForm(); // pas de camp : comportement d'avant le correctif

    expect(document.querySelector('[data-date="2026-06-10"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-11"]')?.hasAttribute("disabled")).toBe(true);
  });
});

// Retour Jérôme (2026-09-14, produit "Hiking Group", min_qty: 2) : le champ Cantidad partait
// toujours de 1, sans empêcher ni signaler une saisie sous le plancher — create_order refusait déjà
// silencieusement (qty_below_minimum, jamais traduit avant ce lot).
describe("ReservationForm — min_qty > 1 (Jérôme, 2026-09-14)", () => {
  it("la quantité part directement du plancher, jamais de 1", () => {
    renderForm(undefined, 2);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);

    expect((document.getElementById("qty") as HTMLInputElement).value).toBe("2");
  });

  it("l'ajout au panier envoie le plancher, jamais 1", () => {
    renderForm(undefined, 2);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));

    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: DEPARTURE, qty: 2 });
  });

  it("affiche l'indication du minimum, absente quand min_qty vaut 1", () => {
    renderForm(undefined, 2);
    expect(screen.getByTestId("min-qty-hint").textContent).toBe("Cantidad mínima: 2");
  });

  it("aucune indication de minimum quand min_qty est absent/1", () => {
    renderForm();
    expect(screen.queryByTestId("min-qty-hint")).toBeNull();
  });
});
