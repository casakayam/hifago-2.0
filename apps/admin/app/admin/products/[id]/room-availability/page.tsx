import Link from "next/link";
import { notFound } from "next/navigation";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { RoomAvailabilityGrid } from "@/components/room-availability-grid";
import { addDays } from "@/lib/products/dates";
import {
  loadRoomAvailabilityPageData,
  ROOM_AVAILABILITY_WINDOW_DAYS,
} from "@/lib/products/roomAvailabilityPage";

export default async function ProductRoomAvailabilityPage({
  params,
  searchParams,
}: PageProps<"/admin/products/[id]/room-availability">) {
  const { id } = await params;
  const { from: fromParam } = await searchParams;

  // RLS (products_select_public) : l'admin voit aussi les fiches non publiées.
  const data = await loadRoomAvailabilityPageData(id, fromParam);

  if (!data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Cupos por habitación —{" "}
          {resolveLocalizedField(asLocalizedField(data.productName), "es") ?? id}
        </h1>
        <div className="flex gap-2">
          <Link
            href={`?from=${addDays(data.from, -ROOM_AVAILABILITY_WINDOW_DAYS)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="room-availability-prev"
          >
            ← Anterior
          </Link>
          <Link
            href={`?from=${addDays(data.from, ROOM_AVAILABILITY_WINDOW_DAYS)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="room-availability-next"
          >
            Siguiente →
          </Link>
        </div>
      </div>
      <RoomAvailabilityGrid
        roomTypes={data.roomTypes}
        dates={data.dates}
        availability={data.availability}
        rates={data.rates}
      />
    </div>
  );
}
