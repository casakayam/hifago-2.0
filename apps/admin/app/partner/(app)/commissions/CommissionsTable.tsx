"use client";

import { useMemo } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  Button,
  Chip,
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "@hifago/ui";
import type { LedgerState } from "@/lib/commission/deriveLedgerEntry";
import { formatCop } from "@hifago/domain";

export type CommissionRow = {
  id: string;
  date: string;
  productName: string;
  totalCop: number;
  referrerCommissionCop: number;
  state: LedgerState;
};

// Vocabulaire du référent (cahier des charges socio §3c) — distinct du vocabulaire admin (feature
// 12) pour les 4 mêmes états de deriveLedgerEntry : seul le libellé change selon qui regarde,
// jamais la logique de dérivation (cf. plan feature 14).
// Chip (pas Badge) : le Badge de HeroUI v3 est un indicateur d'ancrage pour Avatar/icône (dot ou
// compteur positionné via Badge.Anchor), pas une étiquette de statut autonome dans une cellule de
// tableau — Chip est l'équivalent direct de l'ancien Badge shadcn ici. `color` porte le sens
// sémantique de chaque état (success = acquis, warning = réattribué ailleurs, danger = exclu,
// default = encore incertain) là où l'ancien variant shadcn n'était que visuel.
const STATE_META: Record<
  LedgerState,
  {
    label: string;
    variant: "primary" | "secondary" | "tertiary" | "soft";
    color: "default" | "accent" | "success" | "warning" | "danger";
  }
> = {
  estimated: { label: "Estimada", variant: "soft", color: "default" },
  earned: { label: "Ganada, por pagar", variant: "primary", color: "success" },
  redistributed: { label: "Reasignada al prestador", variant: "soft", color: "warning" },
  voided: { label: "Excluida", variant: "soft", color: "danger" },
};

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, CommissionRow>();

export function CommissionsTable({ rows }: { rows: CommissionRow[] }) {
  // 3 totaux agrégés, calculés à partir des lignes déjà chargées — pas une nouvelle requête (cf.
  // plan). "Reasignada" n'est volontairement pas un 4e total : ce backlog ne définit que ces 3
  // (estimé / acquis à payer / repris).
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          if (row.state === "estimated") acc.estimated += row.referrerCommissionCop;
          if (row.state === "earned") acc.earned += row.referrerCommissionCop;
          if (row.state === "redistributed") acc.redistributed += row.referrerCommissionCop;
          return acc;
        },
        { estimated: 0, earned: 0, redistributed: 0 }
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
    features,
    columns,
    data: rows,
    initialState: {
      sorting: [{ id: "date", desc: true }],
      pagination: { pageIndex: 0, pageSize: 10 },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4" data-testid="commission-totals">
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Estimado</p>
          <p className="text-lg font-semibold" data-testid="total-estimated">
            {formatCop(totals.estimated)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Ganado, por pagar</p>
          <p className="text-lg font-semibold" data-testid="total-earned">
            {formatCop(totals.earned)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Reasignado</p>
          <p className="text-lg font-semibold" data-testid="total-redistributed">
            {formatCop(totals.redistributed)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p data-testid="no-commissions" className="text-sm text-muted">
          Ninguna comisión todavía.
        </p>
      ) : (
        <>
          <SimpleTable>
            <SimpleTableHeader>
              {table.getHeaderGroups().map((group) => (
                <SimpleTableRow key={group.id}>
                  {group.headers.map((header) => (
                    <SimpleTableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className="flex items-center gap-1 disabled:cursor-default"
                          onClick={header.column.getToggleSortingHandler()}
                          disabled={!header.column.getCanSort()}
                          data-testid={`sort-${header.column.id}`}
                        >
                          <table.FlexRender header={header} />
                          {header.column.getIsSorted() === "asc" ? "↑" : null}
                          {header.column.getIsSorted() === "desc" ? "↓" : null}
                        </button>
                      )}
                    </SimpleTableHead>
                  ))}
                </SimpleTableRow>
              ))}
            </SimpleTableHeader>
            <SimpleTableBody>
              {table.getRowModel().rows.map((row) => (
                <SimpleTableRow key={row.id} data-testid={`commission-row-${row.original.id}`}>
                  {row.getAllCells().map((cell) => (
                    <SimpleTableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </SimpleTableCell>
                  ))}
                </SimpleTableRow>
              ))}
            </SimpleTableBody>
          </SimpleTable>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onPress={() => table.previousPage()}
              isDisabled={!table.getCanPreviousPage()}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              onPress={() => table.nextPage()}
              isDisabled={!table.getCanNextPage()}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
