import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { deriveLedgerEntry } from "@/lib/commission/deriveLedgerEntry";
import { CommissionsTable, type CommissionRow } from "./CommissionsTable";

type OrderLineQueryRow = {
  id: string;
  date: string;
  status: string;
  total_cop: number;
  acompte_cop: number;
  referrer_commission_cop: number;
  app_commission_cop: number;
  commission_case: string;
  product: { name: unknown } | null;
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

  // Filtre explicite sur referrer_partner_id, au-delà de la RLS : order_lines_select (Tranche 3)
  // laisserait aussi remonter les lignes que ce compte a achetées lui-même comme simple client —
  // hors sujet ici, seules les lignes où CE partenaire est référent doivent apparaître.
  const { data: lines } = await supabase
    .from("order_lines")
    .select(
      `id, date, status, total_cop, acompte_cop, referrer_commission_cop, app_commission_cop,
       commission_case, product:products(name)`
    )
    .eq("referrer_partner_id", partnerId ?? "")
    .order("date", { ascending: false })
    .returns<OrderLineQueryRow[]>();

  // Colonne "part référent" affichée = le SNAPSHOT (referrer_commission_cop), pas
  // entry.referrerDueCop : deriveLedgerEntry ramène volontairement referrerDueCop à 0 sur une
  // ligne redistributed (c'est la valeur CORRECTE pour dire ce qui est dû aujourd'hui), mais la
  // table doit montrer le montant snapshoté d'origine — sinon rien ne distinguerait une ligne
  // "reprise" (part récupérée) d'une ligne "direct" (jamais de part référent du tout). Seul l'état
  // dérivé (estimated/earned/redistributed/voided) vient de deriveLedgerEntry ici ; sur estimated
  // et earned les deux valeurs sont de toute façon identiques (passthrough du snapshot).
  const rows: CommissionRow[] = (lines ?? []).map((line) => {
    const { state } = deriveLedgerEntry({
      commissionCase: line.commission_case,
      totalCop: line.total_cop,
      acompteCop: line.acompte_cop,
      referrerCommissionCop: line.referrer_commission_cop,
      appCommissionCop: line.app_commission_cop,
      lineStatus: line.status,
    });
    return {
      id: line.id,
      date: line.date,
      productName: resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—",
      totalCop: line.total_cop,
      referrerCommissionCop: line.referrer_commission_cop,
      state,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis comisiones</h1>
      <CommissionsTable rows={rows} />
    </div>
  );
}
