"use client";

import { formatCop } from "@hifago/domain";
import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "@hifago/ui";
import { StatusChip } from "@/components/status-chip";
import { ORDER_LINE_STATUS_CHIP_STYLE } from "@/lib/lists/filters";
import { STATUS_LABELS } from "@/app/admin/orders/statusLabels";
import {
  PAYMENT_PROVIDER_STATUS_CHIP_STYLE,
  PAYMENT_PROVIDER_STATUS_LABELS,
  PAYMENT_STATUS_CHIP_STYLE,
  PAYMENT_STATUS_LABELS,
} from "../paymentStatusLabels";

export type ClientOrderLineRow = {
  id: string;
  establishmentName: string;
  productName: string;
  date: string;
  endDate: string | null;
  qty: number;
  status: string;
  totalCop: number;
};

export type ClientOrderCardProps = {
  orderId: string;
  createdAtLabel: string;
  referrerDisplayName: string | null;
  paymentStatus: string;
  payment: { status: string; amountCop: number; payerEmail: string | null } | null;
  lines: ClientOrderLineRow[];
};

// Revue admin clientes (Jérôme, 2026-08-19) — extrait en composant "use client" dédié : un Server
// Component qui construit lui-même un <SimpleTable>/<StatusChip> plante à l'évaluation du module
// ("createContext is not a function", reproduit par `next build`, jamais visible au typecheck/lint
// ni en dev tant que la page n'est pas réellement rendue) — même classe de piège que celui déjà
// documenté pour Recharts (hifago/CLAUDE.md §11.6) : passer les données déjà résolues (jsonb
// localisé déjà extrait côté serveur) à un composant client dédié qui, lui, CONSTRUIT l'élément.
export function ClientOrderCard({
  orderId,
  createdAtLabel,
  referrerDisplayName,
  paymentStatus,
  payment,
  lines,
}: ClientOrderCardProps) {
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border p-4"
      data-testid={`client-order-${orderId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Pedido del {createdAtLabel} · Referente: {referrerDisplayName ?? "Directo"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            status={paymentStatus}
            map={PAYMENT_STATUS_CHIP_STYLE}
            labels={PAYMENT_STATUS_LABELS}
            testId={`payment-status-${orderId}`}
          />
          {payment ? (
            <StatusChip
              status={payment.status}
              map={PAYMENT_PROVIDER_STATUS_CHIP_STYLE}
              labels={PAYMENT_PROVIDER_STATUS_LABELS}
              testId={`payment-provider-status-${orderId}`}
            />
          ) : null}
        </div>
      </div>

      <p className="text-sm" data-testid={`payment-detail-${orderId}`}>
        {payment
          ? `${formatCop(payment.amountCop)} · ${payment.payerEmail ?? "email no registrado"}`
          : "Sin pago registrado."}
      </p>

      <SimpleTable aria-label={`Actividades del pedido ${orderId}`}>
        <SimpleTableHeader>
          <SimpleTableRow>
            <SimpleTableHead>Establecimiento</SimpleTableHead>
            <SimpleTableHead>Producto</SimpleTableHead>
            <SimpleTableHead>Fecha</SimpleTableHead>
            <SimpleTableHead>Cantidad</SimpleTableHead>
            <SimpleTableHead>Estado</SimpleTableHead>
            <SimpleTableHead>Monto</SimpleTableHead>
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody>
          {lines.length > 0 ? (
            lines.map((line) => (
              <SimpleTableRow key={line.id} data-testid={`client-order-line-${line.id}`}>
                <SimpleTableCell data-label="Establecimiento">{line.establishmentName}</SimpleTableCell>
                <SimpleTableCell data-label="Producto">{line.productName}</SimpleTableCell>
                <SimpleTableCell data-label="Fecha">
                  {line.date}
                  {line.endDate ? ` → ${line.endDate}` : ""}
                </SimpleTableCell>
                <SimpleTableCell data-label="Cantidad">{line.qty}</SimpleTableCell>
                <SimpleTableCell data-label="Estado">
                  <StatusChip
                    status={line.status}
                    map={ORDER_LINE_STATUS_CHIP_STYLE}
                    labels={STATUS_LABELS}
                    testId={`client-order-line-status-${line.id}`}
                  />
                </SimpleTableCell>
                <SimpleTableCell data-label="Monto">{formatCop(line.totalCop)}</SimpleTableCell>
              </SimpleTableRow>
            ))
          ) : (
            <SimpleTableRow>
              <SimpleTableCell colSpan={6} className="text-center text-muted">
                Ninguna línea en este pedido.
              </SimpleTableCell>
            </SimpleTableRow>
          )}
        </SimpleTableBody>
      </SimpleTable>
    </div>
  );
}

