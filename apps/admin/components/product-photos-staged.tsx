"use client";

import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";

const MAX_PHOTOS = 6;

export type StagedPhoto = { path: string; url: string };

// Spec 11 — photos disponibles dès la création, avant que le produit existe (product_media.product_id
// est une FK not null). Reprend le pattern déjà éprouvé en production pour l'établissement
// (NewEstablishmentForm.tsx lignes 81-183) : upload immédiat vers Storage au recadrage confirmé
// (aucune ligne DB encore), state local {path, url}[] tenu par le parent (product-form.tsx),
// rattachement différé (add_catalog_media, boucle non-bloquante) une fois le product_id connu au
// submit. Réutilise le composant partagé MediaGallery (packages/ui, gère déjà son propre affichage
// d'erreur) plutôt que la markup dupliquée à la main de l'établissement — occasion d'unifier
// proprement. `path` (identifiant stable du fichier déjà uploadé dans Storage) sert d'id le temps
// que le produit n'existe pas encore.
export function StagedProductPhotos({
  photos,
  onChange,
}: {
  photos: StagedPhoto[];
  onChange: (next: StagedPhoto[]) => void;
}) {
  async function handleAddFile(blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "photo.png");
    const response = await fetch("/api/upload/product", { method: "POST", body: formData });
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
