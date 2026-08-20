"use client";

import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";

const MAX_PHOTOS = 6;

export type StagedPhoto = { path: string; url: string };

// Miroir de StagedProductPhotos (product-photos-staged.tsx, spec 11) pour l'établissement — même
// besoin structurel : des photos disponibles dès la création, avant que l'établissement existe
// (establishment_media.establishment_id est une FK not null). Upload immédiat vers Storage au
// recadrage confirmé (aucune ligne DB encore), state local {path, url}[] tenu par le parent
// (NewEstablishmentProposalForm.tsx), rattachement différé (establishment_media) une fois
// l'establishment_id connu, à l'approbation admin — cf. migration
// <horodatage>_establishment_creation_proposal_photos.sql.
export function StagedEstablishmentPhotos({
  photos,
  onChange,
}: {
  photos: StagedPhoto[];
  onChange: (next: StagedPhoto[]) => void;
}) {
  async function handleAddFile(blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "photo.png");
    const response = await fetch("/api/upload/establishment", { method: "POST", body: formData });
    const result = (await response.json()) as
      | { ok: true; storage_path: string }
      | { ok: false; reason: string };

    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    onChange([...photos, { path: result.storage_path, url: URL.createObjectURL(blob) }]);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    onChange(orderedIds.map((path) => photos.find((photo) => photo.path === path)!));
    return { ok: true };
  }

  async function handleDelete(path: string) {
    onChange(photos.filter((photo) => photo.path !== path));
    return { ok: true };
  }

  const galleryPhotos: MediaGalleryPhoto[] = photos.map((photo) => ({ id: photo.path, url: photo.url }));

  return (
    <MediaGallery
      photos={galleryPhotos}
      maxPhotos={MAX_PHOTOS}
      onAddFile={handleAddFile}
      onReorder={handleReorder}
      onDelete={handleDelete}
    />
  );
}
