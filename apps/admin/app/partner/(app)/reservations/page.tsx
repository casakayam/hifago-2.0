import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { getActiveOperatorEstablishmentIds } from "@/lib/agenda/activeOperatorEstablishments";
import { RESERVATIONS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { RESERVATIONS_DEFAULT_SORT, RESERVATIONS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { ReservationsTable, type ReservationRow } from "./ReservationsTable";

type OrderLineQueryRow = {
  id: string;
  date: string;
  qty: number;
  status: string;
  total_cop: number;
  holder_name: string;
  holder_phone: string | null;
  holder_email: string | null;
  product: { name: unknown; establishment: { name: unknown } | null } | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Spec 17 §0 Tranche 1 — « Mis Reservas ». Refonte vue prestataire (2026-08-19) : migration vers
// resolveListParams/DataList (pagination+tri serveur, filtres date/activité/client ou email/statut,
// ces 2 derniers retravaillés le 2026-08-20 — cf. ReservationsFilterBar.tsx), à la place de
// l'ancien .limit(100) sans filtre. La RLS (order_lines_select_operator, migration 20260817170000)
// suffirait seule à restreindre les lignes visibles, mais un filtre explicite sur les
// établissements réellement opérés par CE partenaire reste nécessaire (même raisonnement que
// commissions/page.tsx sur referrer_partner_id) : order_lines_select (Tranche 3, additive) laisse
// aussi remonter les lignes que ce compte aurait achetées lui-même comme simple client — hors
// sujet ici.
export default async function PartnerReservationsPage({
  searchParams,
}: PageProps<"/partner/reservations">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null; // garde déjà posée par layout.tsx — jamais atteint en pratique.
  }

  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: RESERVATIONS_SORT_WHITELIST,
      defaultSort: RESERVATIONS_DEFAULT_SORT,
      filters: RESERVATIONS_FILTER_DEFINITIONS,
    }
  );

  // Défaut "semaine à venir" (demande initiale de Jérôme, refonte vue prestataire) quand aucun
  // filtre de date n'est explicitement posé dans l'URL — un filtre déjà présent prime toujours.
  // Reflété aussi dans filterValues/extraParams pour que le formulaire de filtres affiche ces
  // dates par défaut plutôt que des champs vides, et que ServerPagination les préserve d'une page
  // à l'autre.
  const hasExplicitDateFilter = filters.date_from !== undefined || filters.date_to !== undefined;
  const dateFrom = filters.date_from ?? (hasExplicitDateFilter ? undefined : todayIso());
  const dateTo = filters.date_to ?? (hasExplicitDateFilter ? undefined : isoPlusDays(dateFrom ?? todayIso(), 6));
  const filterValues = { ...filters, ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) };
  const effectiveExtraParams = { ...extraParams, ...filterValues };

  const establishmentIds = await getActiveOperatorEstablishmentIds(supabase, partnerId);

  // product:products!inner(...) : inner join nécessaire pour que le filtre sur la colonne embarquée
  // establishment_id (scope de visibilité, pas un filtre choisi par l'utilisateur) fonctionne
  // (PostgREST), même exigence que order:orders!inner(...) dans admin/orders/page.tsx — et pour
  // afficher product.name/establishment.name dans chaque ligne. product_id (filtre activité) est
  // lui une colonne de base d'order_lines, filtré directement, indépendamment de cette relation.
  let query =
    establishmentIds.length > 0
      ? supabase
          .from("order_lines")
          .select(
            `id, date, qty, status, total_cop, holder_name, holder_phone, holder_email,
             product:products!inner(name, establishment_id, establishment:establishments(name))`,
            { count: "exact" }
          )
          .in("product.establishment_id", establishmentIds)
          .order(sort.column, { ascending: sort.direction === "asc" })
          .range(from, to)
      : null;

  if (query && dateFrom) query = query.gte("date", dateFrom);
  if (query && dateTo) query = query.lte("date", dateTo);
  if (query && filters.product_id) query = query.eq("product_id", filters.product_id);
  // holder_q : un seul champ pour nom OU email (retour Jérôme, 2026-08-20) — colonnes de base sur
  // order_lines, jamais de relation embarquée impliquée ici, donc .or() fonctionne sans le piège
  // PostgREST déjà rencontré ailleurs (établissements/partenaires, colonne de base + relation).
  if (query && filters.holder_q) {
    query = query.or(`holder_name.ilike.%${filters.holder_q}%,holder_email.ilike.%${filters.holder_q}%`);
  }
  if (query && filters.status) query = query.eq("status", filters.status);

  const { data: lines, count } = query
    ? await query.returns<OrderLineQueryRow[]>()
    : { data: [] as OrderLineQueryRow[], count: 0 };

  // Activités du prestataire pour le combobox de filtre (retour Jérôme, 2026-08-20) — même
  // établissements que la requête principale, jamais reposé sur products.sellable (une réservation
  // existante peut porter sur une activité entre-temps dépubliée, elle doit rester filtrable).
  const { data: productOptionsRaw } =
    establishmentIds.length > 0
      ? await supabase
          .from("products")
          .select("id, name")
          .in("establishment_id", establishmentIds)
          .order("name->>es", { ascending: true })
      : { data: [] as { id: string; name: unknown }[] };
  const productOptions = (productOptionsRaw ?? []).map((product) => ({
    id: product.id,
    name: resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id,
  }));

  const rows: ReservationRow[] = (lines ?? []).map((line) => ({
    id: line.id,
    date: line.date,
    productName: resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—",
    establishmentName:
      resolveLocalizedField(asLocalizedField(line.product?.establishment?.name), "es") ?? "—",
    holderName: line.holder_name,
    holderPhone: line.holder_phone,
    holderEmail: line.holder_email,
    qty: line.qty,
    totalCop: line.total_cop,
    status: line.status,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis reservas</h1>
      <ReservationsTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filterValues}
        extraParams={effectiveExtraParams}
        products={productOptions}
      />
    </div>
  );
}
