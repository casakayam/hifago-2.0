import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: React.ComponentProps<"a">) => <a href={href} {...p}>{children}</a>,
}));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// ---------------------------------------------------------------------------------------------
// min_stay ET lead_days, APPLIQUÉS — décision de Jérôme, 2026-08-29.
//
// ⚠️ Ces deux champs valent {0,0,0} sur les six catégories de Casa Kayam (mesuré le 2026-08-27,
// reconfirmé le 28). C'est EXACTEMENT pourquoi on les applique maintenant : l'effet visible est nul
// aujourd'hui, donc le moment est sûr. L'alternative était d'attendre qu'un socio pose un min_stay
// dans Lobby et de le découvrir par un 422 en production. Ces tests sont donc le seul endroit du
// dépôt où ces valeurs sont non nulles — ils décrivent un futur, pas un présent.
// ---------------------------------------------------------------------------------------------
const NUITS = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-12-${String(i + 1).padStart(2, "0")}`,
  capacity: 4,
  booked: 0,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Restriction = { minStay: number | null; maxStay: number | null; leadDays: number | null };

async function renderPms(restrictedNights: { date: string; restrictions: Restriction }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: async () => ({ ok: true, nights: NUITS, restrictedNights }) } as Response)
  );
  render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p" productName="GUSTO" establishmentName="Casa Kayam"
        priceCop={20000} priceTiers={null} maxQty={6} lodgingKind="dorm"
        isPmsBacked availability={[]} rates={[]}
      />
    </NextIntlClientProvider>
  );
  await waitFor(() => expect(document.querySelector('[data-date="2026-12-10"]')).not.toBeNull());
}

const jour = (iso: string) => document.querySelector(`[data-date="${iso}"]`) as HTMLButtonElement | null;
const cliquable = (iso: string) => jour(iso)?.disabled === false;
const avertissement = () => screen.queryByTestId("range-unavailable-warning");

describe("min_stay — la longueur minimale d'une plage sélectionnable", () => {
  it("min_stay = 2 : la sortie du lendemain n'est plus sélectionnable, la surlendemain l'est", async () => {
    await renderPms([{ date: "2026-12-10", restrictions: { minStay: 2, maxStay: null, leadDays: null } }]);

    expect(cliquable("2026-12-11")).toBe(true); // avant tout clic, le 11 est une arrivée valable
    fireEvent.click(jour("2026-12-10")!);

    // CHECK-OUT EXCLUSIF : deux nuits (10 et 11) se terminent le 12, jamais le 11.
    expect(cliquable("2026-12-11")).toBe(false);
    expect(cliquable("2026-12-12")).toBe(true);
    expect(avertissement()).toBeNull();
  });

  it("min_stay = 4 : trois nuits ne suffisent pas, quatre oui", async () => {
    await renderPms([{ date: "2026-12-10", restrictions: { minStay: 4, maxStay: null, leadDays: null } }]);
    fireEvent.click(jour("2026-12-10")!);

    for (const trop of ["2026-12-11", "2026-12-12", "2026-12-13"]) {
      expect(cliquable(trop)).toBe(false);
    }
    expect(cliquable("2026-12-14")).toBe(true);

    fireEvent.click(jour("2026-12-14")!);
    expect(avertissement()).toBeNull();
    expect(screen.getByText("4 noches")).toBeTruthy();
  });

  it("en ARRIÈRE, c'est le min_stay du CANDIDAT qui commande, pas celui de l'ancre", async () => {
    // L'ancre (le 20) exige 5 nuits. Un clic sur le 19 formerait [19, 20) : UNE nuit, avec une
    // arrivée le 19 — dont Lobby ne dit rien, donc le minimum structurel d'une nuit. Cette plage
    // est valide.
    //
    // C'EST L'ASSERTION QUI DISCRIMINE : si on appliquait le min_stay de l'ANCRE en arrière, il
    // faudrait remonter jusqu'au 15 et le 19 serait barré. Le `min_stay` appartient à l'arrivée,
    // et en arrière l'arrivée est le candidat, jamais l'ancre.
    await renderPms([
      { date: "2026-12-20", restrictions: { minStay: 5, maxStay: null, leadDays: null } },
    ]);
    fireEvent.click(jour("2026-12-20")!);

    expect(cliquable("2026-12-19")).toBe(true);  // 1 nuit, min_stay du 19 (aucun) → tient
    expect(cliquable("2026-12-25")).toBe(true);  // en avant : 5 nuits depuis l'ancre
    expect(cliquable("2026-12-24")).toBe(false); // 4 nuits : sous le min_stay de l'ancre
    expect(avertissement()).toBeNull();
  });

  it("une nuit dont Lobby ne dit RIEN garde le minimum structurel d'une nuit", async () => {
    // ⚠️ PIÈGE 1 : `null` n'est pas 0, et n'est pas non plus une contrainte. Le champ illisible
    // reste `null` côté relevé ; ici il retombe sur « une nuit », le minimum d'un séjour.
    await renderPms([{ date: "2026-12-10", restrictions: { minStay: null, maxStay: null, leadDays: 2 } }]);
    fireEvent.click(jour("2026-12-10")!);
    expect(cliquable("2026-12-11")).toBe(true); // une seule nuit reste un séjour valide
    expect(avertissement()).toBeNull();
  });
});

describe("lead_days — le plancher des nuits réservables", () => {
  it("lead_days = 3 : les trois premières nuits passent sous le plancher", async () => {
    await renderPms([{ date: "2026-12-05", restrictions: { minStay: null, maxStay: null, leadDays: 3 } }]);

    // Aujourd'hui est le 1er décembre à Guatapé : le plancher monte au 4.
    expect(cliquable("2026-12-01")).toBe(false);
    expect(cliquable("2026-12-02")).toBe(false);
    expect(cliquable("2026-12-03")).toBe(false);
    expect(cliquable("2026-12-04")).toBe(true);
  });

  it("le plancher est un PLANCHER, pas une nuit barrée : au-delà, tout reste ouvert", async () => {
    await renderPms([{ date: "2026-12-05", restrictions: { minStay: null, maxStay: null, leadDays: 3 } }]);
    // La nuit qui PORTE la restriction n'est pas elle-même barrée — c'est bien le plancher qui a
    // monté, pas cette nuit-là qu'on retire.
    expect(cliquable("2026-12-05")).toBe(true);
    expect(cliquable("2026-12-20")).toBe(true);
  });

  it("le plancher retenu est le PLUS STRICT des délais relevés", async () => {
    await renderPms([
      { date: "2026-12-05", restrictions: { minStay: null, maxStay: null, leadDays: 2 } },
      { date: "2026-12-06", restrictions: { minStay: null, maxStay: null, leadDays: 6 } },
    ]);
    expect(cliquable("2026-12-06")).toBe(false); // plancher au 7, le plus strict l'emporte
    expect(cliquable("2026-12-07")).toBe(true);
  });

  it("la fenêtre atteignable ne redescend jamais sous le plancher", async () => {
    await renderPms([{ date: "2026-12-05", restrictions: { minStay: null, maxStay: null, leadDays: 3 } }]);
    fireEvent.click(jour("2026-12-06")!);
    expect(cliquable("2026-12-04")).toBe(true);  // le plancher lui-même reste une arrivée
    expect(cliquable("2026-12-03")).toBe(false); // en dessous, jamais
    expect(avertissement()).toBeNull();
  });
});

describe("sans restriction — le cas de tous les comptes observés à ce jour", () => {
  it("un relevé vide ne change RIEN : une nuit suffit, le plancher est aujourd'hui", async () => {
    await renderPms([]);
    expect(cliquable("2026-12-01")).toBe(true);
    fireEvent.click(jour("2026-12-10")!);
    expect(cliquable("2026-12-11")).toBe(true);
    expect(avertissement()).toBeNull();
  });
});
