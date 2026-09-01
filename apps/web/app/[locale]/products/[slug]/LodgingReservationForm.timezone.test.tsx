import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// ---------------------------------------------------------------------------------------------
// Lot fuseau (2026-08-28). Ce fichier est SÉPARÉ de LodgingReservationForm.test.tsx pour une raison
// de fond : il force le processus dans un fuseau qui n'est PAS celui de Guatapé, ce que l'autre
// fichier ne doit surtout pas faire (il vérifie une logique de capacité, pas de fuseau).
//
// POURQUOI FORCER LE FUSEAU. La machine de développement de ce projet est réglée sur
// America/Bogota, et le serveur Vercel sur UTC : ce sont les deux seuls fuseaux sous lesquels ce
// bug a jamais été exécuté, et le premier ne le montre JAMAIS. Un test qui tourne à Guatapé ne peut
// rien prouver ici. Europe/Paris est le fuseau du visiteur du grief.
// ---------------------------------------------------------------------------------------------
const TZ_VISITEUR = "Europe/Paris";
let tzOriginal: string | undefined;

beforeEach(() => {
  tzOriginal = process.env.TZ;
  process.env.TZ = TZ_VISITEUR;
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // `process.env.TZ = tzOriginal` écrirait la CHAÎNE "undefined" quand la variable n'était pas
  // posée (mesuré) — Node la lit alors comme un fuseau invalide. `delete` restaure vraiment.
  if (tzOriginal === undefined) delete process.env.TZ;
  else process.env.TZ = tzOriginal;
});

function renderForm({ isPmsBacked, availability }: { isPmsBacked: boolean; availability: { date: string; capacity: number; booked: number }[] }) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p-tz"
        productName="GUSTO"
        establishmentName="Casa Kayam"
        priceCop={20000}
        priceTiers={null}
        maxQty={6}
        lodgingKind="dorm"
        isPmsBacked={isPmsBacked}
        availability={availability}
        rates={[]}
      />
    </NextIntlClientProvider>
  );
}

describe("LodgingReservationForm — le calendrier est à l'heure de Guatapé, pas à celle du visiteur", () => {
  it("le 1er du mois à 2 h à Paris, demande à Lobby le mois de GUATAPÉ (août), pas celui du navigateur (septembre)", async () => {
    // 2026-09-01T02:30:00Z = 1er septembre 4 h 30 à Paris, mais encore le 31 AOÛT, 21 h 30, à
    // Guatapé. C'est le pire des dix sites du lot : `visibleMonth` pilote la CLÉ DU FETCH.
    vi.setSystemTime(new Date("2026-09-01T02:30:00Z"));

    // TÉMOIN, calculé ici même : voilà ce que l'ancien `useState(() => new Date())` produisait dans
    // ce processus. Le test n'affirme pas un écart, il le montre.
    // C'EST le témoin : la ligne suivante reproduit volontairement le geste interdit, pour montrer
    // l'écart au lieu de l'affirmer. Désactiver la règle ici est son seul usage légitime dans tout
    // le dépôt — et il reste visible.
    // eslint-disable-next-line no-restricted-syntax
    const temoinNavigateur = new Date();
    expect(temoinNavigateur.getMonth()).toBe(8); // septembre, côté navigateur

    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, nights: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderForm({ isPmsBacked: true, availability: [] });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("month=2026-08");
    expect(url).not.toContain("month=2026-09");
  });

  it("la nuit EN COURS à Guatapé reste sélectionnable pour un visiteur européen à 2 h du matin", () => {
    // L'instant de référence de tout le lot : à Guatapé il est encore le 27 août, 21 h 30.
    vi.setSystemTime(new Date("2026-08-28T02:30:00Z"));
    // Témoin, même raison qu'au test précédent.
    // eslint-disable-next-line no-restricted-syntax
    expect(new Date().getDate()).toBe(28); // le navigateur, lui, est déjà le 28.

    renderForm({
      isPmsBacked: false,
      availability: [
        { date: "2026-08-27", capacity: 4, booked: 0 },
        { date: "2026-08-28", capacity: 4, booked: 0 },
        { date: "2026-08-29", capacity: 4, booked: 0 },
      ],
    });

    // Avant le correctif, `{ before: new Date() }` valait « avant le 28 » : le 27 partait
    // désactivé, donc la nuit en cours à Guatapé n'était pas réservable de 19 h à minuit.
    const nuitEnCours = document.querySelector('[data-date="2026-08-27"]') as HTMLButtonElement | null;
    expect(nuitEnCours).not.toBeNull();
    expect(nuitEnCours!.disabled).toBe(false);
  });

  it("surligne comme « aujourd'hui » le jour de Guatapé, pas celui du navigateur", () => {
    vi.setSystemTime(new Date("2026-08-28T02:30:00Z"));
    renderForm({
      isPmsBacked: false,
      availability: [
        { date: "2026-08-27", capacity: 4, booked: 0 },
        { date: "2026-08-28", capacity: 4, booked: 0 },
      ],
    });

    // react-day-picker pose `data-today` sur la CELLULE. Sans la prop `today`, il le calcule avec
    // son propre `dateLib.today()` = `new Date()` du runtime (DayPicker.js:167) — le 28 aurait été
    // peint « aujourd'hui » alors que le calendrier laisse, correctement, le 27 sélectionnable.
    const cellule = (iso: string) => document.querySelector(`[data-date="${iso}"]`)?.closest("td");
    expect(cellule("2026-08-27")?.getAttribute("data-today")).toBe("true");
    expect(cellule("2026-08-28")?.getAttribute("data-today")).toBeNull();
  });

  it("le passé reste bien barré — le correctif décale la frontière, il ne la supprime pas", () => {
    vi.setSystemTime(new Date("2026-08-28T02:30:00Z"));
    renderForm({
      isPmsBacked: false,
      availability: [
        { date: "2026-08-26", capacity: 4, booked: 0 },
        { date: "2026-08-27", capacity: 4, booked: 0 },
      ],
    });

    const veille = document.querySelector('[data-date="2026-08-26"]') as HTMLButtonElement | null;
    expect(veille).not.toBeNull();
    expect(veille!.disabled).toBe(true);
  });

  it("ouvre le calendrier sur le mois de Guatapé — le visiteur voit août, pas septembre", () => {
    vi.setSystemTime(new Date("2026-09-01T02:30:00Z"));
    renderForm({ isPmsBacked: false, availability: [{ date: "2026-08-31", capacity: 4, booked: 0 }] });

    // ⚠️ Ne PAS asserter sur le 31 août : react-day-picker rend les jours débordants des mois
    // voisins, et le 31 août ouvre justement la première semaine de la grille de septembre — il est
    // présent dans les deux cas, donc il ne prouve rien (vérifié en rejouant ce test sans le
    // correctif : il passait). Les deux bornes ci-dessous, elles, ne peuvent pas coexister — la
    // grille d'août court du 27 juillet au 6 septembre, celle de septembre du 31 août au 4 octobre.
    expect(document.querySelector('[data-date="2026-08-01"]')).not.toBeNull();
    expect(document.querySelector('[data-date="2026-09-30"]')).toBeNull();
  });
});
