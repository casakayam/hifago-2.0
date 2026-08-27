import { createClient } from "@hifago/supabase/server";
import { addDays } from "./dates";
import type { SlotAvailabilityRow } from "@/components/slot-availability-grid";

export const SLOT_AVAILABILITY_WINDOW_DAYS = 14;

export type SlotAvailabilityPageData = {
  productName: unknown;
  from: string;
  windowEnd: string;
  dates: string[];
  slots: SlotAvailabilityRow[];
};

// Chargement complet de la page de cupos par horario — même requêtage pour l'écran admin
// (/admin/products/[id]/slot-availability) et l'écran socio (/partner/products/[id]/slot-
// availability), désormais unifié ici : les deux page.tsx restent de fins wrappers qui gardent
// chacun leur propre commentaire RLS (la sûreté de ce select non filtré dépend du RÔLE de
// l'appelant — admin vs socio — pas de la requête elle-même, donc documentée au point d'appel,
// pas ici). `null` = fiche introuvable OU sans aucune règle de créneaux (product_slot_rules) :
// cet écran n'a de sens que pour un produit qui en porte au moins une. Au page.tsx d'appeler
// notFound() dans les deux cas.
export async function loadSlotAvailabilityPageData(
  productId: string,
  fromParam: string | string[] | undefined,
): Promise<SlotAvailabilityPageData | null> {
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, type, name")
    .eq("id", productId)
    .maybeSingle();

  if (!product) {
    return null;
  }

  const { count: slotRulesCount } = await supabase
    .from("product_slot_rules")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (!slotRulesCount) {
    return null;
  }

  const from =
    typeof fromParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? fromParam
      : new Date().toISOString().slice(0, 10);
  const dates = Array.from({ length: SLOT_AVAILABILITY_WINDOW_DAYS }, (_, i) => addDays(from, i));
  const windowEnd = addDays(from, SLOT_AVAILABILITY_WINDOW_DAYS - 1);

  const { data: slots } = await supabase.rpc("get_product_slots", {
    p_product_id: productId,
    p_from: from,
    p_to: windowEnd,
  });

  return {
    productName: product.name,
    from,
    windowEnd,
    dates,
    slots: slots ?? [],
  };
}
