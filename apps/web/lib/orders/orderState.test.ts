import { describe, expect, it } from "vitest";
import { deriveOrderState, isDeadLine, DEAD_LINE_STATUSES } from "./orderState";

// Pas de @testing-library ici : fonction pure, aucun composant à monter.
describe("deriveOrderState", () => {
  it("rend « paid » dès que le paiement est encaissé, quels que soient les statuts de ligne", () => {
    expect(
      deriveOrderState({ paymentStatus: "paid", lines: [{ status: "cancelled_by_client" }] })
    ).toBe("paid");
  });

  it("rend « awaiting » pendant que le webhook Mercado Pago n'est pas arrivé", () => {
    expect(deriveOrderState({ paymentStatus: "pending", lines: [{ status: "reserved" }] })).toBe(
      "awaiting"
    );
  });

  it("rend « unpaid » tant qu'une prestation est encore vivante", () => {
    expect(deriveOrderState({ paymentStatus: "unpaid", lines: [{ status: "reserved" }] })).toBe(
      "unpaid"
    );
  });

  // ⚠️ Le cas qui distingue les deux fins : toutes les lignes sont mortes, et c'est l'expiration
  // qui décide du mot employé. Une commande dont le paiement n'est jamais arrivé n'a pas été
  // « anulada » par le client — le dire faussement lui ferait croire qu'il a agi.
  it("rend « expired » quand toutes les lignes sont mortes et qu'au moins une a expiré", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid",
        lines: [{ status: "expired" }, { status: "cancelled_by_client" }],
      })
    ).toBe("expired");
  });

  it("rend « cancelled » quand toutes les lignes sont mortes sans aucune expiration", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid",
        lines: [{ status: "cancelled_by_client" }, { status: "cancelled_by_provider" }],
      })
    ).toBe("cancelled");
  });

  // Une commande sans aucune ligne ne doit pas être annoncée « à payer » : il n'y a rien à payer.
  it("rend « cancelled » pour une commande sans aucune ligne", () => {
    expect(deriveOrderState({ paymentStatus: "unpaid", lines: [] })).toBe("cancelled");
  });

  // Le piège nommé dans l'en-tête d'OrderResult : un paiement de trop qui échoue ne doit pas
  // rendre payable une commande déjà payée. Ce module ne connaît pas l'incident — il rend « paid »,
  // et c'est l'écran qui superpose « failed » sans jamais rouvrir le bouton de paiement.
  it("ne connaît pas l'incident de paiement : une commande payée reste « paid »", () => {
    expect(deriveOrderState({ paymentStatus: "paid", lines: [{ status: "reserved" }] })).toBe(
      "paid"
    );
  });
});

describe("isDeadLine", () => {
  it("reconnaît les quatre statuts qui ne comptent plus", () => {
    expect(DEAD_LINE_STATUSES.every(isDeadLine)).toBe(true);
  });

  it("laisse vivantes les prestations réservées, réalisées et absentes", () => {
    // `fulfilled` et `no_show` sont des lignes réellement dues : elles comptent dans les totaux,
    // exactement comme la RPC les y compte.
    expect(["reserved", "fulfilled", "no_show"].some(isDeadLine)).toBe(false);
  });
});
