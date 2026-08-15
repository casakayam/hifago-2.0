"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";

const MAX_PHOTOS = 6;

// Bloc galerie produit (spec docs/specs/04-gestion-images.md §5/§7) — même mécanique que
// ProductStatusBlock (action distincte, pas un champ de plus dans EditProductForm). L'admin
// écrit directement (add_catalog_media) : jamais de file de modération pour ses propres ajouts,
// contrairement au socio (cf. ProposePhotosBlock côté /partner).
export function ProductPhotosBlock({
  productId,
  initialPhotos,
}: {
  productId: string;
  initialPhotos: MediaGalleryPhoto[];
}) {
  const [photos, setPhotos] = useState(initialPhotos);

  async function handleAddFile(blob: Blob) {
    const supabase = createClient();

    const formData = new FormData();
    formData.append("file", blob, "photo.png");
    const uploadResponse = await fetch("/api/upload/product", { method: "POST", body: formData });
    const uploadResult = (await uploadResponse.json()) as
      | { ok: true; storage_path: string }
      | { ok: false; reason: string };

    if (!uploadResult.ok) {
      return { ok: false, reason: uploadResult.reason };
    }

    const { data, error } = await supabase.rpc("add_catalog_media", {
      p_entity_type: "product",
      p_entity_id: productId,
      p_storage_path: uploadResult.storage_path,
    });

    if (error || !data) {
      return { ok: false, reason: error?.message ?? "No se pudo añadir la foto." };
    }

    const { data: publicUrl } = supabase.storage.from("catalog-media").getPublicUrl(uploadResult.storage_path);
    setPhotos((prev) => [...prev, { id: data as string, url: publicUrl.publicUrl }]);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("reorder_gallery", {
      p_entity_type: "product",
      p_entity_id: productId,
      p_ordered_media_ids: orderedIds,
    });
    const result = data as { ok: boolean; reason?: string } | null;
    if (error || !result?.ok) {
      return { ok: false, reason: result?.reason ?? error?.message };
    }
    setPhotos((prev) => orderedIds.map((id) => prev.find((p) => p.id === id)!));
    return { ok: true };
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("product_media").delete().eq("id", id);
    if (error) return { ok: false, reason: error.message };
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    return { ok: true };
  }

  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-medium">Fotos</h2>
      <MediaGallery
        photos={photos}
        maxPhotos={MAX_PHOTOS}
        onAddFile={handleAddFile}
        onReorder={handleReorder}
        onDelete={handleDelete}
      />
    </div>
  );
}
