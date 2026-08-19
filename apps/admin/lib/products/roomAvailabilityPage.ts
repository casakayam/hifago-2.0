import { createClient } from "@hifago/supabase/server";
import { addDays } from "./dates";
import type { RoomTypeRow } from "@/components/room-availability-grid";

export const ROOM_AVAILABILITY_WINDOW_DAYS = 14;

type AvailabilityRow = { room_type_id: string; date: string; capacity: number; booked: number };
type RateRow = { room_type_id: string; date: string; price_cop: number };

export type RoomAvailabilityPageData = {
  productName: unknown;
  from: string;
  windowEnd: string;
  dates: string[];
  roomTypes: RoomTypeRow[];
  availability: AvailabilityRow[];
  rates: RateRow[];
};

// Chargement complet de la page de cupos par habitación — même requêtage pour l'écran admin
// (/admin/products/[id]/room-availability) et l'écran socio (/partner/products/[id]/room-
// availability), désormais unifié ici : les deux page.tsx restent de fins wrappers qui gardent
// chacun leur propre commentaire RLS (la sûreté de ce select non filtré dépend du RÔLE de
// l'appelant — admin vs socio — pas de la requête elle-même, donc documentée au point d'appel,
// pas ici). `null` = fiche introuvable OU pas un hôtel : au page.tsx d'appeler notFound().
export async function loadRoomAvailabilityPageData(
  productId: string,
  fromParam: string | string[] | undefined,
): Promise<RoomAvailabilityPageData | null> {
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, type, name")
    .eq("id", productId)
    .maybeSingle();

  if (!product || product.type !== "hotel") {
    return null;
  }

  const from =
    typeof fromParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? fromParam
      : new Date().toISOString().slice(0, 10);
  const dates = Array.from({ length: ROOM_AVAILABILITY_WINDOW_DAYS }, (_, i) => addDays(from, i));
  const windowEnd = addDays(from, ROOM_AVAILABILITY_WINDOW_DAYS - 1);

  const { data: roomTypesRaw } = await supabase
    .from("product_room_types")
    .select("id, kind, name, price_cop")
    .eq("product_id", productId)
    .order("sort");
  const roomTypeIds = (roomTypesRaw ?? []).map((r) => r.id);

  const [{ data: availability }, { data: rates }] =
    roomTypeIds.length > 0
      ? await Promise.all([
          supabase
            .from("room_type_availability")
            .select("room_type_id, date, capacity, booked")
            .in("room_type_id", roomTypeIds)
            .gte("date", from)
            .lte("date", windowEnd),
          supabase
            .from("room_type_date_rates")
            .select("room_type_id, date, price_cop")
            .in("room_type_id", roomTypeIds)
            .gte("date", from)
            .lte("date", windowEnd),
        ])
      : [{ data: [] as AvailabilityRow[] }, { data: [] as RateRow[] }];

  return {
    productName: product.name,
    from,
    windowEnd,
    dates,
    roomTypes: (roomTypesRaw ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as "dorm" | "private",
      priceCop: r.price_cop,
    })),
    availability: availability ?? [],
    rates: rates ?? [],
  };
}
