import { describe, expect, it } from "vitest";
import { mapMercadoPagoPaymentStatus } from "./mapPaymentStatus";

describe("mapMercadoPagoPaymentStatus", () => {
  it("approved reste approved", () => {
    expect(mapMercadoPagoPaymentStatus("approved")).toBe("approved");
  });

  it("rejected reste rejected", () => {
    expect(mapMercadoPagoPaymentStatus("rejected")).toBe("rejected");
  });

  it.each(["cancelled", "refunded", "charged_back"])(
    "%s se replie sur cancelled",
    (mpStatus) => {
      expect(mapMercadoPagoPaymentStatus(mpStatus)).toBe("cancelled");
    }
  );

  it.each(["pending", "in_process", "authorized", "in_mediation"])(
    "%s se replie sur pending",
    (mpStatus) => {
      expect(mapMercadoPagoPaymentStatus(mpStatus)).toBe("pending");
    }
  );

  it("un statut inconnu ou absent se replie prudemment sur pending, jamais approved", () => {
    expect(mapMercadoPagoPaymentStatus("some_future_status")).toBe("pending");
    expect(mapMercadoPagoPaymentStatus(null)).toBe("pending");
    expect(mapMercadoPagoPaymentStatus(undefined)).toBe("pending");
  });
});
