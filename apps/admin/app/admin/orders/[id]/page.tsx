import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { deriveLedgerEntry, type LedgerState } from "@/lib/commission/deriveLedgerEntry";
import { Chip, Table } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "../statusLabels";

// Vocabulaire de deriveLedgerEntry (feature 12) — distinct du statut de ligne (feature 8) : un
// chip pour CE QUI S'EST PASSÉ (reserved/fulfilled/...), un second pour CE QUE ÇA IMPLIQUE POUR LA
// COMMISSION (estimated/earned/redistributed/voided), jamais confondus dans une seule colonne.
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

type OrderLineQueryRow = {
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

export default async function AdminOrderDetailPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  // order et lines ne dépendent que de `id`, pas l'un de l'autre — un seul aller-retour réseau au
  // lieu de deux séquentiels. Aucune nouvelle policy : orders_select/order_lines_select (feature 6)
  // laissent déjà l'admin tout lire, cf. plan feature 12 ("aucun backend nouveau, comme la feature 9").
  const [{ data: order }, { data: lines }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, holder_name, holder_email, holder_phone, created_at, referrer:partners(display_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_lines")
      .select(
        `id, date, qty, status,
       total_cop, acompte_cop, referrer_commission_cop, app_commission_cop, commission_case,
       product:products(name)`
      )
      .eq("order_id", id)
      .order("date", { ascending: true })
      .returns<OrderLineQueryRow[]>(),
  ]);

  if (!order) {
    notFound();
  }

  // Feature 22 : une éventuelle entrée de la file de réconciliation liée à cette commande, via ses
  // order_lines (pas de colonne order_id directe sur pms_reconciliation_entries). Silencieux si
  // aucune entrée — pas une anomalie pour la plupart des commandes.
  const lineIds = (lines ?? []).map((line) => line.id);
  const { data: reconciliationEntries } =
    lineIds.length > 0
      ? await supabase
          .from("pms_reconciliation_entries")
          .select("id")
          .in("order_line_id", lineIds)
          .limit(1)
      : { data: null };
  const hasReconciliationEntry = (reconciliationEntries?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/orders" className="text-sm text-muted hover:underline">
          ← Pedidos
        </Link>
        <h1 className="text-2xl font-semibold">{order.holder_name}</h1>
        <p className="text-sm text-muted" data-testid="order-meta">
          Referente: {order.referrer?.display_name ?? "Directo"} · Creado el{" "}
          {new Date(order.created_at).toLocaleDateString("es")}
        </p>
        {hasReconciliationEntry ? (
          <Link
            href="/admin/reconciliation"
            className="text-sm text-accent hover:underline"
            data-testid="reconciliation-entry-link"
          >
            Ver entrada en la cola de reconciliación PMS
          </Link>
        ) : null}
      </div>

      <Table data-testid="ledger-table">
        <Table.ScrollContainer>
          <Table.Content aria-label="Detalle de la comisión por línea">
            <Table.Header>
              <Table.Column>Producto</Table.Column>
              <Table.Column>Fecha</Table.Column>
              <Table.Column>Cantidad</Table.Column>
              <Table.Column>Estado</Table.Column>
              <Table.Column>Parte app</Table.Column>
              <Table.Column>Parte referente</Table.Column>
              <Table.Column>Parte prestador</Table.Column>
              <Table.Column>Estado de comisión</Table.Column>
            </Table.Header>
            <Table.Body>
              {lines && lines.length > 0 ? (
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
                    <Table.Row key={line.id} id={line.id} data-testid={`ledger-line-${line.id}`}>
                      <Table.Cell>
                        {resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—"}
                      </Table.Cell>
                      <Table.Cell>{line.date}</Table.Cell>
                      <Table.Cell>{line.qty}</Table.Cell>
                      <Table.Cell>
                        <Chip variant="soft" color={STATUS_CHIP_COLOR[line.status] ?? "default"}>
                          {STATUS_LABELS[line.status] ?? line.status}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell data-testid={`app-due-${line.id}`}>
                        {formatCop(entry.appDueCop)}
                      </Table.Cell>
                      <Table.Cell data-testid={`referrer-due-${line.id}`}>
                        {formatCop(entry.referrerDueCop)}
                      </Table.Cell>
                      <Table.Cell data-testid={`provider-due-${line.id}`}>
                        {formatCop(entry.providerDueCop)}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip
                          variant="soft"
                          color={LEDGER_STATE_CHIP_COLOR[entry.state]}
                          data-testid={`ledger-state-${line.id}`}
                        >
                          {LEDGER_STATE_LABELS[entry.state]}
                        </Chip>
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              ) : (
                <Table.Row id="empty">
                  <Table.Cell colSpan={8} className="text-center text-muted">
                    Ninguna línea en este pedido.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
