import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { AvailabilityCalendar } from "@/components/availability-calendar";

export default async function PartnerProductAvailabilityPage({
  params,
}: PageProps<"/partner/products/[id]/availability">) {
  const { id } = await params;
  const supabase = await createClient();

  // products_select_own (feature 15) : ne renvoie cette fiche que si elle appartient au
  // partenaire connecté (ou si elle est publiée) — un produit d'un autre partenaire ressort donc
  // ici comme "introuvable", jamais un refus explicite qui en révèlerait l'existence. La vraie
  // barrière d'écriture reste set_product_availability elle-même (feature 17, garde-fous
  // identité/propriété/capacité côté serveur), pas cette lecture.
  const { data: product } = await supabase
    .from("products")
    .select("id, name, calendar_default_open")
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  // Même service que l'écran admin (feature 5/17, cf. cahier des charges socio §3d) : lecture
  // publique de product_availability/product_calendar, pas de filtre socio nécessaire ici.
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
