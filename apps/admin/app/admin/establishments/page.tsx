import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { EstablishmentsList, type EstablishmentRow } from "./EstablishmentsList";
import { ESTABLISHMENTS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { ESTABLISHMENTS_DEFAULT_SORT, ESTABLISHMENTS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, tri/filtres serveur.
export default async function AdminEstablishmentsPage({
  searchParams,
}: PageProps<"/admin/establishments">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: ESTABLISHMENTS_SORT_WHITELIST,
      defaultSort: ESTABLISHMENTS_DEFAULT_SORT,
      filters: ESTABLISHMENTS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit tous les établissements, pas seulement les siens.
  // products(count) : agrégation embarquée PostgREST sur la FK products.establishment_id (feature
  // 2) — un compteur, pas une vraie liste produits (hors périmètre de cette feature, cf. plan).
  let query = supabase
    .from("establishments")
    .select("id, name, status, partner:partners(display_name), products(count)", { count: "exact" })
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.q) {
    query = query.ilike("name->>es", `%${filters.q}%`);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.operated_directly) {
    query = query.eq("operated_directly", filters.operated_directly === "true");
  }

  const { data: establishments, count } = await query;

  const rows: EstablishmentRow[] = (establishments ?? []).map((establishment) => ({
    id: establishment.id,
    name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
    partnerName: establishment.partner?.display_name ?? "—",
    status: establishment.status,
    activitiesCount: establishment.products?.[0]?.count ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Establecimientos</h1>
        <Link href="/admin/establishments/new" className={buttonVariants()}>
          Nuevo establecimiento
        </Link>
      </div>
      <EstablishmentsList
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
      />
    </div>
  );
}
