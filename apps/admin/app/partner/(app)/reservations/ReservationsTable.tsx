"use client";

import { useState } from "react";
import {
  Button,
  Chip,
  DataList,
  type DataListAction,
  type DataListColumn,
  type DataListSort,
} from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { ContactClientButton } from "@/components/ContactClientButton";
import { RESERVATIONS_FILTERS } from "@/lib/lists/filters";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "@/app/admin/orders/statusLabels";
import { SetOrderLineStatusDialog } from "./SetOrderLineStatusDialog";

export type ReservationRow = {
  id: string;
  date: string;
  productName: string;
  establishmentName: string;
  holderName: string;
  holderPhone: string | null;
  holderEmail: string | null;
  qty: number;
  totalCop: number;
  status: string;
};

export type ReservationsTableProps = {
  rows: ReservationRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// Spec 17 §0 Tranche 1 (« Mis Reservas », v1) — restaurée puis étendue lors de la refonte vue
// prestataire (2026-08-19) : migration de SortablePaginatedTable (client-side, sans filtre, 100
// lignes max) vers DataList (pagination/tri serveur, filtres date/activité/nom/email, reflow mobile
// natif via data-label) — même patron que OrdersTable.tsx (admin/orders), écran pilote de la spec
// 10. rowTestIdPrefix reste "reservation" (convention historique de cet écran, préservée pour l'e2e
// existant qui cible `reservation-status-*` par préfixe).
//
// Spec 19/20 — les deux seules transitions que set_order_line_status autorise à l'operator sur une
// ligne encore 'reserved' (array-driven pour éviter la copie quasi identique des deux boutons).
const RESERVATION_ROW_ACTIONS: {
  targetStatus: "no_show" | "cancelled_by_provider";
  label: string;
  testIdPrefix: string;
}[] = [
  { targetStatus: "no_show", label: "Cliente no vino", testIdPrefix: "no-show-button" },
  { targetStatus: "cancelled_by_provider", label: "Cancelar", testIdPrefix: "cancel-button" },
];

export function ReservationsTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: ReservationsTableProps) {
  const [rowStatusOverrides, setRowStatusOverrides] = useState<Record<string, string>>({});
  const [statusDialog, setStatusDialog] = useState<
    { orderLineId: string; targetStatus: "no_show" | "cancelled_by_provider" } | null
  >(null);

  const effectiveRows = rows.map((row) => ({
    ...row,
    status: rowStatusOverrides[row.id] ?? row.status,
  }));

  const columns: DataListColumn<ReservationRow>[] = [
    { id: "date", header: "Fecha", sortable: true },
    { id: "productName", header: "Actividad" },
    { id: "establishmentName", header: "Establecimiento" },
    {
      id: "holder",
      header: "Cliente",
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.holderName}</span>
          <span className="text-xs text-muted">{row.holderPhone ?? "—"}</span>
        </div>
      ),
    },
    { id: "qty", header: "Cant.", sortable: true },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      cell: (row) => (
        <Chip
          variant="soft"
          color={STATUS_CHIP_COLOR[row.status] ?? "default"}
          data-testid={`reservation-status-${row.id}`}
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </Chip>
      ),
    },
    {
      id: "total_cop",
      header: "Monto",
      sortable: true,
      align: "right",
      cell: (row) => formatCop(row.totalCop),
    },
  ];

  const actions: DataListAction<ReservationRow>[] = [
    {
      id: "view",
      label: "Ver ficha",
      href: (row) => `/partner/reservations/${row.id}`,
      testId: (row) => `view-reservation-link-${row.id}`,
    },
    {
      id: "contact",
      label: "Contactar",
      render: (row) => (
        <ContactClientButton
          holderName={row.holderName}
          holderPhone={row.holderPhone}
          holderEmail={row.holderEmail}
        />
      ),
    },
    ...RESERVATION_ROW_ACTIONS.map(
      (action): DataListAction<ReservationRow> => ({
        id: action.targetStatus,
        label: action.label,
        isVisible: (row) => row.status === "reserved",
        render: (row) => (
          <Button
            size="sm"
            variant="outline"
            data-testid={`${action.testIdPrefix}-${row.id}`}
            onPress={() => setStatusDialog({ orderLineId: row.id, targetStatus: action.targetStatus })}
          >
            {action.label}
          </Button>
        ),
      })
    ),
  ];

  return (
    <>
      <DataList
        rows={effectiveRows}
        getRowId={(row) => row.id}
        columns={columns}
        actions={actions}
        rowHref={(row) => `/partner/reservations/${row.id}`}
        basePath="/partner/reservations"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        sort={sort}
        filters={RESERVATIONS_FILTERS}
        filterValues={filterValues}
        extraParams={extraParams}
        ariaLabel="Mis reservas"
        rowTestIdPrefix="reservation"
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
            setRowStatusOverrides((prev) => ({ ...prev, [updatedId]: newStatus }));
            setStatusDialog(null);
          }}
        />
      ) : null}
    </>
  );
}
