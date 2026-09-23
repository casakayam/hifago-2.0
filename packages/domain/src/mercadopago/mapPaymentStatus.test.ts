import { describe, expect, it } from "vitest";
import { mapMercadoPagoPaymentStatus } from "./mapPaymentStatus";

describe("mapMercadoPagoPaymentStatus", () => {
  it("approved reste approved", () => {
    expect(mapMercadoPagoPaymentStatus("approved")).toBe("approved");
  });

  it("rejected reste rejected", () => {
    expect(mapMercadoPagoPaymentStatus("rejected")).toBe("rejected");
  });

  it("cancelled reste cancelled", () => {
    expect(mapMercadoPagoPaymentStatus("cancelled")).toBe("cancelled");
  });

  // Spec 39 (2026-09-21) : un remboursement ou un contracargo n'est PAS une annulation — le replier
  // sur cancelled faisait repasser une commande payée à unpaid.
  it("refunded et charged_back gardent leur identité", () => {
    expect(mapMercadoPagoPaymentStatus("refunded")).toBe("refunded");
    expect(mapMercadoPagoPaymentStatus("charged_back")).toBe("charged_back");
  });

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
