"use client";

import { DataList, type DataListAction, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { PARTNERS_FILTERS } from "@/lib/lists/filters";

export type PartnerRow = {
  id: string;
  displayName: string;
  status: string;
  activeRoles: string;
  establishmentsCount: number;
};

export type PartnersTableProps = {
  rows: PartnerRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Editar (aucune RPC
// update_partner) ; l'offboarding reste réservé à la fiche détail (/admin/partners/[id]),
// jamais remonté comme action de ligne — même principe que l'absence d'Eliminar sur les listes.
export function PartnersTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: PartnersTableProps) {
  const columns: DataListColumn<PartnerRow>[] = [
    { id: "display_name", header: "Nombre", sortable: true, cell: (row) => row.displayName },
    { id: "status", header: "Estado", sortable: true },
    { id: "activeRoles", header: "Capacidades activas", cell: (row) => row.activeRoles || "—" },
    { id: "establishmentsCount", header: "Establecimientos" },
  ];

  const actions: DataListAction<PartnerRow>[] = [viewAction("/admin/partners", "partner")];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/partners"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={PARTNERS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Partners"
      rowTestIdPrefix="partner"
      emptyMessage="Ningún partner todavía."
      emptyTestId="no-partners"
    />
  );
}
