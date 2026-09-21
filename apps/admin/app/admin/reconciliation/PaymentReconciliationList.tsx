"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@hifago/ui";
import { formatCop, formatDateTimeInBogota } from "@hifago/domain";
import { statusChip, type ChipStyle } from "@/components/status-chip";
import { ResolveEntryDialog } from "./ResolveEntryDialog";
import { RefundDialog } from "./RefundDialog";

// Durcissement 20260920120000 (incident HFG-000013) — PREMIER écran à lire
// `payment_reconciliation_entries`. Jusqu'ici l'e-mail « Nueva excepción de reconciliación de pago »
// envoyait l'admin sur cette page… qui ne listait que le PMS : l'exception annoncée n'y était
// nulle part, et l'incident du 2026-09-20 n'a été vu qu'en SQL direct. Une entrée que personne ne
// peut voir est un souhait, pas une règle (CLAUDE.md §11.20).
//
// Deux groupes, l'argent d'abord : `refund_required` (encaissé chez Mercado Pago, rien à honorer —
// action humaine requise) puis `webhook_failure` (bruit à diagnostiquer : signature, corrélation,
// re-confirmation). « Resolver » (note obligatoire, RPC resolve_payment_reconciliation_entry) pour
// le réhonorage MANUEL, et depuis le 2026-09-22 (spec 39 D3, arbitrage Jérôme) « Reembolsar » sur
// une entrée refund_required : RefundDialog met la demande en file, le job payments-reconcile
// l'exécute — l'état du remboursement (en cours / reembolsado / rechazado + motif MP) est lu sur
// l'entrée. Une entrée résolue sort des deux premiers groupes ; les remboursements aboutis restent
// visibles dans un troisième. Même anatomie que ReconciliationList.tsx (PMS), volontairement — les
// deux vivent sur le même écran.

export type PaymentReconciliationEntryRow = {
  id: string;
  kind: string; // 'webhook_failure' | 'refund_required' (CHECK en base)
  status: string; // 'open' | 'retrying' | 'resolved' | 'permanently_failed'
  failureReason: string;
  mpPaymentId: string | null;
  createdAt: string;
  /** null si le webhook n'a jamais pu être corrélé à un `payments` connu (signature invalide, …). */
  orderId: string | null;
  orderReference: string | null;
  holderName: string | null;
  amountCop: number | null;
  /** Spec 39 D3 — dernier remboursement lié à l'entrée : `pending` | `approved` | `rejected` | null. */
  refundStatus: string | null;
  refundError: string | null;
  refundMpId: string | null;
};

const KIND_LABELS: Record<string, string> = {
  refund_required: "Reembolso requerido",
  webhook_failure: "Fallo de webhook",
};

const KIND_CHIP_STYLE: Record<string, ChipStyle> = {
  refund_required: { color: "danger", variant: "primary" },
  webhook_failure: { color: "warning", variant: "soft" },
};

const STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  retrying: "Reintentando",
  resolved: "Resuelta",
  permanently_failed: "Fallo permanente",
};

const REFUND_LABELS: Record<string, string> = {
  pending: "Reembolso en curso",
  approved: "Reembolsado",
  rejected: "Reembolso rechazado",
};
const REFUND_CHIP_STYLE: Record<string, ChipStyle> = {
  pending: { color: "warning", variant: "soft" },
  approved: { color: "success", variant: "soft" },
  rejected: { color: "danger", variant: "soft" },
};

function EntryCard({
  entry,
  onResolveClick,
  onRefundClick,
}: {
  entry: PaymentReconciliationEntryRow;
  onResolveClick?: (entryId: string) => void;
  onRefundClick?: (entryId: string) => void;
}) {
  const kindStyle = statusChip(KIND_CHIP_STYLE, entry.kind);
  const refundStyle = entry.refundStatus ? statusChip(REFUND_CHIP_STYLE, entry.refundStatus) : null;
  // Reembolsar : seulement l'argent encaissé sans prestation, et seulement s'il n'y a pas déjà un
  // remboursement vivant (la RPC le refuse aussi — ici c'est pour ne pas proposer un geste vain).
  const canRefund =
    onRefundClick !== undefined &&
    entry.kind === "refund_required" &&
    (entry.status === "open" || entry.status === "retrying") &&
    entry.refundStatus !== "pending" &&
    entry.refundStatus !== "approved";

  return (
    <div
      data-testid="payment-reconciliation-entry"
      data-kind={entry.kind}
      className="flex flex-col gap-2 rounded-lg border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        {entry.orderId ? (
          <Link href={`/admin/orders/${entry.orderId}`} className="font-medium hover:underline">
            {entry.orderReference ?? "Pedido"} · {entry.holderName ?? "—"}
          </Link>
        ) : (
          <span className="font-medium">Pago no identificado</span>
        )}
        <p className="text-sm text-muted">
          {entry.amountCop !== null ? formatCop(entry.amountCop) : "Monto desconocido"}
          {entry.mpPaymentId ? ` · Mercado Pago #${entry.mpPaymentId}` : ""}
          {" · "}
          {formatDateTimeInBogota(entry.createdAt, "es")}
        </p>
        {/* Le motif : la seule chose que la machine savait au moment de refuser — sans lui l'admin
            enquête à l'aveugle (même leçon que le PMS, 2026-08-27). */}
        <p className="text-xs text-muted break-all" data-testid="payment-reconciliation-entry-reason">
          {entry.failureReason}
        </p>
        {entry.refundStatus === "rejected" && entry.refundError ? (
          <p className="text-xs text-danger break-all" data-testid="payment-refund-error">
            Mercado Pago rechazó el reembolso: {entry.refundError}
          </p>
        ) : null}
        {entry.refundStatus === "approved" && entry.refundMpId ? (
          <p className="text-xs text-muted" data-testid="payment-refund-id">
            Reembolso Mercado Pago #{entry.refundMpId}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Chip color={kindStyle.color} variant={kindStyle.variant}>
          {KIND_LABELS[entry.kind] ?? entry.kind}
        </Chip>
        {refundStyle && entry.refundStatus ? (
          <Chip color={refundStyle.color} variant={refundStyle.variant} data-testid="payment-refund-status">
            {REFUND_LABELS[entry.refundStatus] ?? entry.refundStatus}
          </Chip>
        ) : (
          <Chip color="default" variant="soft">
            {STATUS_LABELS[entry.status] ?? entry.status}
          </Chip>
        )}
        {canRefund ? (
          <Button
            size="sm"
            variant="danger"
            data-testid="refund-payment-entry-button"
            onPress={() => onRefundClick?.(entry.id)}
          >
            Reembolsar
          </Button>
        ) : null}
        {onResolveClick ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="resolve-payment-entry-button"
            onPress={() => onResolveClick(entry.id)}
          >
            Resolver
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PaymentReconciliationList({ rows: initialRows }: { rows: PaymentReconciliationEntryRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [dialogEntryId, setDialogEntryId] = useState<string | null>(null);
  const [refundEntryId, setRefundEntryId] = useState<string | null>(null);

  const isActionable = (row: PaymentReconciliationEntryRow) =>
    row.status === "open" || row.status === "retrying";
  const refundEntries = useMemo(
    () => rows.filter((row) => isActionable(row) && row.kind === "refund_required"),
    [rows]
  );
  const failureEntries = useMemo(
    () => rows.filter((row) => isActionable(row) && row.kind !== "refund_required"),
    [rows]
  );
  const refundedEntries = useMemo(
    () => rows.filter((row) => row.status === "resolved" && row.refundStatus === "approved"),
    [rows]
  );
  const refundEntry = refundEntryId ? rows.find((row) => row.id === refundEntryId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="payment-reconciliation-refund-group">
        <Card.Header>
          <Card.Title>Pagos recibidos sin reserva que honrar</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            El cliente pagó en Mercado Pago, pero la reserva ya había expirado, fue anulada o ya
            estaba pagada por otro intento. Hay que reembolsar o contactar al cliente.
          </p>
          {refundEntries.length > 0 ? (
            refundEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onResolveClick={setDialogEntryId}
                onRefundClick={setRefundEntryId}
              />
            ))
          ) : (
            <p className="text-sm text-muted" data-testid="no-payment-refund-entries">
              Ningún pago pendiente de reembolso.
            </p>
          )}
        </Card.Content>
      </Card>

      <Card data-testid="payment-reconciliation-actionable-group">
        <Card.Header>
          <Card.Title>Fallos de webhook por revisar</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {failureEntries.length > 0 ? (
            failureEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} onResolveClick={setDialogEntryId} />
            ))
          ) : (
            <p className="text-sm text-muted">Ningún fallo de webhook por revisar.</p>
          )}
        </Card.Content>
      </Card>

      <Card data-testid="payment-reconciliation-refunded-group">
        <Card.Header>
          <Card.Title>Reembolsados</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {refundedEntries.length > 0 ? (
            refundedEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
          ) : (
            <p className="text-sm text-muted">Ningún reembolso ejecutado.</p>
          )}
        </Card.Content>
      </Card>

      {refundEntry ? (
        <RefundDialog
          entryId={refundEntry.id}
          amountLabel={refundEntry.amountCop !== null ? formatCop(refundEntry.amountCop) : "el pago"}
          open={refundEntryId !== null}
          onOpenChange={(open) => {
            if (!open) setRefundEntryId(null);
          }}
          onSuccess={() => {
            const id = refundEntry.id;
            setRows((prev) =>
              prev.map((row) =>
                row.id === id ? { ...row, status: "retrying", refundStatus: "pending", refundError: null } : row
              )
            );
          }}
        />
      ) : null}

      {dialogEntryId ? (
        <ResolveEntryDialog
          entryId={dialogEntryId}
          rpcName="resolve_payment_reconciliation_entry"
          open={dialogEntryId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogEntryId(null);
          }}
          onSuccess={() => {
            const resolvedId = dialogEntryId;
            setRows((prev) =>
              prev.map((row) => (row.id === resolvedId ? { ...row, status: "resolved" } : row))
            );
          }}
        />
      ) : null}
    </div>
  );
}
