"use client";

import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "@hifago/ui";

// Extrait de page.tsx (Server Component) — importer @hifago/ui directement depuis un page.tsx/
// layout.tsx casse la collecte de page data au build ("(0, g.createContext) is not a function",
// constaté empiriquement le 2026-08-20 en ajoutant AppNavShell au barrel) ; même patron que
// LedgerLinesTable.tsx (../../orders/[id]) : page.tsx ne fait plus que fetcher et passer les données.

export type AvailabilityBlockRow = {
  id: string;
  startDate: string;
  endDate: string;
  productName: string;
  holderName: string;
};

export function AvailabilityBlocksTable({ blocks }: { blocks: AvailabilityBlockRow[] }) {
  return (
    <SimpleTable data-testid="availability-blocks-table" aria-label="Causa de los bloqueos">
      <SimpleTableHeader>
        <SimpleTableRow>
          <SimpleTableHead>Plaza</SimpleTableHead>
          <SimpleTableHead>Campamento</SimpleTableHead>
          <SimpleTableHead>Titular</SimpleTableHead>
        </SimpleTableRow>
      </SimpleTableHeader>
      <SimpleTableBody>
        {blocks.length > 0 ? (
          blocks.map((block) => (
            <SimpleTableRow key={block.id} data-testid={`availability-block-row-${block.id}`}>
              <SimpleTableCell data-label="Plaza">
                {block.startDate} → {block.endDate}
              </SimpleTableCell>
              <SimpleTableCell data-label="Campamento">{block.productName}</SimpleTableCell>
              <SimpleTableCell data-label="Titular">{block.holderName}</SimpleTableCell>
            </SimpleTableRow>
          ))
        ) : (
          <SimpleTableRow>
            <SimpleTableCell colSpan={3} className="text-center text-muted">
              Ningún bloqueo todavía.
            </SimpleTableCell>
          </SimpleTableRow>
        )}
      </SimpleTableBody>
    </SimpleTable>
  );
}
