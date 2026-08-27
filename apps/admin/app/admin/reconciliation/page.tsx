import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ReconciliationList, type ReconciliationEntryRow } from "./ReconciliationList";

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

export default async function AdminReconciliationPage() {
  const supabase = await createClient();

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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Reconciliación PMS</h1>
      <ReconciliationList rows={rows} />
    </div>
  );
}
