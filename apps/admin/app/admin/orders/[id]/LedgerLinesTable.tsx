"use client";

import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
import { Chip, SimpleTable, SimpleTableBody, SimpleTableCell, SimpleTableHead, SimpleTableHeader, SimpleTableRow } from "@hifago/ui";
import { deriveLedgerEntry, type LedgerState } from "@/lib/commission/deriveLedgerEntry";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "../statusLabels";

// Extrait de page.tsx (Server Component) — Table/Table.ScrollContainer de @hifago/ui imbriquant un
// <Chip> côté client crashait le build ("Table.Content n'accepte jamais... depuis un Server
// Component", cf. hifago/CLAUDE.md §11) ; migré vers SimpleTable (reflow carte sous md, règle
// transverse non négociable) au passage — page.tsx ne fait plus que fetcher et passer `lines`.

const LEDGER_STATE_LABELS: Record<LedgerState, string> = {
  estimated: "Estimado",
  earned: "Ganado",
  redistributed: "Redistribuido",
  voided: "Anulado",
};

const LEDGER_STATE_CHIP_COLOR: Record<
  LedgerState,
  "default" | "accent" | "success" | "warning" | "danger"
> = {
  estimated: "default",
  earned: "accent",
  redistributed: "warning",
  voided: "danger",
};

export type OrderLineQueryRow = {
  id: string;
  date: string;
  qty: number;
  status: string;
  total_cop: number;
  acompte_cop: number;
  referrer_commission_cop: number;
  app_commission_cop: number;
  commission_case: string;
  product: { name: unknown } | null;
};

export function LedgerLinesTable({ lines }: { lines: OrderLineQueryRow[] }) {
  return (
    <SimpleTable data-testid="ledger-table" aria-label="Detalle de la comisión por línea">
      <SimpleTableHeader>
        <SimpleTableRow>
          <SimpleTableHead>Producto</SimpleTableHead>
          <SimpleTableHead>Fecha</SimpleTableHead>
          <SimpleTableHead>Cantidad</SimpleTableHead>
          <SimpleTableHead>Estado</SimpleTableHead>
          <SimpleTableHead>Parte app</SimpleTableHead>
          <SimpleTableHead>Parte referente</SimpleTableHead>
          <SimpleTableHead>Parte prestador</SimpleTableHead>
          <SimpleTableHead>Estado de comisión</SimpleTableHead>
        </SimpleTableRow>
      </SimpleTableHeader>
      <SimpleTableBody>
        {lines.length > 0 ? (
          lines.map((line) => {
            const entry = deriveLedgerEntry({
              commissionCase: line.commission_case,
              totalCop: line.total_cop,
              acompteCop: line.acompte_cop,
              referrerCommissionCop: line.referrer_commission_cop,
              appCommissionCop: line.app_commission_cop,
              lineStatus: line.status,
            });
            return (
              <SimpleTableRow key={line.id} id={line.id} data-testid={`ledger-line-${line.id}`}>
                <SimpleTableCell data-label="Producto">
                  {resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—"}
                </SimpleTableCell>
                <SimpleTableCell data-label="Fecha">{line.date}</SimpleTableCell>
                <SimpleTableCell data-label="Cantidad">{line.qty}</SimpleTableCell>
                <SimpleTableCell data-label="Estado">
                  <Chip variant="soft" color={STATUS_CHIP_COLOR[line.status] ?? "default"}>
                    {STATUS_LABELS[line.status] ?? line.status}
                  </Chip>
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte app" data-testid={`app-due-${line.id}`}>
                  {formatCop(entry.appDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte referente" data-testid={`referrer-due-${line.id}`}>
                  {formatCop(entry.referrerDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte prestador" data-testid={`provider-due-${line.id}`}>
                  {formatCop(entry.providerDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Estado de comisión">
                  <Chip
                    variant="soft"
                    color={LEDGER_STATE_CHIP_COLOR[entry.state]}
                    data-testid={`ledger-state-${line.id}`}
                  >
                    {LEDGER_STATE_LABELS[entry.state]}
                  </Chip>
                </SimpleTableCell>
              </SimpleTableRow>
            );
          })
        ) : (
          <SimpleTableRow id="empty">
            <SimpleTableCell colSpan={8} className="text-center text-muted">
              Ninguna línea en este pedido.
            </SimpleTableCell>
          </SimpleTableRow>
        )}
      </SimpleTableBody>
    </SimpleTable>
  );
}
