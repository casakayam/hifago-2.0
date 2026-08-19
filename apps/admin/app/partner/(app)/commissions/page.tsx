import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { CommissionsTable, type CommissionRow } from "./CommissionsTable";

// Spec 19 §0 Tranche 0 — lit désormais le vrai ledger_entries (RLS ledger_entries_select_referrer,
// 20260818120000) au lieu de dériver un état depuis order_lines.status (deriveLedgerEntry,
// pis-aller documenté comme tel avant que le ledger existe : « aucune colonne payée, le mécanisme
// de paiement n'existe pas dans ce backlog »). C'est le SEUL écran capable de montrer "Pagada" —
// un statut que la dérivation ne pouvait structurellement jamais produire.
type LedgerEntryQueryRow = {
  id: string;
  amount_cop: number;
  status: string;
  order_line: {
    date: string;
    total_cop: number;
    product: { name: unknown } | null;
  } | null;
};

export default async function PartnerCommissionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/commissions");
  }

  // partner_id_for_account (même RPC que partner/products/page.tsx) — pas une jointure manuelle.
  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  // Filtre explicite sur referrer_partner_id ET beneficiary_type, au-delà de la RLS : cet écran ne
  // montre jamais une entrée establishment_compensation (même si elle existait — ce compte n'en a
  // structurellement pas, mais l'intention doit rester explicite, pas seulement implicite via RLS).
  const { data: entries } = await supabase
    .from("ledger_entries")
    .select(
      `id, amount_cop, status,
       order_line:order_lines(date, total_cop, product:products(name))`
    )
    .eq("beneficiary_type", "referrer")
    .eq("referrer_partner_id", partnerId ?? "")
    .order("created_at", { ascending: false })
    .returns<LedgerEntryQueryRow[]>();

  // amount_cop = referrer_commission_cop snapshoté à la création (create_order), jamais recalculé
  // par les transitions ultérieures (seul status change) — la table montre donc toujours le
  // montant d'origine, y compris sur une ligne void/reversed (« ce qui aurait été dû »), pas 0.
  const rows: CommissionRow[] = (entries ?? []).map((entry) => ({
    id: entry.id,
    date: entry.order_line?.date ?? "",
    productName: resolveLocalizedField(asLocalizedField(entry.order_line?.product?.name), "es") ?? "—",
    totalCop: entry.order_line?.total_cop ?? 0,
    referrerCommissionCop: entry.amount_cop,
    state: entry.status as CommissionRow["state"],
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis comisiones</h1>
      <CommissionsTable rows={rows} />
    </div>
  );
}
