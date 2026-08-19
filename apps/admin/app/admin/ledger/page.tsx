import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { LedgerList, type LedgerEntryRow } from "./LedgerList";

// Spec 19 §0 Tranche 0 — écran admin minimal du ledger de règlement : liste + « marcar pagado ».
// Même patron de jointure que admin/reconciliation/page.tsx (order_line → order/product →
// establishment), étendu de la résolution du bénéficiaire (referrer_partner_id → partners, ou
// establishment_id → establishments selon beneficiary_type — jamais les deux à la fois, cf. check
// constraint ledger_entries_beneficiary_matches_type).
type LedgerEntryQueryRow = {
  id: string;
  beneficiary_type: string;
  entry_type: string;
  amount_cop: number;
  status: string;
  comprobante_path: string | null;
  note: string | null;
  created_at: string;
  order_line: {
    order: { holder_name: string } | null;
    product: { name: unknown; establishment: { name: unknown } | null } | null;
  } | null;
  referrer: { display_name: string } | null;
  establishment: { name: unknown } | null;
};

export default async function AdminLedgerPage() {
  const supabase = await createClient();

  // ledger_entries_select_admin (spec 19 §0 Tranche 0) : seule policy nécessaire, lecture seule —
  // la garde d'AdminLayout suffit, même raisonnement que reconciliation/page.tsx.
  const { data: entries } = await supabase
    .from("ledger_entries")
    .select(
      `id, beneficiary_type, entry_type, amount_cop, status, comprobante_path, note, created_at,
       order_line:order_lines(
         order:orders(holder_name),
         product:products(name, establishment:establishments(name))
       ),
       referrer:partners!ledger_entries_referrer_partner_id_fkey(display_name),
       establishment:establishments!ledger_entries_establishment_id_fkey(name)`
    )
    .order("created_at", { ascending: true })
    .returns<LedgerEntryQueryRow[]>();

  const rows: LedgerEntryRow[] = (entries ?? []).map((entry) => ({
    id: entry.id,
    beneficiaryType: entry.beneficiary_type,
    entryType: entry.entry_type,
    amountCop: entry.amount_cop,
    status: entry.status,
    comprobantePath: entry.comprobante_path,
    note: entry.note,
    holderName: entry.order_line?.order?.holder_name ?? "—",
    productName:
      resolveLocalizedField(asLocalizedField(entry.order_line?.product?.name), "es") ?? "—",
    beneficiaryName:
      entry.beneficiary_type === "referrer"
        ? (entry.referrer?.display_name ?? "—")
        : (resolveLocalizedField(asLocalizedField(entry.establishment?.name), "es") ?? "—"),
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ledger de liquidación</h1>
      <LedgerList rows={rows} />
    </div>
  );
}
