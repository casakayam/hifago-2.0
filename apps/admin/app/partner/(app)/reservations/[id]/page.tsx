import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
import { Card, Chip } from "@hifago/ui";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "@/app/admin/orders/statusLabels";
import { ReservationActions } from "./ReservationActions";

type OrderLineDetailRow = {
  id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
  status: string;
  holder_name: string;
  total_cop: number;
  created_at: string;
  product: {
    name: unknown;
    type: string;
    establishment: { name: unknown } | null;
  } | null;
};

// Spec 20 §0/§5 — fiche de réservation individuelle, jamais construite avant côté socio (seul
// /admin/orders/[id] existait, au niveau `orders`, admin-only). id = order_lines.id, pas orders.id.
// RLS order_lines_select_operator (migration 20260817170000) fait déjà foi : aucune nouvelle
// policy. PII minimale — jamais holder_email/holder_phone (colonnes absentes de order_lines par
// construction, cf. spec 17), jamais les colonnes de commission internes (referrer_commission_cop,
// app_commission_cop, commission_case) — hors périmètre socio, même restriction que « Mis Reservas ».
export default async function PartnerReservationDetailPage({
  params,
}: PageProps<"/partner/reservations/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: line } = await supabase
    .from("order_lines")
    .select(
      `id, date, end_date, slot_start_time, qty, status, holder_name, total_cop, created_at,
       product:products(name, type, establishment:establishments(name))`
    )
    .eq("id", id)
    .maybeSingle()
    .returns<OrderLineDetailRow>();

  if (!line) {
    notFound();
  }

  let slotDurationMinutes: number | null = null;
  if (line.slot_start_time) {
    const { data: slot } = await supabase
      .from("product_slot_availability")
      .select("slot_duration_minutes")
      .eq("slot_date", line.date)
      .eq("slot_start_time", line.slot_start_time)
      .maybeSingle();
    slotDurationMinutes = slot?.slot_duration_minutes ?? null;
  }

  const productName = resolveLocalizedField(asLocalizedField(line.product?.name), "es") ?? "—";
  const establishmentName =
    resolveLocalizedField(asLocalizedField(line.product?.establishment?.name), "es") ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reserva</h1>
        <Chip variant="soft" color={STATUS_CHIP_COLOR[line.status] ?? "default"} data-testid="reservation-detail-status">
          {STATUS_LABELS[line.status] ?? line.status}
        </Chip>
      </div>

      <Card data-testid="reservation-detail-card">
        <Card.Content className="flex flex-col gap-3">
          <Field label="Producto" value={productName} />
          <Field label="Establecimiento" value={establishmentName} />
          <Field label="Titular" value={line.holder_name} />
          <Field label="Fecha" value={formatDate(line)} />
          {line.slot_start_time ? (
            <Field label="Horario" value={formatSlot(line.slot_start_time, slotDurationMinutes)} />
          ) : null}
          <Field label="Cantidad" value={`${line.qty} pers.`} />
          <Field label="Monto total" value={formatCop(line.total_cop)} />
          <Field label="Creada el" value={new Date(line.created_at).toLocaleString("es-CO")} />
        </Card.Content>
      </Card>

      <ReservationActions
        orderLineId={line.id}
        status={line.status}
        hasSlot={line.slot_start_time !== null}
        initialDate={line.date}
        initialEndDate={line.end_date}
        initialQty={line.qty}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-none">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function formatDate(line: OrderLineDetailRow): string {
  if (line.end_date) {
    return `${line.date} → ${line.end_date}`;
  }
  return line.date;
}

function formatSlot(slotStartTime: string, durationMinutes: number | null): string {
  const time = slotStartTime.slice(0, 5);
  if (durationMinutes === null) {
    return time;
  }
  return `${time} (${durationMinutes} min)`;
}
