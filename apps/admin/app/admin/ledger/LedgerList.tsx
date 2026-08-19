"use client";

import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { statusChip, type ChipStyle } from "@/components/status-chip";
import { MarkPaidDialog } from "./MarkPaidDialog";

export type LedgerEntryRow = {
  id: string;
  beneficiaryType: string;
  entryType: string;
  amountCop: number;
  status: string;
  comprobantePath: string | null;
  note: string | null;
  holderName: string;
  productName: string;
  beneficiaryName: string;
};

// Spec 19 §0 Tranche 0 — 5 états de ledger_entries, vocabulaire fixé par le check constraint.
const STATUS_LABELS: Record<string, string> = {
  estimated: "Estimada",
  due: "A pagar",
  paid: "Pagada",
  reversed: "Reprisada",
  void: "Anulada",
};

const BENEFICIARY_LABELS: Record<string, string> = {
  referrer: "Referente",
  establishment: "Establecimiento",
};

const STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  estimated: { color: "default", variant: "soft" },
  due: { color: "warning", variant: "primary" },
  paid: { color: "success", variant: "soft" },
  reversed: { color: "accent", variant: "soft" },
  void: { color: "danger", variant: "soft" },
};

function EntryCard({
  entry,
  onMarkPaidClick,
}: {
  entry: LedgerEntryRow;
  onMarkPaidClick?: (entryId: string) => void;
}) {
  const chipStyle = statusChip(STATUS_CHIP_STYLE, entry.status);

  return (
    <div
      data-testid="ledger-entry"
      className="flex flex-col gap-2 rounded-lg border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {BENEFICIARY_LABELS[entry.beneficiaryType] ?? entry.beneficiaryType}: {entry.beneficiaryName}
        </span>
        <p className="text-sm text-muted">
          {entry.productName} · {entry.holderName} · {formatCop(entry.amountCop)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Chip color={chipStyle.color} variant={chipStyle.variant}>
          {STATUS_LABELS[entry.status] ?? entry.status}
        </Chip>
        {onMarkPaidClick ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="mark-paid-button"
            onPress={() => onMarkPaidClick(entry.id)}
          >
            Marcar pagado
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function LedgerList({ rows: initialRows }: { rows: LedgerEntryRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [dialogEntryId, setDialogEntryId] = useState<string | null>(null);

  // due = actionable (l'admin peut marquer payé, repli manuel spec 19 §0) ; le reste (estimated/
  // paid/reversed/void) est un historique en lecture seule.
  const dueEntries = useMemo(() => rows.filter((row) => row.status === "due"), [rows]);
  const historyEntries = useMemo(() => rows.filter((row) => row.status !== "due"), [rows]);

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="ledger-due-group">
        <Card.Header>
          <Card.Title>Por pagar</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {dueEntries.length > 0 ? (
            dueEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} onMarkPaidClick={setDialogEntryId} />
            ))
          ) : (
            <p className="text-sm text-muted">Ninguna entrada por pagar.</p>
          )}
        </Card.Content>
      </Card>

      <Card data-testid="ledger-history-group">
        <Card.Header>
          <Card.Title>Historial</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {historyEntries.length > 0 ? (
            historyEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
          ) : (
            <p className="text-sm text-muted">Ningún historial todavía.</p>
          )}
        </Card.Content>
      </Card>

      {dialogEntryId ? (
        <MarkPaidDialog
          entryId={dialogEntryId}
          open={dialogEntryId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogEntryId(null);
          }}
          onSuccess={() => {
            // Même mécanisme que ResolveEntryDialog/ChangeStatusDialog : mise à jour de l'état
            // local, pas de router.refresh(). Une fois "paid", l'entrée sort du groupe "due".
            const paidId = dialogEntryId;
            setRows((prev) =>
              prev.map((row) => (row.id === paidId ? { ...row, status: "paid" } : row))
            );
          }}
        />
      ) : null}
    </div>
  );
}
