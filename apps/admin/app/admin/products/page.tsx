import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { ProductsList, type ProductRow } from "./ProductsList";
import { PRODUCTS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { PRODUCTS_DEFAULT_SORT, PRODUCTS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

type ProductQueryRow = {
  id: string;
  name: unknown;
  type: string;
  price_cop: number | null;
  sellable: boolean;
  establishments: { name: unknown } | null;
};

// docs/specs/02-admin-accueil-et-navigation.md §5.5 — la liste manquait, seuls
// new/edit/availability existaient (aucune vue neutre du catalogue).
// docs/specs/10-listes-standardisees-admin-socio.md — écran pilote (2e) : 1er vrai passage du
// `Table` compound HeroUI vers `DataList`, pagination ET tri désormais tous les deux serveur.
export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: PRODUCTS_SORT_WHITELIST,
      defaultSort: PRODUCTS_DEFAULT_SORT,
      filters: PRODUCTS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("id, name, type, price_cop, sellable, establishments(name)", { count: "exact" })
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.q) {
    query = query.ilike("name->>es", `%${filters.q}%`);
  }
  if (filters.type) {
    query = query.eq("type", filters.type);
  }
  if (filters.sellable) {
    query = query.eq("sellable", filters.sellable === "true");
  }

  const { data: products, count } = await query.returns<ProductQueryRow[]>();

  const rows: ProductRow[] = (products ?? []).map((product) => ({
    id: product.id,
    name: resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id,
    establishmentName:
      resolveLocalizedField(asLocalizedField(product.establishments?.name), "es") ?? "—",
    type: product.type,
    priceCop: product.price_cop,
    sellable: product.sellable,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Catálogo</h1>
      <ProductsList
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
