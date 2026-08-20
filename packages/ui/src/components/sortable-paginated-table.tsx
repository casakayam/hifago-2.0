"use client";

import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  type ReactTable,
  type RowData,
} from "@tanstack/react-table";
import { Button } from "@heroui/react";
import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "./simple-table";

/**
 * Extrait de ReservationsTable.tsx / CommissionsTable.tsx (apps/admin/app/partner/(app)) — les deux
 * tables client-side y étaient identiques à ~80 lignes près (features config, en-tête triable avec
 * flèche, corps, pagination Anterior/Siguiente, état vide). PAS le patron `DataList` de ce même
 * fichier de composants, qui lui est piloté par l'URL avec `manualSorting`/`manualPagination` sur
 * un jeu de données déjà paginé serveur — un invariant différent, pas interchangeable avec du vrai
 * tri/pagination client (`createSortedRowModel`/`createPaginatedRowModel`) sur un jeu de données
 * borné chargé d'un coup.
 *
 * `sortablePaginatedTableFeatures` est volontairement un objet CONCRET (pas un générique
 * `TFeatures extends TableFeatures` sur le composant) : TanStack Table v9 n'expose
 * `getToggleSortingHandler`/`getCanSort`/`getIsSorted`/`previousPage`/`getCanNextPage`/etc. sur les
 * types `Column`/`Table` que lorsque les features qui les apportent (rowSortingFeature,
 * rowPaginationFeature) sont statiquement connues à la construction du type — un paramètre
 * générique non contraint les perd tous (constaté à la compilation en tentant la version
 * générique). D'où aussi `createSortablePaginatedColumnHelper` : chaque table appelante a des
 * colonnes/lignes différentes, mais doit dériver son `columnHelper` des MÊMES features que ce
 * composant attend dans `table`.
 */
export const sortablePaginatedTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

type SortablePaginatedFeatures = typeof sortablePaginatedTableFeatures;

export function createSortablePaginatedColumnHelper<TData extends RowData>() {
  return createColumnHelper<SortablePaginatedFeatures, TData>();
}

export type SortablePaginatedTableProps<TData extends RowData> = {
  table: ReactTable<SortablePaginatedFeatures, TData>;
  /** Nombre de lignes AVANT pagination (rows.length côté appelant) — décide de l'état vide. */
  rowCount: number;
  getRowTestId: (row: TData) => string;
  emptyMessage: string;
  emptyTestId?: string;
  ariaLabel?: string;
};

export function SortablePaginatedTable<TData extends RowData>({
  table,
  rowCount,
  getRowTestId,
  emptyMessage,
  emptyTestId,
  ariaLabel,
}: SortablePaginatedTableProps<TData>) {
  if (rowCount === 0) {
    return (
      <p data-testid={emptyTestId} className="text-sm text-muted">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SimpleTable aria-label={ariaLabel}>
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
            <SimpleTableRow key={row.id} data-testid={getRowTestId(row.original)}>
              {row.getAllCells().map((cell) => {
                const header = cell.column.columnDef.header;
                return (
                  <SimpleTableCell
                    key={cell.id}
                    // Reflow mobile (SimpleTableCell, max-md:) : même solution que DataList
                    // (col?.header ?? "") — un header défini comme fonction (render prop) plutôt
                    // qu'une chaîne dégrade proprement vers "" (pas de libellé), jamais un crash.
                    data-label={typeof header === "string" ? header : ""}
                  >
                    <table.FlexRender cell={cell} />
                  </SimpleTableCell>
                );
              })}
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
    </div>
  );
}
