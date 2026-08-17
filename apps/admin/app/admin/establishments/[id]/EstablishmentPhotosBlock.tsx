"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";

const MAX_PHOTOS = 6;

// Galerie établissement post-création (spec docs/specs/04-gestion-images.md §5) — même bloc
// partagé que ProductPhotosBlock (apps/admin/app/admin/products/[id]/edit). Généralise la galerie
// aux deux modes d'établissement (comble hifago/docs/00-modele-de-donnees.md:105) : ni le mode ni
// le nombre de chambres n'entrent en jeu ici, la galerie est la même pour tout établissement.
export function EstablishmentPhotosBlock({
  establishmentId,
  initialPhotos,
}: {
  establishmentId: string;
  initialPhotos: MediaGalleryPhoto[];
}) {
  const [photos, setPhotos] = useState(initialPhotos);

  async function handleAddFile(blob: Blob) {
    const supabase = createClient();

    const formData = new FormData();
    formData.append("file", blob, "photo.png");
    const uploadResponse = await fetch("/api/upload/establishment", { method: "POST", body: formData });
    const uploadResult = (await uploadResponse.json()) as
      | { ok: true; storage_path: string }
      | { ok: false; reason: string };

    if (!uploadResult.ok) {
      return { ok: false, reason: uploadResult.reason };
    }

    const { data, error } = await supabase.rpc("add_catalog_media", {
      p_entity_type: "establishment",
      p_entity_id: establishmentId,
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
      p_entity_type: "establishment",
      p_entity_id: establishmentId,
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
    const { error } = await supabase.from("establishment_media").delete().eq("id", id);
    if (error) return { ok: false, reason: error.message };
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    return { ok: true };
  }

  return (
    <div className="rounded-lg border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Fotos del establecimiento</h2>
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
