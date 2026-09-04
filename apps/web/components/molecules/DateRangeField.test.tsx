import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { enUS, es } from "date-fns/locale";
import type { CalendarLibelles, PlageCalendrier } from "./Calendar";
import { DateRangeField, formatPlage, joursPasses } from "./DateRangeField";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// ⚠️ Dates FIGÉES : le composant refuse de lire l'horloge (`aujourdIso` est requis), et un test qui
// la lirait changerait de mois chaque jour.
//
// ⚠️ PIÈGE DE TEST DU DÉPÔT : le contenu d'un popover FERMÉ n'est pas dans le DOM. Tout test qui
// vise une case de calendrier doit OUVRIR le popover d'abord — sinon il passe au vert en n'ayant
// rien vérifié, ce qui est pire qu'un échec. `ouvrir()` existe pour ça, et le premier test fige
// justement l'absence.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;
window.IntersectionObserver ??= ObservateurInerte as unknown as typeof window.IntersectionObserver;

const AUJOURDHUI = "2026-09-15";
const LIBELLES: CalendarLibelles = { complet: "Completo", selectionne: "seleccionado", aujourdhui: "hoy" };

function Harnais({
  valeurInitiale = null,
  onChange,
}: {
  valeurInitiale?: PlageCalendrier | null;
  onChange?: (v: PlageCalendrier | null) => void;
}) {
  const [plage, setPlage] = useState<PlageCalendrier | null>(valeurInitiale);
  return (
    <DateRangeField
      value={plage}
      onChange={(v) => {
        setPlage(v);
        onChange?.(v);
      }}
      aujourdIso={AUJOURDHUI}
      placeholderLabel="Fechas"
      calendarLabels={LIBELLES}
      locale={es}
      testId="dates"
    />
  );
}

function declencheur(): HTMLElement {
  return screen.getByTestId("dates-trigger");
}

function ouvrir() {
  act(() => {
    fireEvent.pointerDown(declencheur(), { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(declencheur(), { pointerType: "mouse", button: 0 });
    fireEvent.click(declencheur());
  });
}

describe("joursPasses", () => {
  it("énumère 31 jours, tous strictement antérieurs, à partir de la veille", () => {
    const jours = joursPasses(AUJOURDHUI);
    expect(jours.length).toBe(31);
    expect(jours[0].date).toBe("2026-09-14");
    expect(jours.at(-1)?.date).toBe("2026-08-15");
    expect(jours.every((jour) => jour.etat === "desactive")).toBe(true);
    expect(jours.some((jour) => jour.date >= AUJOURDHUI)).toBe(false);
  });
});

describe("formatPlage", () => {
  // ⚠️ Mesuré au navigateur, pas inventé : c'est ce qui s'affichera sur le composant le plus
  // visible du site. `Intl` porte l'ordre, le séparateur et l'abréviation — aucune clé de
  // traduction n'est nécessaire.
  it("formate une plage selon la locale, et effondre le cas fin === debut", () => {
    const plage = { debut: "2026-09-18", fin: "2026-09-22" };
    // ⚠️ Les séparateurs sont ÉCRITS EN ÉCHAPPEMENT, et c'est le point : `es` colle un demi-cadratin
    // nu (U+2013) entre les deux nombres, `en-US` l'entoure de deux espaces fines (U+2009). À l'œil
    // les deux chaînes se ressemblent, et une assertion écrite avec des espaces ordinaires échoue
    // sur un diff invisible (rencontré en écrivant ce test). C'est exactement la raison d'employer
    // `Intl` plutôt qu'un gabarit maison : personne n'écrit ces espaces-là à la main.
    expect(formatPlage(plage, es.code)).toBe("18\u201322 sept");
    expect(formatPlage(plage, enUS.code)).toBe("Sep 18\u2009\u2013\u200922");
    // Le premier clic pose `{from: X, to: X}` (acquis du 2026-08-29) : une seule date s'affiche.
    expect(formatPlage({ debut: "2026-09-18", fin: "2026-09-18" }, es.code)).toBe("18 sept");
    // `fin` null — l'autre forme du même moment.
    expect(formatPlage({ debut: "2026-09-18", fin: null }, es.code)).toBe("18 sept");
  });
});

describe("DateRangeField", () => {
  it("⚠️ ne rend RIEN du calendrier tant que le popover est fermé", () => {
    // Le piège de test du dépôt, figé ici : sans cette constatation, tous les tests ci-dessous
    // pourraient viser des cases inexistantes et passer au vert.
    render(<Harnais />);
    expect(document.querySelectorAll("[data-date]").length).toBe(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("affiche le placeholder sans valeur, et le nom accessible porte la VALEUR", () => {
    // « Fechas » seul ne dit pas à un lecteur d'écran que le 18 au 22 sont choisis : c'est la
    // faute classique du motif déclencheur-plus-popover.
    const { unmount } = render(<Harnais />);
    expect(declencheur().textContent).toBe("Fechas");
    unmount();

    render(<Harnais valeurInitiale={{ debut: "2026-09-18", fin: "2026-09-22" }} />);
    expect(declencheur().textContent).toBe("Fechas : 18–22 sept");
  });

  it("ouvre le calendrier et éteint les jours antérieurs à aujourdIso", () => {
    render(<Harnais />);
    ouvrir();

    const jour = (iso: string) => document.querySelector(`[data-date="${iso}"]`);
    expect(jour("2026-09-15")).not.toBeNull();
    expect(jour("2026-09-14")?.getAttribute("data-etat")).toBe("desactive");
    expect((jour("2026-09-14") as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(jour("2026-09-01")?.getAttribute("data-etat")).toBe("desactive");
    // Aujourd'hui et le futur restent choisissables : le filtre n'interdit que le passé.
    expect((jour("2026-09-15") as HTMLButtonElement | null)?.disabled).toBe(false);
    expect((jour("2026-09-20") as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it("remonte la date choisie à l'appelant", () => {
    const change = vi.fn();
    render(<Harnais onChange={change} />);
    ouvrir();

    act(() => {
      (document.querySelector('[data-date="2026-09-18"]') as HTMLButtonElement).click();
    });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0]).toEqual({ debut: "2026-09-18", fin: "2026-09-18" });
  });
});
