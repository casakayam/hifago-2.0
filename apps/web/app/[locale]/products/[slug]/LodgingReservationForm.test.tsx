import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LodgingReservationForm } from "./LodgingReservationForm";
import messages from "@/messages/es.json";

// Même mock de navigation que ProductDetailView.test.tsx (cf. son commentaire) : le lien vers le
// checkout n'est pas le sujet.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Panier vide et figé : ce fichier teste la réaction du calendrier à la quantité, pas la mécanique
// d'ajout au panier (déjà couverte en e2e par reserve-lodging-range.spec.ts).
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// Ce fichier couvre le correctif du 2026-08-28 : avant lui, `fullDates` barrait les nuits sur un
// seuil `<= 0` codé en dur — donc uniquement les nuits COMPLÈTES — et le champ quantité était
// verrouillé tant qu'aucune date n'était choisie. Une nuit à 2 places restantes se laissait donc
// sélectionner pour 4 personnes, et n'était refusée qu'après coup.
//
// HORLOGE FIGÉE, et ce n'est pas du confort. Le composant ouvre le calendrier sur `new Date()` et
// masque le passé (`disabled={{ before }}`) : sans horloge fixe, les nuits testées tomberaient hors
// du mois affiché ou dans le passé selon le jour d'exécution. C'est exactement le piège qui a fait
// échouer partner-agenda.spec.ts le 2026-08-27 (une date « future dans le mois courant » se
// raréfie à mesure qu'on approche du 31). Seul `Date` est simulé — fausser les timers casserait
// l'ordonnancement de React Testing Library.
const TODAY = new Date(2026, 5, 1, 12);
const MONTH = "2026-06";
const TIGHT_NIGHT = `${MONTH}-10`;
const FULL_NIGHT = `${MONTH}-11`;
const OPEN_NIGHT = `${MONTH}-12`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderForm() {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p1"
        productName="GUSTO"
        establishmentName="Casa Kayam"
        priceCop={20000}
        priceTiers={null}
        maxQty={6}
        lodgingKind="dorm"
        isPmsBacked={false}
        availability={[
          { date: TIGHT_NIGHT, capacity: 2, booked: 0 },
          { date: FULL_NIGHT, capacity: 0, booked: 0 },
          { date: OPEN_NIGHT, capacity: 6, booked: 0 },
        ]}
        rates={[]}
      />
    </NextIntlClientProvider>
  );
}

// Le modifier `unavailable` est posé sur la CELLULE (<td>), pas sur le bouton — même constat que
// reserve-lodging-pms-availability.spec.ts.
function isStruck(date: string): boolean {
  const button = document.querySelector(`[data-date="${date}"]`);
  return button?.closest("td")?.className.includes("line-through") ?? false;
}

function setQty(value: string) {
  fireEvent.change(screen.getByTestId("lodging-qty-input"), { target: { value } });
}

describe("LodgingReservationForm — le calendrier suit la quantité demandée", () => {
  it("ne barre que les nuits complètes tant qu'on ne demande qu'une place", () => {
    renderForm();
    expect(isStruck(FULL_NIGHT)).toBe(true);
    expect(isStruck(TIGHT_NIGHT)).toBe(false);
    expect(isStruck(OPEN_NIGHT)).toBe(false);
  });

  it("barre en plus les nuits trop justes dès que la quantité monte", () => {
    renderForm();
    setQty("3");
    // 2 places restantes < 3 demandées : la nuit sort du choix AVANT d'être sélectionnée, c'est
    // tout l'objet du correctif.
    expect(isStruck(TIGHT_NIGHT)).toBe(true);
    expect(isStruck(OPEN_NIGHT)).toBe(false);
  });

  it("barre tout ce qui dépasse la nuit la mieux dotée quand on demande le maximum", () => {
    renderForm();
    setQty("6");
    expect(isStruck(TIGHT_NIGHT)).toBe(true);
    expect(isStruck(FULL_NIGHT)).toBe(true);
    expect(isStruck(OPEN_NIGHT)).toBe(false);
  });

  it("laisse saisir la quantité AVANT toute date, et ne la remet pas à 1 en choisissant une nuit", () => {
    renderForm();
    const input = screen.getByTestId("lodging-qty-input") as HTMLInputElement;
    expect(input.disabled).toBe(false);

    setQty("4");
    fireEvent.click(document.querySelector(`[data-date="${OPEN_NIGHT}"]`)!);
    expect((screen.getByTestId("lodging-qty-input") as HTMLInputElement).value).toBe("4");
  });

  it("affiche le restant sur une nuit qui contraint le choix, et rien sur une nuit qui ne contraint pas", () => {
    renderForm();
    const tight = document.querySelector(`[data-date="${TIGHT_NIGHT}"]`);
    expect(tight?.querySelector('[data-testid="night-remaining"]')?.textContent).toBe("2");

    // 6 restants pour un maximum de 6 : le nombre n'apprend rien, il n'est pas imprimé.
    const open = document.querySelector(`[data-date="${OPEN_NIGHT}"]`);
    expect(open?.querySelector('[data-testid="night-remaining"]')).toBeNull();
  });

  it("nomme l'unité de la quantité selon la nature du couchage", () => {
    renderForm();
    expect(screen.getByText("Camas")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Tâche 1 (2026-08-28) — la reprise. La panne mesurée est TRANSITOIRE (novembre est revenu 0, puis
// 29/30, puis 30/30) : ce qui manquait n'était pas un meilleur message, c'était de redemander.
// Avant ce lot, `loadedMonthsRef` marquait le mois « chargé » même en échec, et plus rien ne le
// retentait de toute la session.
// ---------------------------------------------------------------------------------------------

function renderPmsForm() {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p-pms"
        productName="GUSTO"
        establishmentName="Casa Kayam"
        priceCop={20000}
        priceTiers={null}
        maxQty={6}
        lodgingKind="dorm"
        isPmsBacked
        availability={[]}
        rates={[]}
      />
    </NextIntlClientProvider>
  );
}

function mockFetchOnce(body: unknown) {
  return vi.fn().mockResolvedValue({ json: async () => body } as Response);
}

describe("LodgingReservationForm — reprise après un échec Lobby", () => {
  it("annonce l'échec, propose de réessayer, et bloque l'ajout au panier", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ ok: false, reason: "pms_unreachable" }));
    renderPmsForm();

    await waitFor(() => expect(screen.getByTestId("pms-availability-error")).toBeTruthy());
    expect(screen.getByTestId("pms-availability-retry")).toBeTruthy();
    expect((screen.getByTestId("add-to-cart-button") as HTMLButtonElement).disabled).toBe(true);
    vi.unstubAllGlobals();
  });

  it("réessayer redemande vraiment le mois — c'est LE correctif", async () => {
    const fetchMock = mockFetchOnce({ ok: false, reason: "pms_unreachable" });
    vi.stubGlobal("fetch", fetchMock);
    renderPmsForm();

    await waitFor(() => expect(screen.getByTestId("pms-availability-retry")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("pms-availability-retry"));
    // Sans le correctif, loadedMonthsRef avait déjà marqué le mois chargé et l'effet ne repartait
    // jamais : le compteur resterait à 1.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    vi.unstubAllGlobals();
  });

  it("distingue le quota du reste, avec son propre message", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ ok: false, reason: "pms_rate_limited", retryAfterSeconds: 37 }));
    renderPmsForm();

    await waitFor(() => {
      expect(screen.getByTestId("pms-availability-error").textContent).toContain("Demasiadas consultas");
    });
    vi.unstubAllGlobals();
  });

  it("ne propose PAS de réessayer quand le connecteur est simplement coupé", async () => {
    // État anticipé, pas une panne : réessayer ne changera rien tant qu'un admin n'agit pas.
    vi.stubGlobal("fetch", mockFetchOnce({ ok: false, reason: "connector_inactive" }));
    renderPmsForm();

    await waitFor(() => expect(screen.getByTestId("pms-availability-error")).toBeTruthy());
    expect(screen.queryByTestId("pms-availability-retry")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("une nuit jamais résolue n'est pas sélectionnable — symétrie avec le verdict", async () => {
    // hasUnavailableNightInRange refusait DÉJÀ une nuit absente ; seul l'affichage la laissait
    // passer. C'est ce décalage qui produisait un calendrier d'apparence normale, entièrement
    // non réservable.
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ ok: true, nights: [{ date: "2026-06-12", capacity: 4, booked: 0 }] })
    );
    renderPmsForm();

    await waitFor(() => {
      expect(document.querySelector('[data-date="2026-06-12"]')?.hasAttribute("disabled")).toBe(false);
    });
    expect(document.querySelector('[data-date="2026-06-13"]')?.hasAttribute("disabled")).toBe(true);
    vi.unstubAllGlobals();
  });
});
