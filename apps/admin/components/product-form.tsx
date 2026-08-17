"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { slugify } from "@/lib/utils";
import { asLocalizedField } from "@hifago/domain";
import { Button, Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import {
  LocalizedTextField,
  buildLocalizedPayload,
  type LocalizedValue,
} from "@/components/localized-text-field";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { StayRatesEditor } from "@/components/stay-rates-editor";
import { HotelRoomsEditor } from "@/components/hotel-rooms-editor";
import { PriceTiersEditor } from "@/components/price-tiers-editor";
import { StagedProductPhotos, type StagedPhoto } from "@/components/product-photos-staged";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";
import {
  lowestTierPrice,
  tiersFromColumn,
  toPriceTiersColumn,
  validatePriceTiers,
  type PriceTier,
} from "@/lib/products/priceTiers";
import {
  toSlotRuleRows,
  validateSlotRules,
  type DraftSlotRule,
} from "@/lib/products/slotRules";
import {
  emptyStayRates,
  stayRatesFromColumn,
  toStayRatesColumn,
  validateStayRates,
} from "@/lib/products/stayRates";
import { toRoomTypeRow, validateRoomTypes, type DraftRoomType } from "@/lib/products/hotelRooms";

type Establishment = { id: string; name: unknown; partner_id: string };
type ProductType = "activity" | "evento" | "camp" | "lodging" | "hotel" | "transport";
type OccurrenceType = "once" | "recurring";
type RecurrenceEndKind = "date" | "count" | "none";
type PriceMode = "simple" | "tiers";

export type EditableProduct = {
  id: string;
  name: unknown;
  description: unknown;
  address: string | null;
  lat: number | null;
  lon: number | null;
  price_cop: number | null;
  price_tiers: unknown;
  min_qty: number | null;
  max_qty: number | null;
  check_in_time: string | null;
  check_out_time: string | null;
  capacity: number | null;
  stay_rates: unknown;
  type: string;
  establishment_id: string;
};

// "HH:MM:SS" (sérialisation Postgres d'une colonne time) → "HH:MM" (valeur attendue par
// <Input type="time">) — même conversion que celle déjà faite côté page d'édition pour les
// créneaux (spec 11).
function toTimeInputValue(time: string | null): string {
  return time ? time.slice(0, 5) : "";
}

// Spec 11 — un seul composant pour la création ET l'édition d'un produit (fusionne
// NewProductForm.tsx/EditProductForm.tsx, supprimés) : `product` absent = création, présent =
// édition. Établissement/type restent création-only (immuables après création, comportement
// préexistant) ; les champs evento/camp restent création-only (gap préexistant, jamais éditables
// aujourd'hui, hors scope Jérôme — "on va rester encore sur une activité"). Nom/description/lieu/
// prix-tramos/min-max deviennent identiques dans les deux modes — c'est le cœur du fix demandé.
// Photos/tags/créneaux sont "stagés" en création (rattachés au produit dans le MÊME clic de
// soumission que l'insert, cf. handleSubmit) et délégués en édition à des blocs séparés à
// sauvegarde immédiate rendus par la page (ProductPhotosBlock/ProductTagsBlock/
// ProductSlotRulesBlock), jamais par ce composant.
export function ProductForm({
  establishments = [],
  initialEstablishmentId = "",
  allTags = [],
  product,
}: {
  establishments?: Establishment[];
  initialEstablishmentId?: string;
  allTags?: TagOption[];
  product?: EditableProduct;
}) {
  const router = useRouter();
  const isEditing = Boolean(product);

  const [establishmentId, setEstablishmentId] = useState(initialEstablishmentId);
  const [type, setType] = useState<ProductType>((product?.type as ProductType) ?? "activity");
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(product?.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(product?.description) ?? {}),
  }));
  const [address, setAddress] = useState(product?.address ?? "");
  const [lat, setLat] = useState(product?.lat != null ? String(product.lat) : "");
  const [lon, setLon] = useState(product?.lon != null ? String(product.lon) : "");
  const [priceCop, setPriceCop] = useState(product ? String(product.price_cop ?? 0) : "");

  // Feature 21 (evento vitrine) / Feature 20 (camp) : création-only, jamais éditables aujourd'hui —
  // gap préexistant, non traité par cette spec.
  const [priceLabel, setPriceLabel] = useState("");
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceType>("once");
  const [occurrenceDate, setOccurrenceDate] = useState("");
  const [recurrenceFrequencyDays, setRecurrenceFrequencyDays] = useState("");
  const [recurrenceEndKind, setRecurrenceEndKind] = useState<RecurrenceEndKind>("none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [recurrenceEndCount, setRecurrenceEndCount] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [externalBookingUrl, setExternalBookingUrl] = useState("");
  const [durationDays, setDurationDays] = useState("");

  const hasInitialTiers = Array.isArray(product?.price_tiers) && (product?.price_tiers as unknown[]).length > 0;
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [priceMode, setPriceMode] = useState<PriceMode>(hasInitialTiers ? "tiers" : "simple");
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>(() => tiersFromColumn(product?.price_tiers));
  const [minQty, setMinQty] = useState(product?.min_qty != null ? String(product.min_qty) : "");
  const [maxQty, setMaxQty] = useState(product?.max_qty != null ? String(product.max_qty) : "");
  const [slotRules, setSlotRules] = useState<DraftSlotRule[]>([]);
  const [checkInTime, setCheckInTime] = useState(toTimeInputValue(product?.check_in_time ?? null));
  const [checkOutTime, setCheckOutTime] = useState(toTimeInputValue(product?.check_out_time ?? null));
  const [capacity, setCapacity] = useState(product?.capacity != null ? String(product.capacity) : "");
  const [stayRates, setStayRates] = useState(() =>
    product ? stayRatesFromColumn(product.stay_rates) : emptyStayRates(),
  );
  const [hotelRooms, setHotelRooms] = useState<DraftRoomType[]>([]);
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  const isEvento = type === "evento";
  const isCamp = type === "camp";
  const isActivity = type === "activity";
  const isLodging = type === "lodging";
  const isHotel = type === "hotel";
  const isTransport = type === "transport";
  // Lieu/tags : parcours partagé entre activité, alojamiento, hôtel et transport (spec 12/13/14 —
  // "sensiblement la même chose que les activités"). Prix/tramos/bornes de quantité restent réservés
  // à l'activité/alojamiento/transport : un hôtel n'a pas de prix propre, il vit sur ses chambres
  // (spec 13 §3) ; un transport a bien un prix propre, par tramos de capacité de véhicule plutôt que
  // par produit séparé comme en V1 (spec 14). Check-in/check-out partagés entre alojamiento et hôtel ;
  // capacité/stay_rates restent réservés à l'alojamiento (la capacité d'un hôtel vit désormais par
  // chambre, product_room_types.capacity ; un transport n'a pas de cupo interne, le transporteur
  // dispatche son propre parc — même absence que pour une activité).
  const hasLocationAndTags = isActivity || isLodging || isHotel || isTransport;
  const hasPriceQtyFields = isActivity || isLodging || isTransport;
  const hasCheckInOut = isLodging || isHotel;

  // Même widget que la création d'établissement (docs/specs/01-admin-creation-partenaire.md §5) —
  // repli manuel toujours possible, no-op silencieux si la clé Google Maps est absente.
  useEffect(() => {
    if (!hasLocationAndTags) return;
    const container = addressSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(container, (place) => {
      setAddress(place.address);
      if (place.lat !== null && place.lon !== null) {
        setLat(String(place.lat));
        setLon(String(place.lon));
      }
    });
  }, [hasLocationAndTags]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const nombreEs = name.es?.trim() ?? "";
    const price = Number(priceCop);
    const usesTiers = hasPriceQtyFields && priceMode === "tiers";
    // Un hôtel n'a pas de prix propre (il vit sur ses chambres, product_room_types) — exempté du
    // prix obligatoire comme l'evento, cf. products_price_cop_required_unless_evento (spec 13).
    const needsOwnPrice = !isEvento && !isHotel;

    if (!isEditing) {
      // partner_id n'est jamais saisi indépendamment — dérivé de l'établissement choisi.
      const establishment = establishments.find((item) => item.id === establishmentId);
      if (!establishment || !nombreEs) {
        setError("El nombre (es) y el establecimiento son obligatorios.");
        return;
      }
      if (needsOwnPrice && !usesTiers && (!Number.isFinite(price) || price <= 0)) {
        setError("El precio es obligatorio para este tipo de producto.");
        return;
      }
      if (isEvento && !priceLabel.trim()) {
        setError("El precio en texto libre es obligatorio para un evento.");
        return;
      }
      if (isEvento && occurrenceType === "once" && !occurrenceDate) {
        setError("La fecha es obligatoria para un evento puntual.");
        return;
      }
      if (isEvento && occurrenceType === "recurring" && !recurrenceFrequencyDays) {
        setError("La frecuencia es obligatoria para un evento recurrente.");
        return;
      }
      if (isCamp && (!durationDays || Number(durationDays) < 1)) {
        setError("La duración (días) es obligatoria para un campamento.");
        return;
      }
      if (isActivity) {
        const slotRulesError = validateSlotRules(slotRules);
        if (slotRulesError) {
          setError(slotRulesError);
          return;
        }
      }
      if (isHotel) {
        const roomsError = validateRoomTypes(hotelRooms);
        if (roomsError) {
          setError(roomsError);
          return;
        }
      }
    } else if (!nombreEs) {
      setError("El nombre (es) es obligatorio.");
      return;
    } else if (needsOwnPrice && !usesTiers && (!Number.isFinite(price) || price <= 0)) {
      setError("El precio es obligatorio para este tipo de producto.");
      return;
    }

    if (usesTiers) {
      const tiersError = validatePriceTiers(priceTiers);
      if (tiersError) {
        setError(tiersError);
        return;
      }
    }
    if (hasPriceQtyFields && minQty.trim() && maxQty.trim() && Number(minQty) > Number(maxQty)) {
      setError("La cantidad mínima no puede ser mayor a la máxima.");
      return;
    }
    if (isLodging) {
      if (capacity.trim() && (!Number.isInteger(Number(capacity)) || Number(capacity) <= 0)) {
        setError("La capacidad (número de couchage) debe ser un número entero mayor a 0.");
        return;
      }
      const stayRatesError = validateStayRates(stayRates);
      if (stayRatesError) {
        setError(stayRatesError);
        return;
      }
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const nameJson = buildLocalizedPayload(name) ?? { es: nombreEs };
    const descriptionJson = buildLocalizedPayload(description) ?? null;

    if (isEditing && product) {
      const { error: updateError } = await supabase
        .from("products")
        .update({
          name: nameJson,
          description: descriptionJson,
          ...(hasLocationAndTags
            ? {
                address: address.trim() || null,
                lat: lat.trim() ? Number(lat) : null,
                lon: lon.trim() ? Number(lon) : null,
              }
            : {}),
          price_cop: isHotel ? null : usesTiers ? lowestTierPrice(priceTiers) : price,
          price_tiers: usesTiers ? toPriceTiersColumn(priceTiers) : null,
          ...(hasPriceQtyFields
            ? {
                min_qty: minQty.trim() ? Number(minQty) : null,
                max_qty: maxQty.trim() ? Number(maxQty) : null,
              }
            : {}),
          ...(hasCheckInOut
            ? { check_in_time: checkInTime || null, check_out_time: checkOutTime || null }
            : {}),
          ...(isLodging
            ? {
                capacity: capacity.trim() ? Number(capacity) : null,
                stay_rates: toStayRatesColumn(stayRates),
              }
            : {}),
        })
        .eq("id", product.id);

      if (updateError) {
        setError("No se pudo guardar la actividad.");
        setIsSubmitting(false);
        return;
      }

      router.push(`/admin/establishments/${product.establishment_id}`);
      router.refresh();
      return;
    }

    const establishment = establishments.find((item) => item.id === establishmentId)!;

    const { data: newProduct, error: insertError } = await supabase
      .from("products")
      .insert({
        partner_id: establishment.partner_id,
        establishment_id: establishment.id,
        type,
        name: nameJson,
        description: descriptionJson,
        slug: slugify(nombreEs),
        // Explicitement false à la création (pas la valeur par défaut true de la colonne) : créer
        // un produit ne le rend pas vendable immédiatement (feature 4, bloc séparé).
        sellable: false,
        price_cop: isEvento || isHotel ? null : price,
        duration_days: isCamp ? Number(durationDays) : null,
        ...(isEvento
          ? {
              price_label: priceLabel.trim(),
              occurrence_type: occurrenceType,
              occurrence_date: occurrenceType === "once" ? occurrenceDate : null,
              recurrence_frequency_days:
                occurrenceType === "recurring" ? Number(recurrenceFrequencyDays) : null,
              recurrence_end_date:
                occurrenceType === "recurring" && recurrenceEndKind === "date"
                  ? recurrenceEndDate
                  : null,
              recurrence_end_count:
                occurrenceType === "recurring" && recurrenceEndKind === "count"
                  ? Number(recurrenceEndCount)
                  : null,
              start_time: startTime || null,
              duration_minutes: durationMinutes ? Number(durationMinutes) : null,
              external_booking_url: externalBookingUrl.trim() || null,
            }
          : {}),
        ...(hasLocationAndTags
          ? {
              address: address.trim() || null,
              lat: lat.trim() ? Number(lat) : null,
              lon: lon.trim() ? Number(lon) : null,
            }
          : {}),
        ...(hasPriceQtyFields && priceMode === "tiers"
          ? { price_cop: lowestTierPrice(priceTiers), price_tiers: toPriceTiersColumn(priceTiers) }
          : {}),
        ...(hasPriceQtyFields && minQty.trim() ? { min_qty: Number(minQty) } : {}),
        ...(hasPriceQtyFields && maxQty.trim() ? { max_qty: Number(maxQty) } : {}),
        ...(hasCheckInOut
          ? { check_in_time: checkInTime || null, check_out_time: checkOutTime || null }
          : {}),
        ...(isLodging
          ? {
              capacity: capacity.trim() ? Number(capacity) : null,
              stay_rates: toStayRatesColumn(stayRates),
            }
          : {}),
      })
      .select("id")
      .single();

    if (insertError || !newProduct) {
      setError(
        isEvento
          ? "No se pudo crear el evento."
          : isLodging
            ? "No se pudo crear el alojamiento."
            : isHotel
              ? "No se pudo crear el hotel."
              : isTransport
                ? "No se pudo crear el transporte."
                : "No se pudo crear la actividad.",
      );
      setIsSubmitting(false);
      return;
    }

    // Tags/photos/créneaux/chambres : optionnels, jamais bloquants — un échec ici laisse le produit
    // créé sans cette annexe, corrigible depuis l'édition (même discipline que spec 08 §9/spec 04).
    // Les 4 rattachements ne dépendent que de newProduct.id, jamais les uns des autres : lancés en
    // parallèle plutôt qu'en séquence, le temps total tombe au max des 4 au lieu de leur somme.
    await Promise.all([
      (async () => {
        if (selectedTagIds.length === 0) return;
        const { error: tagsError } = await supabase
          .from("product_tag_assignments")
          .insert(selectedTagIds.map((tagId) => ({ product_id: newProduct.id, tag_id: tagId })));
        if (tagsError) {
          console.warn("[ProductForm] product_tag_assignments a échoué :", tagsError);
        }
      })(),
      (async () => {
        for (const [index, photo] of stagedPhotos.entries()) {
          const { error: mediaError } = await supabase.rpc("add_catalog_media", {
            p_entity_type: "product",
            p_entity_id: newProduct.id,
            p_storage_path: photo.path,
            p_sort: index,
          });
          if (mediaError) {
            console.warn("[ProductForm] add_catalog_media a échoué :", mediaError);
          }
        }
      })(),
      (async () => {
        if (!isActivity || slotRules.length === 0) return;
        const rows = toSlotRuleRows(slotRules).map((row) => ({ product_id: newProduct.id, ...row }));
        const { error: slotRulesError } = await supabase.from("product_slot_rules").insert(rows);
        if (slotRulesError) {
          console.warn("[ProductForm] product_slot_rules a échoué :", slotRulesError);
        }
      })(),
      (async () => {
        if (!isHotel) return;
        // Une chambre à la fois (pas un insert en bloc) : son id est nécessaire pour y attacher
        // ses photos stagées juste après, exactement comme le rattachement photos/tags du produit
        // ci-dessus — non-bloquant, un échec sur une chambre n'annule pas les autres.
        for (const [index, room] of hotelRooms.entries()) {
          const row = toRoomTypeRow(room, index);
          const { data: newRoom, error: roomError } = await supabase
            .from("product_room_types")
            .insert({ product_id: newProduct.id, ...row })
            .select("id")
            .single();
          if (roomError || !newRoom) {
            console.warn("[ProductForm] product_room_types a échoué :", roomError);
            continue;
          }
          for (const photo of room.photos) {
            const { error: mediaError } = await supabase.rpc("add_catalog_media", {
              p_entity_type: "room_type",
              p_entity_id: newRoom.id,
              p_storage_path: photo.path,
            });
            if (mediaError) {
              console.warn("[ProductForm] add_catalog_media (room_type) a échoué :", mediaError);
            }
          }
        }
      })(),
    ]);

    router.push("/admin/establishments");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <LocalizedTextField
        label="Nombre"
        value={name}
        onChange={setName}
        isRequired
        inputName="nombre"
        testIdPrefix="name"
      />

      {!isEditing ? (
        <>
          <Select
            fullWidth
            placeholder="Selecciona un establecimiento"
            value={establishmentId}
            onChange={(value) => value && setEstablishmentId(value as string)}
          >
            <Label>Establecimiento</Label>
            <Select.Trigger data-testid="establishment-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {establishments.map((establishment) => {
                  const resolvedName = asLocalizedField(establishment.name);
                  const label = (resolvedName?.es ?? resolvedName?.en) || establishment.id;
                  return (
                    <ListBox.Item key={establishment.id} id={establishment.id} textValue={label}>
                      {label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  );
                })}
              </ListBox>
            </Select.Popover>
          </Select>
          <Select fullWidth value={type} onChange={(value) => value && setType(value as ProductType)}>
            <Label>Tipo</Label>
            <Select.Trigger data-testid="type-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="activity" textValue="Actividad">
                  Actividad
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="transport" textValue="Transporte">
                  Transporte
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="evento" textValue="Evento (vitrina)">
                  Evento (vitrina)
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="camp" textValue="Campamento">
                  Campamento
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="lodging" textValue="Alojamiento">
                  Alojamiento
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="hotel" textValue="Hotel">
                  Hotel
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </>
      ) : null}

      <LocalizedTextField
        label="Descripción — opcional"
        value={description}
        onChange={setDescription}
        multiline
        testIdPrefix="description"
        fieldTestId="description-textarea"
      />

      {hasLocationAndTags ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address-search">Buscar dirección (Google) — opcional</Label>
            <div id="address-search" ref={addressSearchRef} data-testid="address-search" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
              data-testid="address-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lat">Latitud — detectada o manual</Label>
              <Input id="lat" value={lat} onChange={(event) => setLat(event.target.value)} data-testid="lat-input" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lon">Longitud — detectada o manual</Label>
              <Input id="lon" value={lon} onChange={(event) => setLon(event.target.value)} data-testid="lon-input" />
            </div>
          </div>
        </>
      ) : null}

      {!isEditing ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fotos — opcional</Label>
          <StagedProductPhotos photos={stagedPhotos} onChange={setStagedPhotos} />
        </div>
      ) : null}

      {!isEditing && hasLocationAndTags ? (
        <TagsMultiSelect
          availableTags={allTags}
          selectedTagIds={selectedTagIds}
          onChange={setSelectedTagIds}
          testId="tags-multiselect"
        />
      ) : null}

      {!isEvento && !hasLocationAndTags ? (
        <TextField fullWidth name="price" value={priceCop} onChange={setPriceCop} isRequired>
          <Label>Precio (COP)</Label>
          <Input id="price" type="number" min={1} />
        </TextField>
      ) : null}

      {hasPriceQtyFields ? (
        <div className="flex flex-col gap-2">
          <PriceTiersEditor
            priceMode={priceMode}
            onPriceModeChange={setPriceMode}
            priceCop={priceCop}
            onPriceCopChange={setPriceCop}
            priceTiers={priceTiers}
            onPriceTiersChange={setPriceTiers}
            testId={(part, tierIndex) => {
              switch (part) {
                case "toggle":
                  return "price-mode-toggle";
                case "simple-input":
                  return "price-input";
                case "tiers-editor":
                  return "price-tiers-editor";
                case "add-tier":
                  return "add-price-tier-button";
                case "tier-min":
                  return `price-tier-min-${tierIndex}`;
                case "tier-max":
                  return `price-tier-max-${tierIndex}`;
                case "tier-price":
                  return `price-tier-price-${tierIndex}`;
                case "remove-tier":
                  return `remove-price-tier-${tierIndex}`;
              }
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField value={minQty} onChange={setMinQty}>
              <Label>{isLodging ? "Huéspedes mínimos — opcional" : "Cantidad mínima — opcional"}</Label>
              <Input type="number" min={1} data-testid="min-qty-input" />
            </TextField>
            <TextField value={maxQty} onChange={setMaxQty}>
              <Label>{isLodging ? "Huéspedes máximos — opcional" : "Cantidad máxima — opcional"}</Label>
              <Input type="number" min={1} data-testid="max-qty-input" />
            </TextField>
          </div>
        </div>
      ) : null}

      {hasCheckInOut ? (
        <div className={isLodging ? "grid grid-cols-3 gap-4" : "grid grid-cols-2 gap-4"}>
          <TextField fullWidth name="check-in" value={checkInTime} onChange={setCheckInTime}>
            <Label>Check-in — opcional</Label>
            <Input type="time" data-testid="check-in-input" />
          </TextField>
          <TextField fullWidth name="check-out" value={checkOutTime} onChange={setCheckOutTime}>
            <Label>Check-out — opcional</Label>
            <Input type="time" data-testid="check-out-input" />
          </TextField>
          {isLodging ? (
            <TextField fullWidth name="capacity" value={capacity} onChange={setCapacity}>
              <Label>Capacidad (couchage) — opcional</Label>
              <Input type="number" min={1} data-testid="capacity-input" />
            </TextField>
          ) : null}
        </div>
      ) : null}

      {isLodging ? <StayRatesEditor value={stayRates} onChange={setStayRates} /> : null}

      {!isEditing && isHotel ? (
        <div className="flex flex-col gap-1.5">
          <Label>Habitaciones — opcional</Label>
          <HotelRoomsEditor rooms={hotelRooms} onChange={setHotelRooms} />
        </div>
      ) : null}

      {isCamp ? (
        <TextField
          fullWidth
          name="duration-days"
          value={durationDays}
          onChange={setDurationDays}
          isRequired
        >
          <Label>Duración (días)</Label>
          <Input type="number" min={1} data-testid="duration-days-input" />
        </TextField>
      ) : null}

      {isEvento ? (
        <>
          <TextField
            fullWidth
            name="price-label"
            value={priceLabel}
            onChange={setPriceLabel}
            isRequired
          >
            <Label>Precio (texto libre)</Label>
            <Input
              placeholder="Ej. Desde $50.000 COP, entrada gratuita…"
              data-testid="price-label-input"
            />
          </TextField>

          <Select
            fullWidth
            value={occurrenceType}
            onChange={(value) => value && setOccurrenceType(value as OccurrenceType)}
          >
            <Label>Ocurrencia</Label>
            <Select.Trigger data-testid="occurrence-type-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="once" textValue="Puntual">
                  Puntual
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="recurring" textValue="Recurrente">
                  Recurrente
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          {occurrenceType === "once" ? (
            <TextField
              fullWidth
              name="occurrence-date"
              value={occurrenceDate}
              onChange={setOccurrenceDate}
              isRequired
            >
              <Label>Fecha</Label>
              <Input type="date" data-testid="occurrence-date-input" />
            </TextField>
          ) : (
            <>
              <TextField
                fullWidth
                name="recurrence-frequency"
                value={recurrenceFrequencyDays}
                onChange={setRecurrenceFrequencyDays}
                isRequired
              >
                <Label>Frecuencia (días)</Label>
                <Input type="number" min={1} data-testid="recurrence-frequency-input" />
              </TextField>
              <Select
                fullWidth
                value={recurrenceEndKind}
                onChange={(value) => value && setRecurrenceEndKind(value as RecurrenceEndKind)}
              >
                <Label>Fin de la recurrencia</Label>
                <Select.Trigger data-testid="recurrence-end-select">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="none" textValue="Indefinida">
                      Indefinida
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="date" textValue="Hasta una fecha">
                      Hasta una fecha
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="count" textValue="Número de repeticiones">
                      Número de repeticiones
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              {recurrenceEndKind === "date" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-date"
                  value={recurrenceEndDate}
                  onChange={setRecurrenceEndDate}
                  isRequired
                >
                  <Label>Fecha de fin</Label>
                  <Input type="date" data-testid="recurrence-end-date-input" />
                </TextField>
              ) : null}
              {recurrenceEndKind === "count" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-count"
                  value={recurrenceEndCount}
                  onChange={setRecurrenceEndCount}
                  isRequired
                >
                  <Label>Número de repeticiones</Label>
                  <Input type="number" min={1} data-testid="recurrence-end-count-input" />
                </TextField>
              ) : null}
            </>
          )}

          <TextField fullWidth name="start-time" value={startTime} onChange={setStartTime}>
            <Label>Hora de inicio — opcional</Label>
            <Input type="time" />
          </TextField>
          <TextField
            fullWidth
            name="duration"
            value={durationMinutes}
            onChange={setDurationMinutes}
          >
            <Label>Duración (minutos) — opcional</Label>
            <Input type="number" min={1} />
          </TextField>
          <TextField
            fullWidth
            name="external-booking-url"
            value={externalBookingUrl}
            onChange={setExternalBookingUrl}
          >
            <Label>Enlace de reserva externo</Label>
            <Input type="url" placeholder="https://…" data-testid="external-booking-url-input" />
          </TextField>
        </>
      ) : null}

      {!isEditing && isActivity ? (
        <div className="flex flex-col gap-1.5">
          <Label>Horarios — opcional</Label>
          <SlotRulesEditor rules={slotRules} onChange={setSlotRules} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        isDisabled={isSubmitting}
        data-testid={isEditing ? "save-product-button" : "create-product-button"}
      >
        {isEditing
          ? isSubmitting
            ? "Guardando…"
            : "Guardar cambios"
          : isSubmitting
            ? "Creando…"
            : isEvento
              ? "Crear evento"
              : isLodging
                ? "Crear alojamiento"
                : isHotel
                  ? "Crear hotel"
                  : isTransport
                    ? "Crear transporte"
                    : "Crear actividad"}
      </Button>
    </form>
  );
}
