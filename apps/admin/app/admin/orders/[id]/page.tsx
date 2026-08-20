import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { LedgerLinesTable, type OrderLineQueryRow } from "./LedgerLinesTable";

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

      <LedgerLinesTable lines={lines ?? []} />
    </div>
  );
}
