import { asLocalizedField, resolveLocalizedField, resolvePageParams } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { OrdersTable, type OrderLineRow } from "./OrdersTable";
import { STATUS_LABELS } from "./statusLabels";

type OrderLineQueryRow = {
  id: string;
  order_id: string;
  date: string;
  qty: number;
  status: string;
  total_cop: number;
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
  const { page, pageSize, from, to } = resolvePageParams(resolvedSearchParams);
  const statusParam = resolvedSearchParams?.status;
  const statusFilter =
    typeof statusParam === "string" && statusParam in STATUS_LABELS ? statusParam : null;

  const supabase = await createClient();

  // Table dense sur order_lines (pas orders) : c'est la ligne, pas la commande, qui porte la
  // date/le produit/la quantité à préparer (cahier des charges admin §2). referrer_partner_id
  // (feature 7) affiché pour la première fois ici, jusqu'ici prouvé seulement par pgTAP.
  //
  // Retrofit pagination serveur (G15, spec 02 §10) : le filtre statut passe désormais côté
  // serveur (.eq + .range), plutôt que de charger toute la table pour filtrer/paginer côté
  // client comme jusqu'ici. Le TRI reste côté client sur la page courante (repli explicitement
  // documenté dans la spec — trier côté serveur exigerait de reconstruire toute la configuration
  // TanStack en manualSorting, disproportionné pour ce lot).
  let query = supabase
    .from("order_lines")
    .select(
      `id, order_id, date, qty, status, total_cop,
       product:products(name, establishment:establishments(name)),
       order:orders(holder_name, holder_phone, referrer:partners(display_name))`,
      { count: "exact" }
    )
    .order("date", { ascending: true })
    .range(from, to);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
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
        statusFilter={statusFilter}
      />
    </div>
  );
}
