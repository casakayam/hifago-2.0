"use client";

import * as React from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button, Slider } from "@heroui/react";

/**
 * Recadrage image en mémoire navigateur (spec docs/specs/04-gestion-images.md §10) —
 * `react-easy-crop` choisi headless (aucune UI/CSS embarquée, juste la géométrie + un callback
 * pixel) précisément pour pouvoir l'habiller en HeroUI (Slider pour le zoom, Button pour
 * confirmer) sans dupliquer un second design system (`hifago/CLAUDE.md` §2 point 2) — contrairement
 * à `cropperjs`, qui embarque sa propre UI. Rien n'est jamais écrit sur disque ici : le crop
 * produit un `Blob` en mémoire, à envoyer tel quel au Route Handler d'upload (contre le gap G5).
 */
export type ImageCropProps = {
  imageSrc: string;
  /** Largeur/hauteur, ex. 4/3 ou 1 pour un carré — undefined = recadrage libre. */
  aspect?: number;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
};

export function ImageCrop({ imageSrc, aspect, onCancel, onConfirm }: ImageCropProps) {
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setIsProcessing(true);
    try {
      const blob = await cropImageToBlob(imageSrc, croppedAreaPixels);
      onConfirm(blob);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-80 w-full overflow-hidden rounded-md bg-black" data-testid="image-crop-stage">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_area, areaPixels) => setCroppedAreaPixels(areaPixels)}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">Zoom</span>
        <Slider
          className="flex-1"
          value={[zoom]}
          onChange={(value) => setZoom(Array.isArray(value) ? value[0]! : value)}
          minValue={1}
          maxValue={3}
          step={0.1}
          aria-label="Zoom de recadrage"
          data-testid="image-crop-zoom"
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onPress={onCancel} isDisabled={isProcessing} data-testid="image-crop-cancel">
          Cancelar
        </Button>
        <Button
          onPress={handleConfirm}
          isDisabled={isProcessing || !croppedAreaPixels}
          data-testid="image-crop-confirm"
        >
          {isProcessing ? "Procesando…" : "Confirmar recorte"}
        </Button>
      </div>
    </div>
  );
}

// Recette standard react-easy-crop (dessin sur un canvas hors-écran) — jamais d'écriture disque,
// le résultat reste un Blob en mémoire jusqu'à l'envoi au Route Handler.
async function cropImageToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context indisponible");

  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Échec de la conversion du recadrage en blob"));
    }, "image/png");
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
