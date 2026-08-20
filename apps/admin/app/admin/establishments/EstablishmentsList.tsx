"use client";

import { DataList, type DataListAction, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { ESTABLISHMENTS_FILTERS } from "@/lib/lists/filters";
import { EstablishmentStatusCell } from "./EstablishmentStatusCell";

export type EstablishmentRow = {
  id: string;
  name: string;
  partnerId: string;
  partnerName: string;
  status: string;
  activitiesCount: number;
  hasSharedResourceProducts: boolean;
  // Revue admin établissements (Jérôme, 2026-08-19) — calculés par list_establishments_admin,
  // rendus par EstablishmentStatusCell dans la cellule "Estado", jamais une nouvelle valeur de
  // establishments.status.
  pendingProposal: { id: string; kind: "edit" | "photos" } | null;
  operatorInactive: boolean;
};

export type EstablishmentsListProps = {
  rows: EstablishmentRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Eliminar : aucune RPC de
// suppression/archivage d'établissement n'existe.
export function EstablishmentsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: EstablishmentsListProps) {
  const columns: DataListColumn<EstablishmentRow>[] = [
    { id: "name", header: "Nombre", sortable: true },
    { id: "partnerName", header: "Partner" },
    { id: "status", header: "Estado", sortable: true, cell: (row) => <EstablishmentStatusCell row={row} /> },
    {
      id: "activitiesCount",
      header: "Actividades",
      cell: (row) => (
        <a href={`/admin/establishments/${row.id}`} className="hover:underline" data-testid={`activity-count-${row.id}`}>
          {row.activitiesCount} actividades
        </a>
      ),
    },
  ];

  const actions: DataListAction<EstablishmentRow>[] = [
    viewAction("/admin/establishments", "establishment", "Editar"),
    {
      id: "add-activity",
      label: "+ Actividad",
      href: (row) => `/admin/products/new?establishment=${row.id}`,
      testId: (row) => `add-activity-link-${row.id}`,
    },
    {
      id: "resource",
      label: "Recurso compartido",
      href: (row) => `/admin/establishments/${row.id}/resource`,
      testId: (row) => `resource-link-${row.id}`,
      // Spec 17 §0 Tranche 0 — la ressource partagée n'a de sens que pour un établissement qui
      // porte au moins un camp/evento (seuls types câblés sur provider_resource_calendar) ; masqué
      // sinon, plutôt qu'un lien vers un écran vide sans rapport avec l'établissement.
      isVisible: (row) => row.hasSharedResourceProducts,
    },
  ];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/establishments"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={ESTABLISHMENTS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Establecimientos"
      rowTestIdPrefix="establishment"
      emptyMessage="Ningún establecimiento todavía."
      emptyTestId="no-establishments"
    />
  );
}
