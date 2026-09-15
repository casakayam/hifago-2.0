import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { LEDGER_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { LEDGER_DEFAULT_SORT, LEDGER_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { LedgerTable, type LedgerRow } from "./LedgerTable";
import type { EstablishmentOption, ReferrerOption } from "./LedgerFilterBar";

// Refonte /admin/ledger (docs/specs/10-listes-standardisees-admin-socio.md) — remplace l'ancien
// fetch unique non filtré/non paginé par le même patron que admin/orders et partner/commissions :
// resolveListParams + requête paginée/triée côté serveur.
type LedgerEntryQueryRow = {
  id: string;
  amount_cop: number;
  status: string;
  order_line: {
    date: string;
    product: { type: string; name: unknown; establishment: { name: unknown } | null } | null;
  } | null;
  referrer: { display_name: string } | null;
};

export default async function AdminLedgerPage({
  searchParams,
}: PageProps<"/admin/ledger">) {
  const supabase = await createClient();

  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: LEDGER_SORT_WHITELIST,
      defaultSort: LEDGER_DEFAULT_SORT,
      filters: LEDGER_FILTER_DEFINITIONS,
    }
  );

  // Filtres "Establecimiento"/"Tipo" : jamais un dot-path à 2 niveaux d'embed
  // (order_line.product.establishment_id) — sans précédent dans ce projet. On résout d'abord les
  // product_id concernés (une seule requête, les deux conditions combinées si les deux filtres sont
  // actifs), puis on filtre la requête principale sur order_line.product_id — 1 seul niveau
  // d'embed, même profondeur que order_line.date déjà utilisé partout ailleurs.
  let matchingProductIds: string[] | null = null;
  if (filters.establishment_id || filters.type) {
    let productsQuery = supabase.from("products").select("id");
    if (filters.establishment_id) {
      productsQuery = productsQuery.eq("establishment_id", filters.establishment_id);
    }
    if (filters.type) {
      productsQuery = productsQuery.eq("type", filters.type);
    }
    const { data: matchingProducts } = await productsQuery.returns<{ id: string }[]>();
    matchingProductIds = (matchingProducts ?? []).map((product) => product.id);
  }

  let entries: LedgerEntryQueryRow[] = [];
  let count = 0;

  // Aucun produit ne correspond au filtre établissement/type : court-circuite la requête
  // principale plutôt que d'envoyer un .in() avec un tableau vide.
  if (!(matchingProductIds !== null && matchingProductIds.length === 0)) {
    let query = supabase
      .from("ledger_entries")
      .select(
        `id, amount_cop, status,
         order_line:order_lines!inner(date, product_id,
           product:products(type, name, establishment:establishments(name))),
         referrer:partners!ledger_entries_referrer_partner_id_fkey(display_name)`,
        { count: "exact" }
      )
      .order(sort.column, { ascending: sort.direction === "asc" })
      .range(from, to);

    if (filters.date_from) query = query.gte("order_line.date", filters.date_from);
    if (filters.date_to) query = query.lte("order_line.date", filters.date_to);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.referrer_partner_id) query = query.eq("referrer_partner_id", filters.referrer_partner_id);
    if (matchingProductIds !== null) query = query.in("order_line.product_id", matchingProductIds);

    const result = await query.returns<LedgerEntryQueryRow[]>();
    entries = result.data ?? [];
    count = result.count ?? 0;
  }

  const rows: LedgerRow[] = entries.map((entry) => ({
    id: entry.id,
    referrerName: entry.referrer?.display_name ?? "—",
    establishmentName:
      resolveLocalizedField(asLocalizedField(entry.order_line?.product?.establishment?.name), "es") ?? "—",
    productType: entry.order_line?.product?.type ?? "—",
    date: entry.order_line?.date ?? "—",
    status: entry.status,
    amountCop: entry.amount_cop,
  }));

  // Options des combobox de filtre — listes complètes (pas de plafond), chargées en une seule
  // requête chacune, jamais paginées : retour Jérôme, plus correct qu'un <select> plafonné pour un
  // écran de réconciliation financière (cf. plan).
  const { data: referrerCapabilities } = await supabase
    .from("partner_capabilities")
    .select("partner_id, partner:partners(display_name)")
    .eq("role", "referrer")
    .eq("status", "active")
    .returns<{ partner_id: string; partner: { display_name: string } | null }[]>();

  const referrersById = new Map<string, string>();
  for (const capability of referrerCapabilities ?? []) {
    if (capability.partner?.display_name) {
      referrersById.set(capability.partner_id, capability.partner.display_name);
    }
  }
  const referrers: ReferrerOption[] = Array.from(referrersById, ([id, name]) => ({ id, name })).sort(
    (a, b) => a.name.localeCompare(b.name)
  );

  const { data: establishmentsRaw } = await supabase
    .from("establishments")
    .select("id, name")
    .returns<{ id: string; name: unknown }[]>();
  const establishments: EstablishmentOption[] = (establishmentsRaw ?? [])
    .map((establishment) => ({
      id: establishment.id,
      name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ledger de liquidación</h1>
      <LedgerTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
        referrers={referrers}
        establishments={establishments}
      />
    </div>
  );
}
