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

  // Revue admin catalogo (Jérôme, 2026-08-19) — options du filtre "Establecimiento" construites à
  // la volée (établissements dynamiques, jamais une liste fermée écrite en dur dans filters.ts,
  // contrairement à type/sellable). establishment_id est une vraie colonne FK sur products — un
  // simple .eq() suffit, pas besoin de RPC ni de contourner une limite PostgREST comme pour la
  // recherche établissement/partenaire (aucun .or() ici, aucune combinaison colonne de base +
  // colonne de relation embarquée).
  //
  // Retour Jérôme : le dropdown seul ne passe pas à l'échelle (établissements dynamiques, en
  // croissance continue) — plafonné à 10 (ordre alphabétique, le plus prévisible sans introduire
  // d'agrégat "les plus utilisés" non demandé), complété par un champ texte `establishment_q` en
  // échappatoire pour chercher un établissement absent des 10 visibles. Les deux ne se combinent
  // jamais : establishment_id (dropdown) prioritaire s'il est posé, sinon establishment_q (texte).
  const { data: establishments } = await supabase
    .from("establishments")
    .select("id, name")
    .order("name->>es", { ascending: true })
    .limit(10);
  const establishmentOptions = (establishments ?? []).map((establishment) => ({
    value: establishment.id,
    label: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
  }));

  // establishments!inner (pas le embed par défaut) : establishment_id est not null sur products,
  // donc ça ne change jamais l'ensemble de résultats — juste ce qui permet d'appliquer un .ilike()
  // sur establishments.name (colonne d'une relation embarquée) sans RPC, tant que ce n'est jamais
  // combiné à une autre condition via .or() (limite déjà documentée pour établissements/clientes).
  let query = supabase
    .from("products")
    .select("id, name, type, price_cop, sellable, establishments!inner(name)", { count: "exact" })
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
  if (filters.establishment_id) {
    query = query.eq("establishment_id", filters.establishment_id);
  } else if (filters.establishment_q) {
    query = query.ilike("establishments.name->>es", `%${filters.establishment_q}%`);
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
        establishmentOptions={establishmentOptions}
      />
    </div>
  );
}
