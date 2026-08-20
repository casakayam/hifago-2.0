import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { COMMISSIONS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { COMMISSIONS_DEFAULT_SORT, COMMISSIONS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { CommissionsTable, type CommissionRow, type CommissionTotals } from "./CommissionsTable";

// Spec 19 §0 Tranche 0 — lit désormais le vrai ledger_entries (RLS ledger_entries_select_referrer,
// 20260818120000) au lieu de dériver un état depuis order_lines.status (deriveLedgerEntry,
// pis-aller documenté comme tel avant que le ledger existe : « aucune colonne payée, le mécanisme
// de paiement n'existe pas dans ce backlog »). C'est le SEUL écran capable de montrer "Pagada" —
// un statut que la dérivation ne pouvait structurellement jamais produire.
// Refonte vue référent (2026-08-20, docs/specs/22-vue-referent-restreinte.md) : nom d'établissement
// (holder_name/referrer_pct déjà des colonnes de order_lines, establishment via la même
// double-jointure product→establishment que reservations/page.tsx) — rien de nouveau côté schéma,
// seulement des colonnes déjà présentes jamais sélectionnées jusqu'ici.
type LedgerEntryQueryRow = {
  id: string;
  amount_cop: number;
  status: string;
  order_line: {
    date: string;
    total_cop: number;
    holder_name: string;
    referrer_pct: number;
    product: { name: unknown; establishment: { name: unknown } | null } | null;
  } | null;
};

// Filtres date/état + pagination/tri serveur (retour Jérôme, 2026-08-20), migré vers DataList
// (spec 10) — même patron que admin/orders/page.tsx/reservations/page.tsx, y compris la fiche
// détail `[id]/page.tsx` (le lien de ligne par défaut de DataList a besoin d'une vraie page à
// pointer). `order_lines!inner` (pas un simple `order_lines`) : nécessaire pour que `.gte`/`.lte`
// sur la colonne embarquée `order_line.date` fonctionne (PostgREST), même exigence que
// product:products!inner(...) dans reservations/page.tsx.
export default async function PartnerCommissionsPage({
  searchParams,
}: PageProps<"/partner/commissions">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/commissions");
  }

  // partner_id_for_account (même RPC que partner/products/page.tsx) — pas une jointure manuelle.
  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: COMMISSIONS_SORT_WHITELIST,
      defaultSort: COMMISSIONS_DEFAULT_SORT,
      filters: COMMISSIONS_FILTER_DEFINITIONS,
    }
  );

  // Filtre explicite sur referrer_partner_id ET beneficiary_type, au-delà de la RLS : cet écran ne
  // montre jamais une entrée establishment_compensation (même si elle existait — ce compte n'en a
  // structurellement pas, mais l'intention doit rester explicite, pas seulement implicite via RLS).
  let query = supabase
    .from("ledger_entries")
    .select(
      `id, amount_cop, status,
       order_line:order_lines!inner(date, total_cop, holder_name, referrer_pct,
         product:products(name, establishment:establishments(name)))`,
      { count: "exact" }
    )
    .eq("beneficiary_type", "referrer")
    .eq("referrer_partner_id", partnerId ?? "")
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.date_from) query = query.gte("order_line.date", filters.date_from);
  if (filters.date_to) query = query.lte("order_line.date", filters.date_to);
  if (filters.status) query = query.eq("status", filters.status);

  // Totaux agrégés sur TOUTES les entrées correspondant aux filtres actifs, pas seulement la page
  // affichée (DataList pagine réellement côté serveur) — requête dédiée, mêmes filtres, sans
  // pagination, 2 colonnes seulement (indépendante de la requête ci-dessus, donc parallélisée).
  let totalsQuery = supabase
    .from("ledger_entries")
    .select("amount_cop, status, order_line:order_lines!inner(date)")
    .eq("beneficiary_type", "referrer")
    .eq("referrer_partner_id", partnerId ?? "");
  if (filters.date_from) totalsQuery = totalsQuery.gte("order_line.date", filters.date_from);
  if (filters.date_to) totalsQuery = totalsQuery.lte("order_line.date", filters.date_to);
  if (filters.status) totalsQuery = totalsQuery.eq("status", filters.status);

  const [{ data: entries, count }, { data: totalsRows }] = await Promise.all([
    query.returns<LedgerEntryQueryRow[]>(),
    totalsQuery.returns<{ amount_cop: number; status: string }[]>(),
  ]);

  // amount_cop = referrer_commission_cop snapshoté à la création (create_order), jamais recalculé
  // par les transitions ultérieures (seul status change) — la table montre donc toujours le
  // montant d'origine, y compris sur une ligne void/reversed (« ce qui aurait été dû »), pas 0.
  const rows: CommissionRow[] = (entries ?? []).map((entry) => ({
    id: entry.id,
    date: entry.order_line?.date ?? "",
    productName: resolveLocalizedField(asLocalizedField(entry.order_line?.product?.name), "es") ?? "—",
    establishmentName:
      resolveLocalizedField(asLocalizedField(entry.order_line?.product?.establishment?.name), "es") ?? "—",
    holderName: entry.order_line?.holder_name ?? "—",
    referrerPct: entry.order_line?.referrer_pct ?? 0,
    totalCop: entry.order_line?.total_cop ?? 0,
    referrerCommissionCop: entry.amount_cop,
    state: entry.status as CommissionRow["state"],
  }));

  const totals: CommissionTotals = (totalsRows ?? []).reduce(
    (acc, row) => {
      if (row.status === "estimated") acc.estimated += row.amount_cop;
      if (row.status === "due") acc.due += row.amount_cop;
      if (row.status === "paid") acc.paid += row.amount_cop;
      if (row.status === "void") acc.void += row.amount_cop;
      return acc;
    },
    { estimated: 0, due: 0, paid: 0, void: 0 }
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis comisiones</h1>
      <CommissionsTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
        totals={totals}
      />
    </div>
  );
}
