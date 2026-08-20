import { describe, expect, it } from "vitest";
import { isPossibleTraslado, isRealized } from "./detectTraslado";

const base: import("./detectTraslado").LobbyBookingDetailData = {
  checkin_realizado: null,
  checkout_realizado: null,
  total_alojamiento: "34200.00",
  descuentos: [],
  deleted_at: null,
};

describe("isPossibleTraslado", () => {
  it("total_alojamiento=0 et aucun descuento → possible traslado", () => {
    expect(isPossibleTraslado({ ...base, total_alojamiento: "0.00", descuentos: [] })).toBe(true);
  });

  it("total_alojamiento=0 avec descuentos=null → possible traslado", () => {
    expect(isPossibleTraslado({ ...base, total_alojamiento: "0", descuentos: null })).toBe(true);
  });

  it("total_alojamiento non nul → jamais un traslado, quel que soit descuentos", () => {
    expect(isPossibleTraslado({ ...base, total_alojamiento: "34200.00", descuentos: [] })).toBe(false);
  });

  it("total_alojamiento=0 MAIS descuentos non vide → pas un traslado (résa normale à prix nul)", () => {
    expect(isPossibleTraslado({ ...base, total_alojamiento: "0.00", descuentos: [{ descripcion: "GUAKAYAM" }] })).toBe(false);
  });
});

describe("isRealized", () => {
  it("checkout_realizado === 1 → réalisée", () => {
    expect(isRealized({ ...base, checkout_realizado: 1 })).toBe(true);
  });

  it("checkout_realizado null → pas réalisée", () => {
    expect(isRealized({ ...base, checkout_realizado: null })).toBe(false);
  });

  it("estatus n'existe même pas dans le type — jamais utilisé comme signal (piège empirique confirmé)", () => {
    // checkin_realizado=1 seul (check-in fait, pas check-out) ne suffit jamais.
    expect(isRealized({ ...base, checkin_realizado: 1, checkout_realizado: null })).toBe(false);
  });
});
