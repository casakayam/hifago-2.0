"use client";

import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
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

export type BlockQueryRow = {
  id: string;
  start_date: string;
  end_date: string;
  order_line: {
    order: { holder_name: string } | null;
    product: { name: unknown } | null;
  } | null;
};

export function AvailabilityBlocksTable({ blocks }: { blocks: BlockQueryRow[] }) {
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
                {block.start_date} → {block.end_date}
              </SimpleTableCell>
              <SimpleTableCell data-label="Campamento">
                {resolveLocalizedField(asLocalizedField(block.order_line?.product?.name), "es") ?? "—"}
              </SimpleTableCell>
              <SimpleTableCell data-label="Titular">
                {block.order_line?.order?.holder_name ?? "—"}
              </SimpleTableCell>
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
