"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@hifago/ui";
import { statusChip, type ChipStyle } from "@/components/status-chip";
import { ResolveEntryDialog } from "./ResolveEntryDialog";

export type ReconciliationEntryRow = {
  id: string;
  status: string;
  attempts: number;
  orderId: string;
  holderName: string;
  establishmentName: string;
};

// Vocabulaire de la feature 22 (check constraint pms_reconciliation_entries.status) — "resolved"
// n'apparaît dans aucun des deux groupes affichés (ni actionnable ni échec permanent) : une entrée
// résolue sort silencieusement de la file, cf. plan feature 22.
const STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  retrying: "Reintentando",
  resolved: "Resuelta",
  permanently_failed: "Fallo permanente",
};

const STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  open: { color: "accent", variant: "primary" },
  retrying: { color: "warning", variant: "soft" },
  resolved: { color: "success", variant: "soft" },
  permanently_failed: { color: "danger", variant: "primary" },
};

function EntryCard({
  entry,
  onResolveClick,
}: {
  entry: ReconciliationEntryRow;
  onResolveClick?: (entryId: string) => void;
}) {
  const chipStyle = statusChip(STATUS_CHIP_STYLE, entry.status);

  return (
    <div
      data-testid="reconciliation-entry"
      className="flex flex-col gap-2 rounded-lg border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <Link href={`/admin/orders/${entry.orderId}`} className="font-medium hover:underline">
          {entry.holderName}
        </Link>
        <p className="text-sm text-muted">
          {entry.establishmentName} · {entry.attempts} intento{entry.attempts === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Chip color={chipStyle.color} variant={chipStyle.variant}>
          {STATUS_LABELS[entry.status] ?? entry.status}
        </Chip>
        {onResolveClick ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="resolve-entry-button"
            onPress={() => onResolveClick(entry.id)}
          >
            Resolver
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ReconciliationList({ rows: initialRows }: { rows: ReconciliationEntryRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [dialogEntryId, setDialogEntryId] = useState<string | null>(null);

  // open/retrying = actionnable (un admin peut résolver) ; permanently_failed = échec permanent
  // (transition système, jamais un geste admin, cf. plan feature 22 — donc aucun bouton dessus).
  const actionableEntries = useMemo(
    () => rows.filter((row) => row.status === "open" || row.status === "retrying"),
    [rows]
  );
  const failedEntries = useMemo(
    () => rows.filter((row) => row.status === "permanently_failed"),
    [rows]
  );

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="reconciliation-actionable-group">
        <Card.Header>
          <Card.Title>Por resolver</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {actionableEntries.length > 0 ? (
            actionableEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} onResolveClick={setDialogEntryId} />
            ))
          ) : (
            <p className="text-sm text-muted">Ninguna entrada por resolver.</p>
          )}
        </Card.Content>
      </Card>

      <Card data-testid="reconciliation-failed-group">
        <Card.Header>
          <Card.Title>Fallo permanente</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {failedEntries.length > 0 ? (
            failedEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
          ) : (
            <p className="text-sm text-muted">Ninguna entrada en fallo permanente.</p>
          )}
        </Card.Content>
      </Card>

      {dialogEntryId ? (
        <ResolveEntryDialog
          entryId={dialogEntryId}
          open={dialogEntryId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogEntryId(null);
          }}
          onSuccess={() => {
            // Même mécanisme que ChangeStatusDialog (feature 10) : mise à jour de l'état local, pas
            // de router.refresh(). Une fois "resolved", l'entrée ne correspond plus au filtre
            // actionnable et sort donc silencieusement des deux groupes affichés.
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
