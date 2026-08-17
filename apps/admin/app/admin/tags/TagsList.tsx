"use client";

import { DataList, type DataListAction, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { RenameTagButton } from "./RenameTagButton";
import { TAGS_FILTERS } from "@/lib/lists/filters";

export type TagRow = {
  id: string;
  label: string;
  usageCount: number;
  createdAt: string;
};

export type TagsListProps = {
  rows: TagRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Eliminar sur la liste (décision
// Jérôme) : DeleteTagButton reste exclusivement sur la fiche /admin/tags/[id].
export function TagsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: TagsListProps) {
  const columns: DataListColumn<TagRow>[] = [
    { id: "label", header: "Etiqueta", sortable: true },
    { id: "usageCount", header: "Actividades" },
    {
      id: "created_at",
      header: "Creada",
      sortable: true,
      cell: (row) => new Date(row.createdAt).toLocaleDateString("es"),
    },
  ];

  const actions: DataListAction<TagRow>[] = [
    viewAction("/admin/tags", "tag"),
    {
      id: "edit",
      label: "Editar",
      render: (row) => <RenameTagButton tagId={row.id} currentLabel={row.label} />,
    },
  ];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/tags"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={TAGS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Etiquetas"
      rowTestIdPrefix="tag"
      emptyMessage="Ninguna etiqueta todavía."
      emptyTestId="no-tags"
    />
  );
}
