import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { OrdersTable, type OrderLineRow } from "./OrdersTable";
import { ORDERS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { ORDERS_DEFAULT_SORT, ORDERS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

type OrderLineQueryRow = {
  id: string;
  order_id: string;
  date: string;
  qty: number;
  status: string;
  total_cop: number;
  created_at: string;
  product: { name: unknown; establishment: { name: unknown } | null } | null;
  order: {
    holder_name: string;
    holder_phone: string | null;
    referrer: { display_name: string } | null;
  } | null;
};

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: ORDERS_SORT_WHITELIST,
      defaultSort: ORDERS_DEFAULT_SORT,
      filters: ORDERS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // Table dense sur order_lines (pas orders) : c'est la ligne, pas la commande, qui porte la
  // date/le produit/la quantité à préparer (cahier des charges admin §2). referrer_partner_id
  // (feature 7) affiché pour la première fois ici, jusqu'ici prouvé seulement par pgTAP.
  //
  // docs/specs/10-listes-standardisees-admin-socio.md — pagination ET tri désormais tous les deux
  // côté serveur (manualSorting sur DataList, plus de repli client), écran pilote de la spec.
  // `order:orders!inner(...)` (pas un simple `orders(...)`) : nécessaire pour que le filtre `q`
  // sur `order.holder_name` fonctionne (PostgREST exige `!inner` pour filtrer une ressource
  // embarquée) — sans incidence sur les lignes retournées hors filtre `q`, order_id est NOT NULL.
  let query = supabase
    .from("order_lines")
    .select(
      `id, order_id, date, qty, status, total_cop, created_at,
       product:products(name, establishment:establishments(name)),
       order:orders!inner(holder_name, holder_phone, referrer:partners(display_name))`,
      { count: "exact" }
    )
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.date_from) {
    query = query.gte("date", filters.date_from);
  }
  if (filters.date_to) {
    query = query.lte("date", filters.date_to);
  }
  if (filters.q) {
    query = query.ilike("order.holder_name", `%${filters.q}%`);
  }

  const { data: lines, count } = await query.returns<OrderLineQueryRow[]>();

  const rows: OrderLineRow[] = (lines ?? []).map((line) => ({
    id: line.id,
    orderId: line.order_id,
    date: line.date,
    qty: line.qty,
    status: line.status,
    productName: resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—",
    establishmentName:
      resolveLocalizedField(asLocalizedField(line.product?.establishment?.name), "es") ?? "—",
    holderName: line.order?.holder_name ?? "—",
    holderPhone: line.order?.holder_phone ?? null,
    // Première fois que referrer_partner_id (feature 7) est réellement affiché — "Directo" quand
    // aucun référent n'a été résolu à la création de la commande, jamais une valeur devinée ici.
    referrerName: line.order?.referrer?.display_name ?? "Directo",
    // total_cop : le snapshot de commission (feature 11), pas un recalcul via products.price_cop —
    // celui-ci dérive silencieusement si le prix du produit est modifié après coup (cf.
    // /admin/orders/[id] qui utilise déjà ce même snapshot).
    amount: line.total_cop,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Pedidos</h1>
      <OrdersTable
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
