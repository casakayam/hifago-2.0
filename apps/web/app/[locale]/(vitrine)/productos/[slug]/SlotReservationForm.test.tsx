import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SlotReservationForm } from "./SlotReservationForm";
import { guardarUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Même patron que ReservationForm.test.tsx : navigation et panier neutralisés.
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// HORLOGE FIGÉE (même raison que les trois autres formulaires) : le calendrier masque le passé
// via `disabled={{ before: startOfTodayInBogota() }}`.
const TODAY = new Date(2026, 5, 1, 12);
const DAY_OPEN = "2026-06-10";
const DAY_FULL = "2026-06-11";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderForm() {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <SlotReservationForm
        productId="p1"
        slots={[
          { slot_date: DAY_OPEN, slot_start_time: "09:00:00", capacity: 2, booked: 0, slot_duration_minutes: 60 },
          { slot_date: DAY_FULL, slot_start_time: "09:00:00", capacity: 2, booked: 2, slot_duration_minutes: 60 },
        ]}
      />
    </NextIntlClientProvider>
  );
}

// Spec 28 §4 point 3 : « le calendrier de la fiche se pré-remplit depuis la mémoire du
// navigateur » — jamais câblé avant ce lot. Ce fichier couvre CE seul comportement (aucun fichier
// de test n'existait pour ce composant avant ce lot).
describe("SlotReservationForm — pré-remplissage depuis la recherche (spec 28 §4 point 3)", () => {
  it("sélectionne la date mémorisée et affiche ses créneaux, sans aucun clic", () => {
    guardarUltimosCriterios(`?desde=${DAY_OPEN}&hasta=${DAY_OPEN}`);
    renderForm();

    expect(screen.getByTestId(`slot-chip-${DAY_OPEN}-09:00`)).toBeTruthy();
  });

  it("ignore une date mémorisée dont la journée est complète", () => {
    guardarUltimosCriterios(`?desde=${DAY_FULL}&hasta=${DAY_FULL}`);
    renderForm();

    expect(screen.queryByTestId(`slot-chip-${DAY_FULL}-09:00`)).toBeNull();
  });
});
