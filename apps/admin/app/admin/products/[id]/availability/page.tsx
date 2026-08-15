import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { AvailabilityCalendar } from "@/components/availability-calendar";

export default async function ProductAvailabilityPage({
  params,
}: PageProps<"/admin/products/[id]/availability">) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées.
  const { data: product } = await supabase
    .from("products")
    .select("id, name, calendar_default_open")
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  // product_availability/product_calendar : lecture publique (RLS), pas de filtre admin
  // nécessaire — RPC-only seulement en écriture (correctif Tranche 2/3).
  const [{ data: availability }, { data: calendar }] = await Promise.all([
    supabase
      .from("product_availability")
      .select("date, capacity, booked")
      .eq("product_id", id),
    supabase
      .from("product_calendar")
      .select("date, open")
      .eq("product_id", id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Calendario y cupos —{" "}
        {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
      </h1>
      <AvailabilityCalendar
        entityId={product.id}
        calendarDefaultOpen={product.calendar_default_open}
        availability={availability ?? []}
        calendar={calendar ?? []}
      />
    </div>
  );
}
