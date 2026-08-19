import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Card, Chip } from "@hifago/ui";
import { positionOrderLines, type OrderLineForAgenda, type SlotDuration } from "@/lib/agenda/positionOrderLines";
import { selectActiveOperatorEstablishmentIds } from "@/lib/agenda/activeOperatorEstablishments";
import { MANUAL_ORDER_INELIGIBLE_TYPES } from "@/lib/products/manualOrderEligibility";
import type { ProductType } from "@/lib/products/useProductTypeFieldsState";
import { PartnerAgenda } from "./PartnerAgenda";
import type { ProductOption } from "./AddReservationDialog";

const ROLE_LABELS: Record<string, string> = {
  referrer: "Referente",
  operator: "Prestador",
};

const STATUS_LABELS: Record<string, string> = {
  onboarding: "En preparación",
  pending_review: "En revisión",
  active: "Activo",
  suspended: "Suspendido",
};

const STATUS_CHIP_COLOR: Record<string, "default" | "success" | "warning" | "danger"> = {
  onboarding: "default",
  pending_review: "warning",
  active: "success",
  suspended: "danger",
};

type CapabilityRow = {
  id: string;
  role: string;
  status: string;
  establishment_id: string | null;
};

type ProductRow = {
  id: string;
  name: unknown;
  type: string;
  establishment_id: string;
  duration_days: number | null;
};

type OrderLineRow = {
  id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
  status: string;
  holder_name: string;
  product: { id: string; name: unknown; type: string; duration_days: number | null } | null;
};

// Fenêtre de lecture initiale de l'agenda — pas de refetch au changement de vue/date côté client
// en V1 (gap documenté, spec 20 §10 : lazy loading par plage visible renvoyé à une itération
// future). ±183 jours couvre largement l'usage réel (aujourd'hui, cette semaine, ce mois).
function agendaWindow(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  const to = new Date(now);
  to.setDate(to.getDate() + 183);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toIso(from), to: toIso(to) };
}

// Spec 20 — remplace la page de statut d'onboarding pure par l'agenda de réservations (vue
// principale du socio, façon Google Calendar). La carte de statut (feature 29,
// docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.1) est conservée mais rendue
// conditionnelle : bandeau compact si toutes les capacités sont déjà actives, carte complète sinon
// — un partenaire encore en onboarding/pending_review ne doit jamais atterrir sur un agenda vide
// sans comprendre pourquoi.
export default async function PartnerHomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner");
  }

  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  const { data: capabilities } = partnerId
    ? await supabase
        .from("partner_capabilities")
        .select("id, role, status, establishment_id")
        .eq("partner_id", partnerId)
        .order("role")
    : { data: null };

  const rows = (capabilities ?? []) as CapabilityRow[];
  const allActive = rows.length > 0 && rows.every((row) => row.status === "active");

  // Lignes NON filtrées ci-dessus nécessaires pour la carte de statut (tous rôles/statuts) — mais
  // establishmentIds dérive de la même règle que reservations/page.tsx (role "operator", status
  // "active"), extraite dans lib/agenda/activeOperatorEstablishments plutôt que refiltrée ici en
  // JS avec un second littéral.
  const establishmentIds = selectActiveOperatorEstablishmentIds(rows);

  let events: ReturnType<typeof positionOrderLines> = [];
  let productOptions: ProductOption[] = [];

  if (establishmentIds.length > 0) {
    const { from, to } = agendaWindow();

    const [{ data: products }, { data: lines }] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, type, establishment_id, duration_days")
        .in("establishment_id", establishmentIds)
        .eq("sellable", true)
        .returns<ProductRow[]>(),
      supabase
        .from("order_lines")
        .select(
          `id, date, end_date, slot_start_time, qty, status, holder_name,
           product:products!inner(id, name, type, duration_days, establishment_id)`
        )
        .in("product.establishment_id", establishmentIds)
        .gte("date", from)
        .lte("date", to)
        .returns<OrderLineRow[]>(),
    ]);

    const productRows = products ?? [];
    const lineRows = lines ?? [];

    // Ni l'une ni l'autre requête ne dépend du résultat de l'autre (seulement de slotProductIds/
    // linesWithSlot, déjà disponibles) — parallélisées via Promise.all plutôt qu'awaited en série.
    const slotProductIds = productRows.map((p) => p.id);
    const linesWithSlot = lineRows.filter((l) => l.slot_start_time !== null);
    const slotAvailabilityProductIds = Array.from(
      new Set(linesWithSlot.map((l) => l.product?.id).filter((id): id is string => Boolean(id)))
    );

    const [{ data: slotRules }, { data: slotDurationRows }] = await Promise.all([
      slotProductIds.length > 0
        ? supabase.from("product_slot_rules").select("product_id").in("product_id", slotProductIds)
        : Promise.resolve({ data: [] as { product_id: string }[] }),
      slotAvailabilityProductIds.length > 0
        ? supabase
            .from("product_slot_availability")
            .select("product_id, slot_date, slot_start_time, slot_duration_minutes")
            .in("product_id", slotAvailabilityProductIds)
            .gte("slot_date", from)
            .lte("slot_date", to)
        : Promise.resolve({ data: [] }),
    ]);
    const productIdsWithSlots = new Set((slotRules ?? []).map((r) => r.product_id));

    const orderLinesForAgenda: OrderLineForAgenda[] = lineRows.map((line) => ({
      id: line.id,
      productId: line.product?.id ?? "",
      productName: resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—",
      productType: line.product?.type ?? "",
      productDurationDays: line.product?.duration_days ?? null,
      holderName: line.holder_name,
      qty: line.qty,
      status: line.status,
      date: line.date,
      endDate: line.end_date,
      slotStartTime: line.slot_start_time,
    }));

    const slotDurations: SlotDuration[] = (slotDurationRows ?? []).map((row) => ({
      productId: row.product_id,
      slotDate: row.slot_date,
      slotStartTime: row.slot_start_time,
      slotDurationMinutes: row.slot_duration_minutes,
    }));

    events = positionOrderLines(orderLinesForAgenda, slotDurations);

    productOptions = productRows
      .filter((p) => !MANUAL_ORDER_INELIGIBLE_TYPES.includes(p.type as ProductType))
      .map((p) => ({
        id: p.id,
        name: resolveLocalizedField(asLocalizedField(p.name), "es") ?? "—",
        hasSlots: productIdsWithSlots.has(p.id),
      }));
  }

  return (
    <div className="flex flex-col gap-6">
      {allActive ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2">
          <span className="text-sm font-medium" data-testid="partner-status-compact">
            Prestador activo
          </span>
          <Link href="/partner/establishment" className="text-sm hover:underline">
            Mi establecimiento
          </Link>
        </div>
      ) : (
        <Card data-testid="partner-status-card">
          <Card.Header>
            <Card.Title>Tus roles</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Aún no tienes ningún rol asignado.</p>
            ) : (
              rows.map((capability) => (
                <div
                  key={capability.id}
                  data-testid={`partner-role-${capability.role}`}
                  className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {ROLE_LABELS[capability.role] ?? capability.role}
                    </span>
                    <Chip variant="soft" color={STATUS_CHIP_COLOR[capability.status] ?? "default"}>
                      {STATUS_LABELS[capability.status] ?? capability.status}
                    </Chip>
                  </div>
                  {capability.role === "operator" && capability.establishment_id === null ? (
                    <p className="text-sm text-muted" data-testid="partner-establishment-pending">
                      Aún no tienes un establecimiento vinculado.{" "}
                      <Link href="/partner/establishment/new" className="underline">
                        Proponer un establecimiento
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </Card.Content>
        </Card>
      )}

      {establishmentIds.length === 0 ? (
        <Card>
          <Card.Content className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted" data-testid="partner-agenda-empty">
              Todavía no tienes ninguna actividad vendible — tu agenda aparecerá aquí en cuanto
              tengas al menos un producto.
            </p>
            <Link href="/partner/products/new" className="text-sm font-medium hover:underline">
              Crear producto →
            </Link>
          </Card.Content>
        </Card>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <PartnerAgenda events={events} productOptions={productOptions} />
        </>
      )}
    </div>
  );
}
