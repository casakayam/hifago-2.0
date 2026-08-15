"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";

const MAX_PHOTOS = 6;

const SUBMIT_ERRORS: Record<string, string> = {
  product_not_found: "No se encontró la actividad.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  pending_cap_exceeded: "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
  gallery_cap_exceeded: "La galería ya tiene 6 fotos entre publicadas y propuestas.",
  no_photos: "Selecciona una foto.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

// Galerie socio (spec docs/specs/04-gestion-images.md §5) — retirer/reordenar es escritura
// directa (RLS product_media_delete_own / RPC reorder_gallery), pero AÑADIR siempre pasa por
// submit_photos_proposal : nunca aparece en la grilla principal hasta que el admin apruebe (cf.
// invariante "un prestatario nunca introduce contenido no moderado en el catálogo público",
// cahier socio §3f) — se muestra aparte, como "propuesta pendiente".
export function ProductPhotosSocioBlock({
  productId,
  initialPhotos,
  initialPendingCount,
}: {
  productId: string;
  initialPhotos: MediaGalleryPhoto[];
  initialPendingCount: number;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);

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

    const { data, error: rpcError } = await supabase.rpc("submit_photos_proposal", {
      p_product_id: productId,
      p_storage_paths: [uploadResult.storage_path],
    });
    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      return { ok: false, reason: SUBMIT_ERRORS[result?.reason ?? ""] ?? result?.reason ?? rpcError?.message };
    }

    setPendingCount((prev) => prev + 1);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("reorder_gallery", {
      p_entity_type: "product",
      p_entity_id: productId,
      p_ordered_media_ids: orderedIds,
    });
    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      return { ok: false, reason: result?.reason ?? rpcError?.message };
    }
    setPhotos((prev) => orderedIds.map((id) => prev.find((p) => p.id === id)!));
    return { ok: true };
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("product_media").delete().eq("id", id);
    if (deleteError) return { ok: false, reason: deleteError.message };
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Fotos</h2>
      <p className="text-xs text-muted">
        Puedes quitar o reordenar tus fotos publicadas cuando quieras. Añadir una foto nueva envía una
        propuesta que un admin revisa antes de publicarla.
      </p>

      {pendingCount > 0 ? (
        <p role="status" data-testid="pending-photos-proposal" className="text-sm text-muted">
          {pendingCount === 1 ? "1 foto propuesta" : `${pendingCount} fotos propuestas`}, pendiente de
          revisión.
        </p>
      ) : null}

      <MediaGallery
        photos={photos}
        maxPhotos={MAX_PHOTOS}
        addLabel="Proponer foto"
        addHint="La foto se publica solo después de que un admin la apruebe."
        onAddFile={handleAddFile}
        onReorder={handleReorder}
        onDelete={handleDelete}
      />
    </div>
  );
}
