import { describe, expect, it } from "vitest";
import { hasUnavailableNightInRange, reachableRangeWindow } from "./reservationRange";

// Décembre 2026, le mois du grief. Nuits pleines : 23 et 24. Horizon large, borne basse au 1er.
const BORNES = { firstIso: "2026-12-01", lastIso: "2027-02-28" };
const PLEINES = new Set(["2026-12-23", "2026-12-24"]);
const SANS_DONNEE = new Set(["2026-12-30"]);
const reservable = (iso: string) => !PLEINES.has(iso) && !SANS_DONNEE.has(iso);

describe("reachableRangeWindow", () => {
  it("borne la sortie à la PREMIÈRE nuit pleine, celle-ci INCLUSE", () => {
    // Ancre au 20. Nuits 20, 21, 22 réservables ; 23 pleine. On peut donc dormir 20-21-22 et
    // sortir le 23 au matin — mais pas plus loin.
    expect(reachableRangeWindow("2026-12-20", reservable, BORNES)).toEqual({
      fromIso: "2026-12-01",
      toIso: "2026-12-23",
    });
  });

  it("la sortie sur la nuit pleine est ATTEIGNABLE, et c'est tout l'enjeu", () => {
    const fenetre = reachableRangeWindow("2026-12-20", reservable, BORNES)!;
    expect(fenetre.toIso).toBe("2026-12-23");
    // La nuit du 23 n'est PAS réservable, et pourtant le 23 est une date de sortie valide : on dort
    // jusqu'au 22 inclus. C'est exactement ce que `excludeDisabled` (RDP) et `isInvalidSelection`
    // (react-aria) interdiraient, tous deux inclusifs de la fin.
    expect(reservable(fenetre.toIso)).toBe(false);
    const nuits = ["2026-12-20", "2026-12-21", "2026-12-22"];
    expect(hasUnavailableNightInRange(nuits, 1, (n) => (reservable(n) ? { capacity: 4, booked: 0 } : undefined), () => 0)).toBe(false);
  });

  it("recule jusqu'à la nuit pleine précédente, exclue elle", () => {
    // Ancre au 27 : en arrière, les nuits 26 et 25 sont libres, la 24 est pleine. La plus ancienne
    // arrivée possible est donc le 25 — dormir la nuit du 24 est impossible.
    expect(reachableRangeWindow("2026-12-27", reservable, BORNES)).toEqual({
      fromIso: "2026-12-25",
      toIso: "2026-12-30",
    });
  });

  it("traite une nuit SANS DONNÉE exactement comme une nuit pleine", () => {
    const fenetre = reachableRangeWindow("2026-12-27", reservable, BORNES)!;
    expect(fenetre.toIso).toBe("2026-12-30"); // le 30 n'a pas de donnée → sortie possible, pas nuit
  });

  it("s'arrête aux bornes quand rien ne bloque avant elles", () => {
    const toutLibre = () => true;
    expect(reachableRangeWindow("2027-01-15", toutLibre, BORNES)).toEqual({
      fromIso: "2026-12-01",
      toIso: "2027-02-28",
    });
  });

  it("rend null si la nuit de l'ancre n'est plus réservable", () => {
    // Cas réel : la quantité demandée a monté APRÈS le clic. L'appelant doit repartir de zéro,
    // pas rétrécir une fenêtre qui n'a plus de centre.
    expect(reachableRangeWindow("2026-12-23", reservable, BORNES)).toBeNull();
  });

  it("le seuil est la quantité demandée, jamais zéro", () => {
    // Nuit à 2 places restantes : réservable à 2, plus à 3. Le calendrier doit donc se resserrer
    // quand la quantité monte, sans qu'aucun clic n'ait eu lieu.
    const restant = new Map([["2026-12-21", 2]]);
    const pour = (qty: number) => (iso: string) => (restant.get(iso) ?? 4) >= qty;
    expect(reachableRangeWindow("2026-12-20", pour(2), BORNES)!.toIso).toBe("2027-02-28");
    expect(reachableRangeWindow("2026-12-20", pour(3), BORNES)!.toIso).toBe("2026-12-21");
  });

  it("une ancre collée à une borne ne boucle pas et ne déborde pas", () => {
    expect(reachableRangeWindow("2026-12-01", reservable, BORNES)!.fromIso).toBe("2026-12-01");
    expect(reachableRangeWindow("2027-02-28", reservable, BORNES)!.toIso).toBe("2027-02-28");
  });
});
