"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  Button,
  buttonVariants,
  Chip,
  ListBox,
  Select,
  ServerPagination,
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { ChangeStatusDialog } from "./ChangeStatusDialog";
import { STATUS_CHIP_COLOR, STATUS_LABELS } from "./statusLabels";

export type OrderLineRow = {
  id: string;
  orderId: string;
  date: string;
  qty: number;
  status: string;
  productName: string;
  establishmentName: string;
  holderName: string;
  holderPhone: string | null;
  referrerName: string;
  amount: number;
};

export type OrdersTableProps = {
  rows: OrderLineRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  statusFilter: string | null;
};

// TanStack Table v9 : les fonctionnalités sont des plugins enregistrés explicitement via
// tableFeatures, pas des options passées à useTable comme en v8. Retrofit pagination/filtre
// serveur (G15, spec 02 §10) : `rows` est déjà LA page courante (déjà filtrée par statut côté
// serveur) — plus de rowPaginationFeature ici, seul le TRI reste côté client, sur cette page
// seule (repli documenté dans la spec, trier côté serveur aurait exigé manualSorting complet).
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});

const columnHelper = createColumnHelper<typeof features, OrderLineRow>();

export function OrdersTable({ rows, page, pageSize, totalCount, statusFilter }: OrdersTableProps) {
  const router = useRouter();
  const [dialogRowId, setDialogRowId] = useState<string | null>(null);

  function handleStatusFilterChange(value: string) {
    const params = new URLSearchParams();
    if (value !== "all") params.set("status", value);
    params.set("page", "1");
    router.push(`/admin/orders?${params.toString()}`);
  }

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("date", { header: "Fecha" }),
        columnHelper.accessor("productName", { header: "Producto", enableSorting: false }),
        columnHelper.accessor("establishmentName", {
          header: "Establecimiento",
          enableSorting: false,
        }),
        columnHelper.accessor("qty", { header: "Cantidad" }),
        columnHelper.accessor("status", {
          header: "Estado",
          cell: (info) => (
            <Chip
              variant="soft"
              color={STATUS_CHIP_COLOR[info.getValue()] ?? "default"}
              data-testid={`status-badge-${info.row.original.id}`}
            >
              {STATUS_LABELS[info.getValue()] ?? info.getValue()}
            </Chip>
          ),
        }),
        columnHelper.display({
          id: "holder",
          header: "Titular",
          cell: (info) => (
            <div className="flex flex-col">
              <span>{info.row.original.holderName}</span>
              <span className="text-xs text-muted">{info.row.original.holderPhone ?? "—"}</span>
            </div>
          ),
        }),
        // Première fois que referrer_partner_id (feature 7) est réellement affiché — "Directo" sinon.
        columnHelper.accessor("referrerName", { header: "Referente", enableSorting: false }),
        columnHelper.accessor("amount", {
          header: "Monto",
          cell: (info) => formatCop(info.getValue()),
        }),
        columnHelper.display({
          id: "actions",
          header: "",
          cell: (info) => (
            <div className="flex gap-2">
              <Link
                href={`/admin/orders/${info.row.original.orderId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                data-testid={`view-order-link-${info.row.original.orderId}`}
              >
                Ver pedido
              </Link>
              <Button
                size="sm"
                variant="outline"
                data-testid={`change-status-button-${info.row.original.id}`}
                onPress={() => setDialogRowId(info.row.original.id)}
              >
                Cambiar estado
              </Button>
            </div>
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
      // Tri par défaut : date de service croissante (les prochaines échéances en premier — usage
      // « préparation »), pas la date de création de la commande. S'applique à la page courante
      // seulement (le serveur trie déjà par date pour construire cette page).
      sorting: [{ id: "date", desc: false }],
    },
  });

  if (totalCount === 0) {
    return (
      <p data-testid="no-orders" className="text-sm text-muted">
        Ningún pedido todavía.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Select
        className="w-56"
        aria-label="Filtrar por estado"
        value={statusFilter ?? "all"}
        onChange={(value) => handleStatusFilterChange(value ? String(value) : "all")}
      >
        <Select.Trigger data-testid="status-filter-select">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="all" textValue="Todos los estados">
              Todos los estados
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <ListBox.Item key={value} id={value} textValue={label}>
                {label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

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
            <SimpleTableRow key={row.id} data-testid={`order-line-row-${row.original.id}`}>
              {row.getAllCells().map((cell) => (
                <SimpleTableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </SimpleTableCell>
              ))}
            </SimpleTableRow>
          ))}
        </SimpleTableBody>
      </SimpleTable>

      <ServerPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/admin/orders"
        extraParams={statusFilter ? { status: statusFilter } : undefined}
      />

      {dialogRowId ? (
        <ChangeStatusDialog
          orderLineId={dialogRowId}
          open={dialogRowId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogRowId(null);
          }}
          onSuccess={() => {
            // Retrofit pagination serveur : `rows` est désormais dérivée du serveur (page +
            // filtre), plus un état local à corriger optimistiquement — un vrai refetch de la
            // page courante reste correct même si le nouveau statut sort la ligne du filtre actif.
            setDialogRowId(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
