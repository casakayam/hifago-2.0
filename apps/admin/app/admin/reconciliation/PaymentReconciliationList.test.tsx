import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PaymentReconciliationList, type PaymentReconciliationEntryRow } from "./PaymentReconciliationList";

// Le dialogue de résolution parle à Supabase : hors périmètre ici (la RPC est couverte par pgTAP,
// payments.test.sql cas 19-25). Ce test prouve seulement la LOGIQUE DE RENDU de la liste — quel
// groupe reçoit quelle entrée, ce qui s'affiche quand le webhook n'a jamais été corrélé, et qu'une
// entrée résolue disparaît (`.claude/rules/tests.md`, palier « composant »).
vi.mock("./ResolveEntryDialog", () => ({ ResolveEntryDialog: () => null }));
vi.mock("./RefundDialog", () => ({ RefundDialog: () => null }));

function row(overrides: Partial<PaymentReconciliationEntryRow>): PaymentReconciliationEntryRow {
  return {
    id: "e1",
    kind: "webhook_failure",
    status: "open",
    failureReason: "signature invalide (SignatureMismatch)",
    mpPaymentId: "179050364695",
    createdAt: "2026-09-20T21:03:42Z",
    orderId: "o1",
    orderReference: "HFG-000013",
    holderName: "Gabriel",
    amountCop: 3400,
    refundStatus: null,
    refundError: null,
    refundMpId: null,
    ...overrides,
  };
}

describe("PaymentReconciliationList", () => {
  it("met l'argent d'abord : refund_required dans son groupe, webhook_failure dans l'autre", () => {
    render(
      <PaymentReconciliationList
        rows={[
          row({ id: "refund", kind: "refund_required", failureReason: "paiement approuvé après expiration de la commande" }),
          row({ id: "noise", kind: "webhook_failure" }),
        ]}
      />
    );
    const refundGroup = within(screen.getByTestId("payment-reconciliation-refund-group"));
    const noiseGroup = within(screen.getByTestId("payment-reconciliation-actionable-group"));

    expect(refundGroup.getAllByTestId("payment-reconciliation-entry")).toHaveLength(1);
    expect(refundGroup.getByText("paiement approuvé après expiration de la commande")).toBeTruthy();
    expect(refundGroup.getByText("Reembolso requerido")).toBeTruthy();
    expect(noiseGroup.getAllByTestId("payment-reconciliation-entry")).toHaveLength(1);
    expect(noiseGroup.getByText("signature invalide (SignatureMismatch)")).toBeTruthy();
  });

  it("nomme la commande, le montant et l'identifiant Mercado Pago quand ils sont connus", () => {
    render(<PaymentReconciliationList rows={[row({ kind: "refund_required" })]} />);
    const link = screen.getByRole("link", { name: /HFG-000013 · Gabriel/ });
    expect(link.getAttribute("href")).toBe("/admin/orders/o1");
    expect(screen.getByText(/Mercado Pago #179050364695/)).toBeTruthy();
    // formatCop : 3 400 COP sans décimale, quel que soit le séparateur de milliers de la locale.
    expect(screen.getByText(/3[\s.,  ]?400/)).toBeTruthy();
  });

  it("affiche « Pago no identificado » quand le webhook n'a jamais été corrélé à un paiement", () => {
    render(
      <PaymentReconciliationList
        rows={[row({ orderId: null, orderReference: null, holderName: null, amountCop: null, mpPaymentId: null })]}
      />
    );
    expect(screen.getByText("Pago no identificado")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Monto desconocido/)).toBeTruthy();
  });

  // Spec 39 D3 (2026-09-22) — le bouton « Reembolsar » et les états du remboursement.
  it("propose « Reembolsar » sur une entrée refund_required ouverte, jamais sur un fallo de webhook", () => {
    render(
      <PaymentReconciliationList
        rows={[row({ id: "refund", kind: "refund_required" }), row({ id: "noise", kind: "webhook_failure" })]}
      />
    );
    expect(screen.getAllByTestId("refund-payment-entry-button")).toHaveLength(1);
    const noiseGroup = within(screen.getByTestId("payment-reconciliation-actionable-group"));
    expect(noiseGroup.queryByTestId("refund-payment-entry-button")).toBeNull();
  });

  it("ne repropose pas « Reembolsar » pendant qu'un remboursement est en cours, et montre le motif d'un refus", () => {
    render(
      <PaymentReconciliationList
        rows={[
          row({ id: "pending", kind: "refund_required", status: "retrying", refundStatus: "pending" }),
          row({
            id: "rejected", kind: "refund_required", status: "open", refundStatus: "rejected",
            refundError: "HTTP 400 Payment-too-old-to-be-refunded",
          }),
        ]}
      />
    );
    // Seule l'entrée « rejected » propose de réessayer (la RPC refuse un second remboursement vivant).
    expect(screen.getAllByTestId("refund-payment-entry-button")).toHaveLength(1);
    expect(screen.getByText("Reembolso en curso")).toBeTruthy();
    expect(screen.getByText(/Payment-too-old-to-be-refunded/)).toBeTruthy();
  });

  it("garde visibles les remboursements aboutis, sans bouton", () => {
    render(
      <PaymentReconciliationList
        rows={[row({ id: "done", kind: "refund_required", status: "resolved", refundStatus: "approved", refundMpId: "55501" })]}
      />
    );
    const refunded = within(screen.getByTestId("payment-reconciliation-refunded-group"));
    expect(refunded.getAllByTestId("payment-reconciliation-entry")).toHaveLength(1);
    expect(refunded.getByText(/Reembolso Mercado Pago #55501/)).toBeTruthy();
    expect(screen.queryByTestId("refund-payment-entry-button")).toBeNull();
    expect(screen.queryByTestId("resolve-payment-entry-button")).toBeNull();
  });

  it("n'affiche plus une entrée résolue, et dit qu'il n'y a rien à rembourser", () => {
    render(
      <PaymentReconciliationList
        rows={[row({ kind: "refund_required", status: "resolved" }), row({ id: "e2", status: "resolved" })]}
      />
    );
    expect(screen.queryAllByTestId("payment-reconciliation-entry")).toHaveLength(0);
    expect(screen.getByTestId("no-payment-refund-entries")).toBeTruthy();
  });
});
