import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ReconciliationList, type ReconciliationEntryRow } from "./ReconciliationList";
import {
  PaymentReconciliationList,
  type PaymentReconciliationEntryRow,
} from "./PaymentReconciliationList";

// Chemin de jointure observé dans lib/database.types.ts (cf. résumé de l'agent backend, feature
// 22) : pms_reconciliation_entries.order_line_id → order_lines.id, order_lines.order_id →
// orders.id, order_lines.product_id → products.id → products.establishment_id → establishments.id.
// Pas de raccourci direct order_lines → establishments, on transite par products à chaque fois.
type ReconciliationEntryQueryRow = {
  id: string;
  status: string;
  attempts: number;
  detail: string | null;
  order_line: {
    order_id: string;
    order: { holder_name: string } | null;
    product: { name: unknown; establishment: { name: unknown } | null } | null;
  } | null;
};

// payment_reconciliation_entries.payment_id → payments.id → orders.id (payment_id NULLABLE : un
// webhook rejeté avant corrélation n'a pas de paiement — l'entrée existe quand même, spec 19).
type PaymentReconciliationQueryRow = {
  id: string;
  kind: string;
  status: string;
  failure_reason: string;
  mp_payment_id: string | null;
  created_at: string;
  payment: {
    order_id: string;
    amount_cop: number;
    order: { reference: string; holder_name: string } | null;
  } | null;
  /** payment_refunds.entry_id → cette entrée (spec 39 D3) — au plus un vivant, l'historique reste. */
  refunds: { status: string; last_error: string | null; mp_refund_id: string | null; created_at: string }[];
};

/** Le remboursement à montrer : approved > pending > rejected (même priorité que le contrat client). */
function latestRefund(refunds: PaymentReconciliationQueryRow["refunds"]) {
  const rank = (s: string) => (s === "approved" ? 0 : s === "pending" ? 1 : 2);
  const chosen = [...refunds].sort(
    (a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at)
  )[0];
  return {
    refundStatus: chosen?.status ?? null,
    refundError: chosen?.last_error ?? null,
    refundMpId: chosen?.mp_refund_id ?? null,
  };
}

export default async function AdminReconciliationPage() {
  const supabase = await createClient();

  // Durcissement 20260920120000 : les exceptions de PAIEMENT enfin visibles ici (RLS
  // payment_reconciliation_entries_select_admin, payments_select_admin — lecture seule). Les plus
  // récentes d'abord : c'est l'entrée qui vient d'être créée que l'e-mail annonce.
  const { data: paymentEntries } = await supabase
    .from("payment_reconciliation_entries")
    .select(
      `id, kind, status, failure_reason, mp_payment_id, created_at,
       payment:payments(order_id, amount_cop, order:orders(reference, holder_name)),
       refunds:payment_refunds(status, last_error, mp_refund_id, created_at)`
    )
    .order("created_at", { ascending: false })
    .returns<PaymentReconciliationQueryRow[]>();

  const paymentRows: PaymentReconciliationEntryRow[] = (paymentEntries ?? []).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    failureReason: entry.failure_reason,
    mpPaymentId: entry.mp_payment_id,
    createdAt: entry.created_at,
    orderId: entry.payment?.order_id ?? null,
    orderReference: entry.payment?.order?.reference ?? null,
    holderName: entry.payment?.order?.holder_name ?? null,
    amountCop: entry.payment?.amount_cop ?? null,
    ...latestRefund(entry.refunds ?? []),
  }));

  // pms_reconciliation_entries_select_admin (feature 22) : seule policy, lecture seule, déjà
  // réservée admin — la garde de AdminLayout (feature 1) suffit ici, aucun filtre supplémentaire.
  const { data: entries } = await supabase
    .from("pms_reconciliation_entries")
    .select(
      `id, status, attempts, detail,
       order_line:order_lines(
         order_id,
         order:orders(holder_name),
         product:products(name, establishment:establishments(name))
       )`
    )
    .order("created_at", { ascending: true })
    .returns<ReconciliationEntryQueryRow[]>();

  const rows: ReconciliationEntryRow[] = (entries ?? []).map((entry) => ({
    id: entry.id,
    detail: entry.detail,
    status: entry.status,
    attempts: entry.attempts,
    orderId: entry.order_line?.order_id ?? "",
    holderName: entry.order_line?.order?.holder_name ?? "—",
    establishmentName:
      resolveLocalizedField(
        asLocalizedField(entry.order_line?.product?.establishment?.name),
        "es"
      ) ?? "—",
  }));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Reconciliación</h1>
      <section className="flex flex-col gap-4" aria-labelledby="reconciliation-pagos">
        <h2 id="reconciliation-pagos" className="text-xl font-semibold">
          Pagos
        </h2>
        <PaymentReconciliationList rows={paymentRows} />
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="reconciliation-pms">
        <h2 id="reconciliation-pms" className="text-xl font-semibold">
          PMS
        </h2>
        <ReconciliationList rows={rows} />
      </section>
    </div>
  );
}
