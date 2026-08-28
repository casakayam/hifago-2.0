import { describe, expect, it } from "vitest";
import {
  RESERVATION_HORIZON_MONTHS,
  isMonthWithinHorizon,
  lastBookableDateIso,
} from "./reservationHorizon.ts";
import { addDaysIso } from "../time/bogotaDates.ts";

describe("l'horizon produit", () => {
  it("vaut six mois — la décision du 2026-08-28, écrite une seule fois", () => {
    expect(RESERVATION_HORIZON_MONTHS).toBe(6);
  });

  it("compte en MOIS, pas en jours — c'est là que les trois anciennes définitions divergeaient", () => {
    // TÉMOINS : les deux expressions qui coexistaient dans le dépôt, à trois jours l'une de l'autre.
    expect(addDaysIso("2026-08-28", 180)).toBe("2027-02-24"); // fiche produit
    expect(addDaysIso("2026-08-28", 183)).toBe("2027-02-27"); // agenda socio
    // La définition unique ne coïncide avec NI l'une NI l'autre, et c'est bien le problème qu'elle
    // règle : « six mois » n'a jamais voulu dire « 180 jours ».
    expect(lastBookableDateIso("2026-08-28")).toBe("2027-02-28");
  });

  it("borne au dernier jour du mois d'arrivée au lieu de déborder sur le suivant", () => {
    expect(lastBookableDateIso("2026-08-31")).toBe("2027-02-28"); // pas le 3 mars
    expect(lastBookableDateIso("2027-08-31")).toBe("2028-02-29"); // 2028 est bissextile
    expect(lastBookableDateIso("2026-07-31")).toBe("2027-01-31"); // aucun débordement à borner
  });

  it("franchit l'année sans se tromper de rang", () => {
    expect(lastBookableDateIso("2026-12-15")).toBe("2027-06-15");
    expect(lastBookableDateIso("2026-07-01")).toBe("2027-01-01");
  });

  it("accepte le mois courant et les six suivants, refuse le septième et tout le passé", () => {
    const today = "2026-08-28";
    expect(isMonthWithinHorizon("2026-08", today)).toBe(true); // le mois courant
    expect(isMonthWithinHorizon("2027-02", today)).toBe(true); // le sixième
    expect(isMonthWithinHorizon("2027-03", today)).toBe(false); // le septième
    expect(isMonthWithinHorizon("2026-07", today)).toBe(false); // le mois dernier
    expect(isMonthWithinHorizon("2025-08", today)).toBe(false); // un an en arrière
  });

  it("resserre bien l'ancien garde d'abus de 36 mois — c'était l'enjeu", () => {
    // TÉMOIN : l'ancienne borne acceptait trois ans de mois distincts, donc trois ans de clés de
    // cache neuves, donc autant d'appels LobbyPMS réels depuis une route publique et anonyme.
    const ancienGarde = (mois: string) => {
      const rang = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
      const ecart = rang(mois) - rang("2026-08");
      return ecart >= 0 && ecart <= 36;
    };
    expect(ancienGarde("2029-08")).toBe(true);
    expect(isMonthWithinHorizon("2029-08", "2026-08-28")).toBe(false);
  });

  it("refuse un mois malformé au lieu de le laisser passer pour le mois courant", () => {
    expect(() => isMonthWithinHorizon("2026-13", "2026-08-28")).toThrow(RangeError);
    expect(() => isMonthWithinHorizon("2026-00", "2026-08-28")).toThrow(RangeError);
    expect(() => isMonthWithinHorizon("aout", "2026-08-28")).toThrow(RangeError);
  });
});
