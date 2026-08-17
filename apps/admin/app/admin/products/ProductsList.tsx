"use client";

import { DataList, type DataListAction, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { PRODUCTS_FILTERS } from "@/lib/lists/filters";

export type ProductRow = {
  id: string;
  name: string;
  establishmentName: string;
  type: string;
  priceCop: number | null;
  sellable: boolean;
};

export type ProductsListProps = {
  rows: ProductRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — écran pilote (2e) : 1er vrai passage
// `Table` compound HeroUI -> `DataList`. Décision Jérôme : pas d'Eliminar sur la liste (action
// destructive trop accessible dans un groupe dense de boutons) — reste uniquement sur la fiche
// détail (/admin/products/[id], DeleteProductButton inchangé là-bas).
export function ProductsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: ProductsListProps) {
  const columns: DataListColumn<ProductRow>[] = [
    { id: "name", header: "Nombre", sortable: true },
    { id: "establishmentName", header: "Establecimiento" },
    { id: "type", header: "Tipo", sortable: true },
    {
      id: "price_cop",
      header: "Precio",
      sortable: true,
      align: "right",
      cell: (row) => formatCop(row.priceCop ?? 0),
    },
    {
      id: "sellable",
      header: "Estado",
      cell: (row) => (row.sellable ? "Publicado" : "Borrador"),
    },
  ];

  const actions: DataListAction<ProductRow>[] = [
    viewAction("/admin/products", "product"),
    {
      id: "edit",
      label: "Editar",
      href: (row) => `/admin/products/${row.id}/edit`,
      testId: (row) => `product-edit-link-${row.id}`,
    },
  ];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/products"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={PRODUCTS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Catálogo"
      rowTestIdPrefix="product"
      emptyMessage="Ningún producto todavía."
      emptyTestId="no-products"
    />
  );
}
