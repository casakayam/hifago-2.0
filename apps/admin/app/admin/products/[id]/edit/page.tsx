import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { ProductForm } from "@/components/product-form";
// Correctif (spec 21, bug pré-existant sans lien avec elle) : jamais importer productTypeGating/
// availabilityScreenFor depuis useProductTypeFieldsState.ts ("use client") depuis un Server
// Component — cf. apps/admin/lib/products/productTypeGating.ts pour l'explication complète.
import {
  productTypeGating,
  availabilityScreenFor,
  type ProductType,
} from "@/lib/products/productTypeGating";
import type { DraftSlotRule } from "@/lib/products/slotRules";
import type { DraftRoomType } from "@/lib/products/hotelRooms";
import { tiersFromColumn } from "@/lib/products/priceTiers";
import { stayRatesFromColumn } from "@/lib/products/stayRates";
import { ProductStatusBlock } from "./ProductStatusBlock";
import { ProductPhotosBlock } from "./ProductPhotosBlock";
import { ProductTagsBlock } from "./ProductTagsBlock";
import { ProductSlotRulesBlock } from "./ProductSlotRulesBlock";
import { ProductHotelRoomsBlock } from "./ProductHotelRoomsBlock";

// "HH:MM:SS" (sérialisation Postgres d'une colonne time) → "HH:MM" (valeur attendue par
// <Input type="time">, cf. slot-rules-editor.tsx).
function toTimeInputValue(time: string): string {
  return time.slice(0, 5);
}

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées.
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, name, description, address, lat, lon, price_cop, price_tiers, min_qty, max_qty, check_in_time, check_out_time, capacity, default_capacity, stay_rates, category, type, establishment_id, sellable, lobby_category_id, lobby_product_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  // Spec 08/12/13 — tags : réservés au parcours partagé activité/alojamiento/hôtel (écran partagé
  // conservé, champ conditionnel). productTypeGating : SEULE définition de ces booléens dans tout
  // le projet (cf. apps/admin/lib/products/useProductTypeFieldsState.ts), partagée avec ProductForm
  // et ModerateProductCreationProposalForm.
  const { isActivity, isLodging, isHotel, isTransport, hasTags } = productTypeGating(
    product.type as ProductType,
  );

  // 5 lectures indépendantes (aucune ne dépend du résultat d'une autre, seulement de product.id/
  // product.type déjà connus) — lancées en parallèle plutôt qu'en séquence, le TTFB de la page tombe
  // au max des 5 allers-retours Supabase au lieu de leur somme.
  const [
    { data: media },
    { data: tagsRaw },
    { data: assignments },
    { data: slotRulesRaw },
    { data: roomTypesRaw },
  ] = await Promise.all([
    supabase
      .from("product_media")
      .select("id, storage_path")
      .eq("product_id", product.id)
      .order("sort", { ascending: true }),
    hasTags
      ? supabase.from("catalog_tags").select("id, label").order("slug")
      : Promise.resolve({ data: [] as { id: string; label: unknown }[] }),
    hasTags
      ? supabase.from("product_tag_assignments").select("tag_id").eq("product_id", product.id)
      : Promise.resolve({ data: [] as { tag_id: string }[] }),
    // Spec 11 — règles de créneaux : réservées à "activity", même gating que tags/tramos.
    isActivity
      ? supabase
          .from("product_slot_rules")
          .select("weekdays, start_time, end_time, slot_duration_minutes, capacity")
          .eq("product_id", product.id)
          .order("start_time")
      : Promise.resolve({ data: [] as never[] }),
    // Spec 13 — chambres : réservées à "hotel", même gating que tags/tramos/créneaux.
    isHotel
      ? supabase
          .from("product_room_types")
          .select(
            "id, kind, name, description, capacity, quantity, price_cop, price_tiers, min_qty, max_qty, stay_rates",
          )
          .eq("product_id", product.id)
          .order("sort")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // Spec 17 §0 Tranche 0 (générique) + Spec 18 Tranche 1 (créneaux) — SEULE définition de ce
  // gating avec ProductsGrid.tsx (apps/admin/app/partner/(app)/products/ProductsGrid.tsx), via
  // availabilityScreenFor (apps/admin/lib/products/useProductTypeFieldsState.ts).
  const availabilityScreen = availabilityScreenFor(
    product.type as ProductType,
    (slotRulesRaw ?? []).length > 0,
  );

  // Photos des chambres : dépend des id de roomTypesRaw, donc une 2e vague après le Promise.all
  // ci-dessus (dépendance réelle, pas parallélisable avec le reste).
  const roomIds = (roomTypesRaw ?? []).map((r) => r.id);
  const { data: roomMediaRaw } =
    roomIds.length > 0
      ? await supabase
          .from("room_media")
          .select("id, room_type_id, storage_path")
          .in("room_type_id", roomIds)
          .order("sort", { ascending: true })
      : { data: [] as { id: string; room_type_id: string; storage_path: string }[] };

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));
  const initialTagIds = (assignments ?? []).map((a) => a.tag_id);

  const initialSlotRules: DraftSlotRule[] = (slotRulesRaw ?? []).map((rule) => ({
    weekdays: rule.weekdays,
    startTime: toTimeInputValue(rule.start_time),
    endTime: toTimeInputValue(rule.end_time),
    slotDurationMinutes: String(rule.slot_duration_minutes),
    capacity: String(rule.capacity),
  }));

  const initialHotelRooms: DraftRoomType[] = (roomTypesRaw ?? []).map((room) => ({
    id: room.id,
    kind: room.kind as DraftRoomType["kind"],
    name: asLocalizedField(room.name) ?? {},
    description: asLocalizedField(room.description) ?? {},
    capacity: String(room.capacity),
    quantity: room.quantity != null ? String(room.quantity) : "",
    priceMode: Array.isArray(room.price_tiers) && room.price_tiers.length > 0 ? "tiers" : "simple",
    priceCop: String(room.price_cop),
    priceTiers: tiersFromColumn(room.price_tiers),
    minQty: room.min_qty != null ? String(room.min_qty) : "",
    maxQty: room.max_qty != null ? String(room.max_qty) : "",
    stayRates: stayRatesFromColumn(room.stay_rates),
    photos: [],
    savedPhotos: (roomMediaRaw ?? [])
      .filter((m) => m.room_type_id === room.id)
      .map((m) => ({
        id: m.id,
        url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
      })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">
          {isLodging
            ? "Editar alojamiento"
            : isHotel
              ? "Editar hotel"
              : isTransport
                ? "Editar transporte"
                : "Editar actividad"}
        </h1>
        {availabilityScreen === "generic" || availabilityScreen === "slot" ? (
          <Link
            href={`/admin/products/${product.id}/availability`}
            className={buttonVariants({ variant: "outline" })}
          >
            Calendario &amp; cupos
          </Link>
        ) : null}
        {/* Spec 17 §0 Tranche 2 — le calendrier générique (product_availability, lien ci-dessus)
            ne représente aucune chambre réelle pour un hôtel : grille dédiée chambres×dates. */}
        {availabilityScreen === "room" ? (
          <Link
            href={`/admin/products/${product.id}/room-availability`}
            className={buttonVariants({ variant: "outline" })}
          >
            Cupos por habitación
          </Link>
        ) : null}
        {/* Spec 18 Tranche 1 — même raisonnement : product_availability ne représente pas la
            capacité par créneau horaire d'une activité qui porte des product_slot_rules (ex.
            jetski) ; grille dédiée horaires×dates, affichée seulement si au moins une règle existe.
            Vient TOUJOURS avec le lien générique ci-dessus (availabilityScreenFor 'slot' n'exclut
            pas 'generic', cf. son commentaire), jamais à sa place. */}
        {availabilityScreen === "slot" ? (
          <Link
            href={`/admin/products/${product.id}/slot-availability`}
            className={buttonVariants({ variant: "outline" })}
          >
            Cupos por horario
          </Link>
        ) : null}
      </div>
      {/* Bloc Statut séparé du formulaire d'édition — action distincte (feature 4), pas un champ
          de plus dans le même submit. */}
      <ProductStatusBlock productId={product.id} initialSellable={product.sellable} />
      {hasTags ? (
        <ProductTagsBlock productId={product.id} allTags={allTags} initialTagIds={initialTagIds} />
      ) : null}
      <ProductPhotosBlock productId={product.id} initialPhotos={photos} />
      {isActivity ? (
        <ProductSlotRulesBlock productId={product.id} initialRules={initialSlotRules} />
      ) : null}
      {isHotel ? (
        <ProductHotelRoomsBlock productId={product.id} initialRooms={initialHotelRooms} />
      ) : null}
      <ProductForm product={product} />
    </div>
  );
}
