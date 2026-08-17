"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Input, Label, ListBox, MediaGallery, Select, TextField, type MediaGalleryPhoto } from "@hifago/ui";
import { createClient } from "@hifago/supabase/client";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { PriceTiersEditor } from "@/components/price-tiers-editor";
import { StayRatesEditor } from "@/components/stay-rates-editor";
import {
  emptyRoomType,
  KIND_LABELS,
  type DraftRoomType,
  type RoomKind,
} from "@/lib/products/hotelRooms";

const MAX_PHOTOS = 6;

// Spec 13 — éditeur de chambres d'un hôtel. Composant UI pur, contrôlé (rooms/onChange), AUCUN I/O
// réseau pour les champs scalaires — même discipline que SlotRulesEditor/StayRatesEditor. Chaque
// chambre porte son propre nom i18n, son propre prix (simple ou tramos), son propre prix par
// période (StayRatesEditor réutilisé de la spec 12) et sa propre galerie de photos.
//
// Seule exception au "aucun I/O réseau" : la galerie photo d'une chambre déjà enregistrée (room.id
// présent) écrit directement (add_catalog_media/reorder_gallery/delete), comme ProductPhotosBlock
// au niveau produit — une chambre sans id encore (création, ou ajoutée pendant une édition avant
// le premier "Guardar") reste en photos "stagées" (upload différé, même pattern que
// StagedProductPhotos), rattachées après coup par l'appelant une fois l'id connu.
export function HotelRoomsEditor({
  rooms,
  onChange,
}: {
  rooms: DraftRoomType[];
  // Dispatch, pas un simple callback : LocalizedTextField (nom/description) appelle TOUJOURS son
  // onChange avec une forme fonctionnelle (Dispatch<SetStateAction<LocalizedValue>>) — la résoudre
  // immédiatement contre une valeur capturée dans la closure de ce render (plutôt que de la
  // relayer, elle aussi fonctionnelle, jusqu'au vrai setState du parent) réintroduit la course déjà
  // corrigée en spec 11 (perte de la valeur ES lors d'une bascule de langue rapide).
  onChange: Dispatch<SetStateAction<DraftRoomType[]>>;
}) {
  function updateRoom(index: number, next: DraftRoomType | ((prev: DraftRoomType) => DraftRoomType)) {
    onChange((prevRooms) =>
      prevRooms.map((room, i) => (i === index ? (typeof next === "function" ? next(room) : next) : room)),
    );
  }

  function removeRoom(index: number) {
    onChange((prevRooms) => prevRooms.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="hotel-rooms-editor">
      {rooms.map((room, index) => (
        <RoomCard key={index} room={room} index={index} onUpdate={updateRoom} onRemove={removeRoom} />
      ))}
      <button
        type="button"
        onClick={() => onChange((prevRooms) => [...prevRooms, emptyRoomType()])}
        data-testid="add-room-button"
        className="self-start text-xs font-medium underline"
      >
        + Agregar habitación
      </button>
    </div>
  );
}

// Extrait en sous-composant (plutôt qu'inline dans .map()) parce que la galerie d'une chambre déjà
// enregistrée a besoin de son propre état local (photos "live", tenues à jour au fil des actions
// Supabase immédiates) — un Hook ne peut pas vivre dans le corps d'une callback .map().
function RoomCard({
  room,
  index,
  onUpdate,
  onRemove,
}: {
  room: DraftRoomType;
  index: number;
  // Forme fonctionnelle acceptée (comme onChange au niveau HotelRoomsEditor) et TOUJOURS utilisée
  // ci-dessous, même pour les champs scalaires synchrones : les handlers photo font un `await
  // fetch(...)` avant d'appeler onUpdate, et pendant cette attente un autre champ (ex. la case
  // stay_rates) peut être modifié — si ce champ mergeait contre `room` capturé dans la closure du
  // rendu au lieu de l'état réellement courant au moment où React applique la mise à jour, le
  // dernier des deux à s'appliquer écraserait le premier avec sa propre valeur de `room` périmée.
  // Même classe de bug déjà corrigée pour LocalizedTextField/la course array-level (spec 11) —
  // généralisée ici à tous les champs de RoomCard plutôt que juste aux 3 handlers réseau, pour ne
  // laisser aucune combinaison de deux mises à jour concurrentes retomber dans le même piège.
  onUpdate: (index: number, next: DraftRoomType | ((prev: DraftRoomType) => DraftRoomType)) => void;
  onRemove: (index: number) => void;
}) {
  const [savedPhotos, setSavedPhotos] = useState<MediaGalleryPhoto[]>(room.savedPhotos);

  function updateLocalizedField(
    field: "name" | "description",
    next: LocalizedValue | ((prev: LocalizedValue) => LocalizedValue),
  ) {
    onUpdate(index, (prev) => ({
      ...prev,
      [field]: typeof next === "function" ? next(prev[field]) : next,
    }));
  }

  async function handleAddFile(blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "photo.png");
    const uploadResponse = await fetch("/api/upload/product", { method: "POST", body: formData });
    const uploadResult = (await uploadResponse.json()) as
      | { ok: true; storage_path: string }
      | { ok: false; reason: string };
    if (!uploadResult.ok) {
      return { ok: false, reason: uploadResult.reason };
    }

    if (!room.id) {
      onUpdate(index, (prev) => ({
        ...prev,
        photos: [...prev.photos, { path: uploadResult.storage_path, url: URL.createObjectURL(blob) }],
      }));
      return { ok: true };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("add_catalog_media", {
      p_entity_type: "room_type",
      p_entity_id: room.id,
      p_storage_path: uploadResult.storage_path,
    });
    if (error || !data) {
      return { ok: false, reason: error?.message ?? "No se pudo añadir la foto." };
    }
    const { data: publicUrl } = supabase.storage.from("catalog-media").getPublicUrl(uploadResult.storage_path);
    setSavedPhotos((prev) => [...prev, { id: data as string, url: publicUrl.publicUrl }]);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    if (!room.id) {
      onUpdate(index, (prev) => ({
        ...prev,
        photos: orderedIds.map((path) => prev.photos.find((photo) => photo.path === path)!),
      }));
      return { ok: true };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("reorder_gallery", {
      p_entity_type: "room_type",
      p_entity_id: room.id,
      p_ordered_media_ids: orderedIds,
    });
    const result = data as { ok: boolean; reason?: string } | null;
    if (error || !result?.ok) {
      return { ok: false, reason: result?.reason ?? error?.message };
    }
    setSavedPhotos((prev) => orderedIds.map((id) => prev.find((p) => p.id === id)!));
    return { ok: true };
  }

  async function handleDelete(idOrPath: string) {
    if (!room.id) {
      onUpdate(index, (prev) => ({ ...prev, photos: prev.photos.filter((photo) => photo.path !== idOrPath) }));
      return { ok: true };
    }

    const supabase = createClient();
    const { error } = await supabase.from("room_media").delete().eq("id", idOrPath);
    if (error) return { ok: false, reason: error.message };
    setSavedPhotos((prev) => prev.filter((p) => p.id !== idOrPath));
    return { ok: true };
  }

  const galleryPhotos: MediaGalleryPhoto[] = room.id
    ? savedPhotos
    : room.photos.map((photo) => ({ id: photo.path, url: photo.url }));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-default p-3" data-testid={`room-${index}`}>
      <Select
        fullWidth
        value={room.kind}
        onChange={(value) => value && onUpdate(index, (prev) => ({ ...prev, kind: value as RoomKind }))}
      >
        <Label>Tipo de habitación</Label>
        <Select.Trigger data-testid={`room-kind-${index}`}>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="dorm" textValue={KIND_LABELS.dorm}>
              {KIND_LABELS.dorm}
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="private" textValue={KIND_LABELS.private}>
              {KIND_LABELS.private}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>

      <LocalizedTextField
        label="Nombre — opcional"
        value={room.name}
        onChange={(next) => updateLocalizedField("name", next)}
        inputName={`room-name-${index}`}
        testIdPrefix={`room-name-${index}`}
        fieldTestId={`room-name-input-${index}`}
      />
      <LocalizedTextField
        label="Descripción — opcional"
        value={room.description}
        onChange={(next) => updateLocalizedField("description", next)}
        multiline
        testIdPrefix={`room-description-${index}`}
        fieldTestId={`room-description-textarea-${index}`}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Fotos — opcional</Label>
        <MediaGallery
          photos={galleryPhotos}
          maxPhotos={MAX_PHOTOS}
          onAddFile={handleAddFile}
          onReorder={handleReorder}
          onDelete={handleDelete}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TextField
          value={room.capacity}
          onChange={(value) => onUpdate(index, (prev) => ({ ...prev, capacity: value }))}
        >
          <Label>Capacidad</Label>
          <Input type="number" min={1} data-testid={`room-capacity-${index}`} />
        </TextField>
        <TextField
          value={room.quantity}
          onChange={(value) => onUpdate(index, (prev) => ({ ...prev, quantity: value }))}
        >
          <Label>Cantidad de habitaciones — opcional</Label>
          <Input type="number" min={1} data-testid={`room-quantity-${index}`} />
        </TextField>
      </div>

      <PriceTiersEditor
        priceMode={room.priceMode}
        onPriceModeChange={(priceMode) => onUpdate(index, (prev) => ({ ...prev, priceMode }))}
        priceCop={room.priceCop}
        onPriceCopChange={(priceCop) => onUpdate(index, (prev) => ({ ...prev, priceCop }))}
        priceTiers={room.priceTiers}
        onPriceTiersChange={(priceTiers) => onUpdate(index, (prev) => ({ ...prev, priceTiers }))}
        testId={(part, tierIndex) => {
          switch (part) {
            case "toggle":
              return `room-price-mode-toggle-${index}`;
            case "simple-input":
              return `room-price-input-${index}`;
            case "tiers-editor":
              return `room-price-tiers-editor-${index}`;
            case "add-tier":
              return `add-room-price-tier-${index}`;
            case "tier-min":
              return `room-price-tier-min-${index}-${tierIndex}`;
            case "tier-max":
              return `room-price-tier-max-${index}-${tierIndex}`;
            case "tier-price":
              return `room-price-tier-price-${index}-${tierIndex}`;
            case "remove-tier":
              return `remove-room-price-tier-${index}-${tierIndex}`;
          }
        }}
      />

      <div className="grid grid-cols-2 gap-2">
        <TextField
          value={room.minQty}
          onChange={(value) => onUpdate(index, (prev) => ({ ...prev, minQty: value }))}
        >
          <Label>Cantidad mínima — opcional</Label>
          <Input type="number" min={1} data-testid={`room-min-qty-${index}`} />
        </TextField>
        <TextField
          value={room.maxQty}
          onChange={(value) => onUpdate(index, (prev) => ({ ...prev, maxQty: value }))}
        >
          <Label>Cantidad máxima — opcional</Label>
          <Input type="number" min={1} data-testid={`room-max-qty-${index}`} />
        </TextField>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Precio por período — opcional</Label>
        <StayRatesEditor
          value={room.stayRates}
          onChange={(stayRates) => onUpdate(index, (prev) => ({ ...prev, stayRates }))}
          testIdPrefix={`room-${index}-`}
        />
      </div>

      <button
        type="button"
        onClick={() => onRemove(index)}
        data-testid={`remove-room-${index}`}
        className="self-start text-xs font-medium text-danger underline"
      >
        Quitar habitación
      </button>
    </div>
  );
}
