"use client";

import * as React from "react";
import { Button } from "@heroui/react";
import { ImageCrop } from "./image-crop";
import { cn } from "../lib/utils";

export type MediaGalleryPhoto = {
  id: string;
  url: string;
};

export type MediaGalleryProps = {
  photos: MediaGalleryPhoto[];
  maxPhotos: number;
  /** Libellé du bouton d'ajout — "Añadir foto" (admin, écriture directe) ou "Proponer foto"
   * (socio, passe par modération) : même mécanique de crop/upload, seul le libellé et ce que fait
   * addLabelHint changent visuellement (spec docs/specs/04-gestion-images.md §5). */
  addLabel?: string;
  addHint?: string;
  onAddFile: (blob: Blob) => Promise<{ ok: boolean; reason?: string }>;
  onReorder: (orderedIds: string[]) => Promise<{ ok: boolean; reason?: string }>;
  onDelete?: (id: string) => Promise<{ ok: boolean; reason?: string }>;
};

/**
 * Grille de galerie réordonnable — flèches ‹ › de reclassement, PAS de glisser-déposer (repris
 * fidèlement du pattern admin legacy `photoCards()`, public/admin.js:4885-4905, plutôt qu'une
 * lib de drag-and-drop qui ajouterait une dépendance UI hors de celles déjà tranchées par
 * `hifago/CLAUDE.md` §2). Un composant partagé sert identiquement la fiche produit, la fiche
 * établissement (admin) et la galerie socio (retrait/réordonnement direct + proposition d'ajout) —
 * spec docs/specs/04-gestion-images.md §5.
 */
export function MediaGallery({
  photos,
  maxPhotos,
  addLabel = "Añadir foto",
  addHint,
  onAddFile,
  onReorder,
  onDelete,
}: MediaGalleryProps) {
  const [pendingImage, setPendingImage] = React.useState<string | null>(null);
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPendingImage(URL.createObjectURL(file));
  }

  async function handleCropConfirm(blob: Blob) {
    setIsBusy(true);
    setError(null);
    try {
      const result = await onAddFile(blob);
      if (!result.ok) setError(result.reason ?? "No se pudo subir la foto.");
    } finally {
      if (pendingImage) URL.revokeObjectURL(pendingImage);
      setPendingImage(null);
      setIsBusy(false);
    }
  }

  function handleCropCancel() {
    if (pendingImage) URL.revokeObjectURL(pendingImage);
    setPendingImage(null);
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const reordered = [...photos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setIsBusy(true);
    setError(null);
    const result = await onReorder(reordered.map((p) => p.id));
    setIsBusy(false);
    if (!result.ok) setError(result.reason ?? "No se pudo reordenar la galería.");
  }

  async function handleDelete(id: string) {
    if (!onDelete) return;
    setIsBusy(true);
    setError(null);
    const result = await onDelete(id);
    setIsBusy(false);
    if (!result.ok) setError(result.reason ?? "No se pudo eliminar la foto.");
  }

  const atCap = photos.length >= maxPhotos;

  return (
    <div className="flex flex-col gap-3" data-testid="media-gallery">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            className="relative overflow-hidden rounded-md border border-default"
            data-testid="media-gallery-item"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- packages/ui reste indépendant de Next.js */}
            <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
            {index === 0 ? (
              <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                Portada
              </span>
            ) : null}
            <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1">
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  isDisabled={isBusy || index === 0}
                  onPress={() => move(index, -1)}
                  aria-label="Mover a la izquierda"
                  data-testid="media-gallery-move-left"
                >
                  ‹
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  isDisabled={isBusy || index === photos.length - 1}
                  onPress={() => move(index, 1)}
                  aria-label="Mover a la derecha"
                  data-testid="media-gallery-move-right"
                >
                  ›
                </Button>
              </div>
              {onDelete ? (
                <Button
                  variant="outline"
                  size="sm"
                  isDisabled={isBusy}
                  onPress={() => handleDelete(photo.id)}
                  aria-label="Eliminar foto"
                  data-testid="media-gallery-delete"
                >
                  ✕
                </Button>
              ) : null}
            </div>
          </div>
        ))}

        <label
          className={cn(
            "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-default text-sm text-muted",
            (atCap || isBusy) && "pointer-events-none opacity-50"
          )}
          data-testid="media-gallery-add"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileSelected}
            disabled={atCap || isBusy}
          />
          <span>{addLabel}</span>
          <span className="text-xs">
            {photos.length}/{maxPhotos}
          </span>
        </label>
      </div>

      {addHint ? <p className="text-xs text-muted">{addHint}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="media-gallery-error">
          {error}
        </p>
      ) : null}

      {pendingImage ? (
        <div className="rounded-md border border-default p-3" data-testid="media-gallery-crop-panel">
          <ImageCrop imageSrc={pendingImage} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
        </div>
      ) : null}
    </div>
  );
}
