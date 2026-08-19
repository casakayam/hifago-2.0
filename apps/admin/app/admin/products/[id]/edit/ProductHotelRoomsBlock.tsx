"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, toast, type MediaGalleryPhoto } from "@hifago/ui";
import { HotelRoomsEditor } from "@/components/hotel-rooms-editor";
import { toRoomTypeRow, validateRoomTypes, type DraftRoomType } from "@/lib/products/hotelRooms";

// Bloc séparé du formulaire d'édition — même patron que ProductSlotRulesBlock.tsx : action
// distincte, sauvegarde immédiate, pas un champ de plus dans le submit principal de ProductForm.
//
// Contrairement aux créneaux (delete-all-reinsert, aucune conséquence sur des champs scalaires),
// une chambre a maintenant des photos (room_media.room_type_id references product_room_types(id)
// on delete cascade) : un delete-all-reinsert changerait l'id de TOUTES les chambres à chaque
// sauvegarde, même celles non modifiées, et effacerait leurs photos en cascade. "Guardar
// habitaciones" fait donc un upsert par id stable — update en place pour une chambre existante,
// insert pour une nouvelle (son id est alors connu immédiatement pour y attacher ses photos
// stagées), delete uniquement pour les chambres réellement retirées.
export function ProductHotelRoomsBlock({
  productId,
  initialRooms,
}: {
  productId: string;
  initialRooms: DraftRoomType[];
}) {
  const [rooms, setRooms] = useState(initialRooms);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const validationError = validateRoomTypes(rooms);
    if (validationError) {
      toast.danger(validationError);
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    const currentIds = new Set(rooms.filter((r) => r.id).map((r) => r.id));
    const removedIds = initialRooms.filter((r) => r.id && !currentIds.has(r.id)).map((r) => r.id!);
    if (removedIds.length > 0) {
      const { error: deleteError } = await supabase.from("product_room_types").delete().in("id", removedIds);
      if (deleteError) {
        toast.danger("No se pudieron guardar las habitaciones.");
        setIsSaving(false);
        return;
      }
    }

    const nextRooms: DraftRoomType[] = [];
    for (const [index, room] of rooms.entries()) {
      const row = toRoomTypeRow(room, index);

      if (room.id) {
        const { error: updateError } = await supabase.from("product_room_types").update(row).eq("id", room.id);
        if (updateError) {
          toast.danger("No se pudieron guardar las habitaciones.");
          setIsSaving(false);
          return;
        }
        nextRooms.push(room);
        continue;
      }

      const { data: newRoom, error: insertError } = await supabase
        .from("product_room_types")
        .insert({ product_id: productId, ...row })
        .select("id")
        .single();
      if (insertError || !newRoom) {
        toast.danger("No se pudieron guardar las habitaciones.");
        setIsSaving(false);
        return;
      }

      // Photos stagées de cette chambre neuve : rattachées maintenant que son id est connu, même
      // discipline non-bloquante que les photos/tags produit (spec 08 §9/spec 11) — un échec
      // laisse la chambre créée sans cette photo précise, corrigible en rechargeant l'écran.
      const savedPhotos: MediaGalleryPhoto[] = [];
      for (const photo of room.photos) {
        const { data: mediaId, error: mediaError } = await supabase.rpc("add_catalog_media", {
          p_entity_type: "room_type",
          p_entity_id: newRoom.id,
          p_storage_path: photo.path,
        });
        if (mediaError || !mediaId) {
          toast.danger("La habitación se guardó, pero una de sus fotos no se pudo asociar.");
          continue;
        }
        const { data: publicUrl } = supabase.storage.from("catalog-media").getPublicUrl(photo.path);
        savedPhotos.push({ id: mediaId as string, url: publicUrl.publicUrl });
      }

      nextRooms.push({ ...room, id: newRoom.id as string, photos: [], savedPhotos });
    }

    setRooms(nextRooms);
    setIsSaving(false);
    toast.success("Habitaciones guardadas.");
  }

  return (
    <div className="rounded-lg border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Habitaciones</h2>
      <HotelRoomsEditor rooms={rooms} onChange={setRooms} />
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          isDisabled={isSaving}
          onPress={handleSave}
          data-testid="save-hotel-rooms-button"
        >
          {isSaving ? "Guardando…" : "Guardar habitaciones"}
        </Button>
      </div>
    </div>
  );
}
