"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTable } from "@tanstack/react-table";
import {
  Button,
  Chip,
  createSortablePaginatedColumnHelper,
  SortablePaginatedTable,
  sortablePaginatedTableFeatures,
} from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "@/app/admin/orders/statusLabels";
import { SetOrderLineStatusDialog } from "./SetOrderLineStatusDialog";

export type ReservationRow = {
  id: string;
  date: string;
  productName: string;
  establishmentName: string;
  holderName: string;
  qty: number;
  totalCop: number;
  status: string;
};

const columnHelper = createSortablePaginatedColumnHelper<ReservationRow>();

// Spec 19/20 — les deux seules transitions que set_order_line_status autorise à l'operator sur une
// ligne encore 'reserved' (cf. commentaire de colonne "actions" plus bas), array-driven pour éviter
// la copie quasi identique des deux boutons (seuls targetStatus/label/testIdPrefix diffèrent).
const RESERVATION_ROW_ACTIONS: {
  targetStatus: "no_show" | "cancelled_by_provider";
  label: string;
  testIdPrefix: string;
}[] = [
  { targetStatus: "no_show", label: "Cliente no vino", testIdPrefix: "no-show-button" },
  { targetStatus: "cancelled_by_provider", label: "Cancelar", testIdPrefix: "cancel-button" },
];

// Spec 17 §0 Tranche 1 — restaure « Mis Reservas » (v1, docs/2-reference/02-app-partner.md),
// absente de v2 jusqu'ici. PII MINIMALE : holderName seul (jamais téléphone ni email — structurel,
// pas juste une omission de colonne : order_lines.holder_name est la SEULE PII exposée par la RLS
// operator, cf. migration 20260817180000). Client-side (100 lignes max, cf. page.tsx) — même
// patron que CommissionsTable, pas de pagination serveur pour un jeu de données borné.
//
// Spec 19 §0 Tranche 0 (2026-08-18) — colonne d'action « Cliente no vino » ajoutée : seule
// transition que set_order_line_status autorise désormais à l'operator (scopée no_show, migration
// 20260818150000), visible uniquement sur une ligne encore 'reserved' (les autres statuts sont
// déjà terminaux). État local (useState) introduit ici pour refléter le changement de statut sans
// re-fetch complet — même mécanisme que ReconciliationList/LedgerList (admin).
//
// Spec 20 §0 (2026-08-18) — colonne « Ver ficha » ajoutée (lien vers /partner/reservations/[id],
// nouveau, cf. spec 20 §5) ; bouton « Cancelar » ajouté à côté de « Cliente no vino » depuis
// l'élargissement d'autorisation cancelled_by_provider (migration 20260818180000) —
// SetOrderLineStatusDialog généralisé remplace NoShowDialog.
export function ReservationsTable({ rows: initialRows }: { rows: ReservationRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [statusDialog, setStatusDialog] = useState<
    { orderLineId: string; targetStatus: "no_show" | "cancelled_by_provider" } | null
  >(null);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("date", { header: "Fecha" }),
        columnHelper.accessor("productName", { header: "Producto", enableSorting: false }),
        columnHelper.accessor("establishmentName", { header: "Establecimiento", enableSorting: false }),
        columnHelper.accessor("holderName", { header: "Titular", enableSorting: false }),
        columnHelper.accessor("qty", { header: "Cant." }),
        columnHelper.accessor("totalCop", {
          header: "Monto",
          cell: (info) => formatCop(info.getValue()),
        }),
        columnHelper.accessor("status", {
          header: "Estado",
          cell: (info) => (
            <Chip
              variant="soft"
              color={STATUS_CHIP_COLOR[info.getValue()] ?? "default"}
              data-testid={`reservation-status-${info.row.original.id}`}
            >
              {STATUS_LABELS[info.getValue()] ?? info.getValue()}
            </Chip>
          ),
        }),
        columnHelper.display({
          id: "view",
          header: "",
          cell: (info) => (
            <Link
              href={`/partner/reservations/${info.row.original.id}`}
              className="text-sm font-medium hover:underline"
              data-testid={`view-reservation-link-${info.row.original.id}`}
            >
              Ver ficha
            </Link>
          ),
        }),
        columnHelper.display({
          id: "actions",
          header: "",
          cell: (info) =>
            info.row.original.status === "reserved" ? (
              <div className="flex gap-2">
                {RESERVATION_ROW_ACTIONS.map((action) => (
                  <Button
                    key={action.targetStatus}
                    size="sm"
                    variant="outline"
                    data-testid={`${action.testIdPrefix}-${info.row.original.id}`}
                    onPress={() =>
                      setStatusDialog({
                        orderLineId: info.row.original.id,
                        targetStatus: action.targetStatus,
                      })
                    }
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            ) : null,
        }),
      ]),
    []
  );

  const table = useTable({
    features: sortablePaginatedTableFeatures,
    columns,
    data: rows,
    initialState: {
      sorting: [{ id: "date", desc: true }],
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <SortablePaginatedTable
        table={table}
        rowCount={rows.length}
        getRowTestId={(row) => `reservation-row-${row.id}`}
        emptyMessage="Ninguna reserva todavía."
        emptyTestId="no-reservations"
      />

      {statusDialog ? (
        <SetOrderLineStatusDialog
          orderLineId={statusDialog.orderLineId}
          targetStatus={statusDialog.targetStatus}
          open={statusDialog !== null}
          onOpenChange={(open) => {
            if (!open) setStatusDialog(null);
          }}
          onSuccess={() => {
            const updatedId = statusDialog.orderLineId;
            const newStatus = statusDialog.targetStatus;
            setRows((prev) =>
              prev.map((row) => (row.id === updatedId ? { ...row, status: newStatus } : row))
            );
          }}
        />
      ) : null}
    </div>
  );
}
