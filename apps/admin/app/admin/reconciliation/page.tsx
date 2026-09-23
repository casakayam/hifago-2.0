import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ReconciliationList, type ReconciliationEntryRow } from "./ReconciliationList";

type ReconciliationEntryQueryRow = {
  id: string;
  status: string;
  attempts: number;
  detail: string | null;
  order_line_id: string;
};

export default async function AdminReconciliationPage() {
  const supabase = await createClient();

  // pms_reconciliation_entries_select_admin (feature 22) : seule policy, lecture seule, déjà
  // réservée admin — la garde de AdminLayout (feature 1) suffit ici, aucun filtre supplémentaire.
  const { data: entries } = await supabase
    .from("pms_reconciliation_entries")
    .select("id, status, attempts, detail, order_line_id")
    .order("created_at", { ascending: true })
    .returns<ReconciliationEntryQueryRow[]>();

  // Identité de la commande/produit : jamais un embed PostgREST direct vers order_lines (fuite des
  // colonnes de commission, docs/backlog.md) — une RPC admin étroite, partagée avec la page
  // ressource d'établissement (admin_order_line_summaries, 20260922140000).
  const orderLineIds = [...new Set((entries ?? []).map((entry) => entry.order_line_id))];
  const { data: summaries } = await supabase.rpc("admin_order_line_summaries", {
    p_order_line_ids: orderLineIds,
  });
  const summaryByLineId = new Map((summaries ?? []).map((summary) => [summary.order_line_id, summary]));

  const rows: ReconciliationEntryRow[] = (entries ?? []).map((entry) => {
    const summary = summaryByLineId.get(entry.order_line_id);
    return {
      id: entry.id,
      detail: entry.detail,
      status: entry.status,
      attempts: entry.attempts,
      orderId: summary?.order_id ?? "",
      holderName: summary?.holder_name ?? "—",
      establishmentName: resolveLocalizedField(asLocalizedField(summary?.establishment_name), "es") ?? "—",
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Reconciliación PMS</h1>
      <ReconciliationList rows={rows} />
    </div>
  );
}
