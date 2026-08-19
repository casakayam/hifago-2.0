"use client";

import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import {
  Chip,
  createSortablePaginatedColumnHelper,
  SortablePaginatedTable,
  sortablePaginatedTableFeatures,
} from "@hifago/ui";
import { formatCop } from "@hifago/domain";

// Spec 19 §0 Tranche 0 — vocabulaire réel de ledger_entries.status (check constraint, migration
// 20260818120000), plus « Pagada » que l'ancienne dérivation (deriveLedgerEntry) ne pouvait
// structurellement jamais produire. Mapping direct sur l'ancien vocabulaire déjà validé
// (cahier des charges socio §3c) pour préserver les libellés déjà vus par les référents :
// estimated↔estimated, due↔« earned » (ganada, pas encore payée), void↔« redistributed »
// (redirigée au prestataire — no_show/cancelled_by_client), reversed↔« voided » (annulation
// prestataire, rien n'a été vendu).
export type CommissionRow = {
  id: string;
  date: string;
  productName: string;
  totalCop: number;
  referrerCommissionCop: number;
  state: "estimated" | "due" | "paid" | "reversed" | "void";
};

// Chip (pas Badge) : le Badge de HeroUI v3 est un indicateur d'ancrage pour Avatar/icône (dot ou
// compteur positionné via Badge.Anchor), pas une étiquette de statut autonome dans une cellule de
// tableau — Chip est l'équivalent direct de l'ancien Badge shadcn ici. `color` porte le sens
// sémantique de chaque état (success = acquis/payé, warning = réattribué ailleurs, danger = exclu,
// default = encore incertain) là où l'ancien variant shadcn n'était que visuel.
const STATE_META: Record<
  CommissionRow["state"],
  {
    label: string;
    variant: "primary" | "secondary" | "tertiary" | "soft";
    color: "default" | "accent" | "success" | "warning" | "danger";
  }
> = {
  estimated: { label: "Estimada", variant: "soft", color: "default" },
  due: { label: "Ganada, por pagar", variant: "primary", color: "success" },
  paid: { label: "Pagada", variant: "primary", color: "accent" },
  void: { label: "Reasignada al prestador", variant: "soft", color: "warning" },
  reversed: { label: "Excluida", variant: "soft", color: "danger" },
};

const columnHelper = createSortablePaginatedColumnHelper<CommissionRow>();

export function CommissionsTable({ rows }: { rows: CommissionRow[] }) {
  // 4 totaux agrégés, calculés à partir des lignes déjà chargées — pas une nouvelle requête.
  // "reversed" (Excluida, annulation prestataire) reste hors totaux, comme l'ancien "voided" —
  // rien n'est dû à personne dans ce cas, un total afficherait un montant qui n'existe pas.
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          if (row.state === "estimated") acc.estimated += row.referrerCommissionCop;
          if (row.state === "due") acc.due += row.referrerCommissionCop;
          if (row.state === "paid") acc.paid += row.referrerCommissionCop;
          if (row.state === "void") acc.void += row.referrerCommissionCop;
          return acc;
        },
        { estimated: 0, due: 0, paid: 0, void: 0 }
      ),
    [rows]
  );

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("date", { header: "Fecha" }),
        columnHelper.accessor("productName", { header: "Producto", enableSorting: false }),
        columnHelper.accessor("totalCop", {
          header: "Monto total",
          cell: (info) => formatCop(info.getValue()),
        }),
        columnHelper.accessor("referrerCommissionCop", {
          header: "Comisión referente",
          cell: (info) => (
            <span data-testid={`referrer-commission-${info.row.original.id}`}>
              {formatCop(info.getValue())}
            </span>
          ),
        }),
        columnHelper.accessor("state", {
          header: "Estado",
          cell: (info) => (
            <Chip
              variant={STATE_META[info.getValue()].variant}
              color={STATE_META[info.getValue()].color}
              data-testid={`commission-state-${info.row.original.id}`}
            >
              {STATE_META[info.getValue()].label}
            </Chip>
          ),
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
      pagination: { pageIndex: 0, pageSize: 10 },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="commission-totals">
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Estimado</p>
          <p className="text-lg font-semibold" data-testid="total-estimated">
            {formatCop(totals.estimated)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Ganado, por pagar</p>
          <p className="text-lg font-semibold" data-testid="total-earned">
            {formatCop(totals.due)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Pagado</p>
          <p className="text-lg font-semibold" data-testid="total-paid">
            {formatCop(totals.paid)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Reasignado</p>
          <p className="text-lg font-semibold" data-testid="total-redistributed">
            {formatCop(totals.void)}
          </p>
        </div>
      </div>

      <SortablePaginatedTable
        table={table}
        rowCount={rows.length}
        getRowTestId={(row) => `commission-row-${row.id}`}
        emptyMessage="Ninguna comisión todavía."
        emptyTestId="no-commissions"
      />
    </div>
  );
}
