import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { getActiveOperatorEstablishmentIds } from "@/lib/agenda/activeOperatorEstablishments";
import { ReservationsTable, type ReservationRow } from "./ReservationsTable";

type OrderLineQueryRow = {
  id: string;
  date: string;
  qty: number;
  status: string;
  total_cop: number;
  holder_name: string;
  product: { name: unknown; establishment: { name: unknown } | null } | null;
};

// Spec 17 §0 Tranche 1 — « Mis Reservas ». La RLS (order_lines_select_operator, migration
// 20260817170000) suffirait seule à restreindre les lignes visibles, mais un filtre explicite sur
// les établissements réellement opérés par CE partenaire reste nécessaire (même raisonnement que
// commissions/page.tsx sur referrer_partner_id) : order_lines_select (Tranche 3, additive) laisse
// aussi remonter les lignes que ce compte aurait achetées lui-même comme simple client — hors
// sujet ici.
export default async function PartnerReservationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null; // garde déjà posée par layout.tsx — jamais atteint en pratique.
  }

  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  const establishmentIds = await getActiveOperatorEstablishmentIds(supabase, partnerId);

  // product:products!inner(...) : inner join nécessaire pour que le filtre sur la colonne
  // embarquée establishment_id fonctionne (PostgREST, même exigence que order:orders!inner(...)
  // dans admin/orders/page.tsx). 100 dernières hors hold — inexistant en v2 (aucune order_lines.
  // status ne vaut jamais 'hold', cf. spec 17 §1 : vestige v1 jamais porté ici), donc aucun filtre
  // de statut à poser.
  const { data: lines } =
    establishmentIds.length > 0
      ? await supabase
          .from("order_lines")
          .select(
            `id, date, qty, status, total_cop, holder_name,
             product:products!inner(name, establishment_id, establishment:establishments(name))`
          )
          .in("product.establishment_id", establishmentIds)
          .order("date", { ascending: false })
          .limit(100)
          .returns<OrderLineQueryRow[]>()
      : { data: [] as OrderLineQueryRow[] };

  const rows: ReservationRow[] = (lines ?? []).map((line) => ({
    id: line.id,
    date: line.date,
    productName: resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—",
    establishmentName:
      resolveLocalizedField(asLocalizedField(line.product?.establishment?.name), "es") ?? "—",
    holderName: line.holder_name,
    qty: line.qty,
    totalCop: line.total_cop,
    status: line.status,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis reservas</h1>
      <ReservationsTable rows={rows} />
    </div>
  );
}
