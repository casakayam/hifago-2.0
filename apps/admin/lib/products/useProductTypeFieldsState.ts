"use client";

import { useState } from "react";
import { tiersFromColumn, type PriceTier } from "@/lib/products/priceTiers";
import { emptyStayRates, stayRatesFromColumn, type DraftStayRates } from "@/lib/products/stayRates";
import { slotRulesFromColumn, type DraftSlotRule } from "@/lib/products/slotRules";
import { roomTypesFromColumn, type DraftRoomType } from "@/lib/products/hotelRooms";

export type ProductType = "activity" | "evento" | "camp" | "lodging" | "hotel" | "transport";
export type OccurrenceType = "once" | "recurring";
export type RecurrenceEndKind = "date" | "count" | "none";
export type PriceMode = "simple" | "tiers";

// Gating par type — miroir exact de ProductForm (spec 11/12/13/14), la SEULE définition de ces 3
// booléens dans tout le projet : ProductForm, ProductTypeFields et
// ModerateProductCreationProposalForm l'importent tous d'ici plutôt que de la recalculer chacun de
// leur côté (risque de divergence déjà rencontré à chaque évolution de gating, specs 11→14).
export function productTypeGating(type: ProductType) {
  const isEvento = type === "evento";
  const isCamp = type === "camp";
  const isActivity = type === "activity";
  const isLodging = type === "lodging";
  const isHotel = type === "hotel";
  const isTransport = type === "transport";
  return {
    isEvento,
    isCamp,
    isActivity,
    isLodging,
    isHotel,
    isTransport,
    hasLocationAndTags: isActivity || isLodging || isHotel || isTransport,
    // Retour Jérôme (2026-08-18) : un camp a aussi des "servicios incluidos" (desayuno, transporte,
    // guía…) qui doivent être des tags comme pour les autres types, pour pouvoir un jour trier/
    // filtrer dessus — camp n'a en revanche pas besoin d'adresse propre (déjà celle de son
    // établissement), d'où un booléen SÉPARÉ de hasLocationAndTags plutôt qu'un ajout à ce dernier
    // (qui aurait aussi fait apparaître les champs adresse/lat/lon, jamais demandés pour camp).
    hasTags: isActivity || isLodging || isHotel || isTransport || isCamp,
    hasPriceQtyFields: isActivity || isLodging || isTransport,
    hasCheckInOut: isLodging || isHotel,
    // Types qui matérialisent product_availability à date unique (create_order /
    // modify_order_line) — seuls ceux-là peuvent porter un cupo par défaut. evento : pas encore
    // réellement réservable côté client. lodging/hotel : ont déjà leurs propres modèles de
    // capacité (capacity/couchage, room_type_availability) — hors périmètre.
    hasDefaultCapacity: isActivity || isCamp || isTransport,
  };
}

// Quel(s) écran(s) de cupos/disponibilité afficher pour un produit, à partir de son type et de la
// présence d'au moins une règle de créneaux (product_slot_rules) — SEULE définition de ce gating
// dans tout le projet (avant cette extraction, dupliqué ad hoc entre
// apps/admin/app/admin/products/[id]/edit/page.tsx — showAvailabilityLink/isHotel/isActivity &&
// slotRulesRaw.length > 0 — et apps/admin/app/partner/(app)/products/ProductsGrid.tsx, qui se
// contentait de commenter "même gating de type que .../edit/page.tsx" sans jamais rien importer).
// 'slot' N'EXCLUT PAS 'generic' : une activité qui porte des règles de créneaux garde son lien
// générique product_availability (cupo/estado par jour) EN PLUS du lien horaires×dates dédié — les
// deux calendriers sont indépendants, jamais l'un à la place de l'autre. Les appelants traitent
// donc 'slot' comme "afficher le lien générique ET le lien créneaux", pas comme un remplacement
// (cf. leur propre commentaire au point d'appel).
export function availabilityScreenFor(
  type: ProductType,
  hasSlotRules: boolean,
): "generic" | "room" | "slot" | "none" {
  if (type === "hotel") return "room";
  if (type === "evento") return "none";
  if (type === "activity" && hasSlotRules) return "slot";
  return "generic";
}

// "HH:MM:SS" (sérialisation Postgres d'une colonne time, ou payload d'une proposition qui la
// reprend telle quelle) → "HH:MM" (valeur attendue par <Input type="time">).
function toTimeInputValue(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}

// Hydrate l'état depuis l'une de deux sources possibles, jamais les deux à la fois : un
// EditableProduct (colonnes réelles, ProductForm en mode édition) ou un payload de proposition de
// création (product_proposals.payload, ModerateProductCreationProposalForm) — même forme dans les
// deux cas puisque le payload est justement construit pour correspondre aux colonnes.
export type ProductTypeFieldsInit = {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  tagIds?: string[];
  priceCop?: number | null;
  priceTiers?: unknown;
  minQty?: number | null;
  maxQty?: number | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  capacity?: number | null;
  defaultCapacity?: number | null;
  stayRates?: unknown;
  roomTypes?: unknown;
  durationDays?: number | null;
  slotRules?: unknown;
  priceLabel?: string | null;
  occurrenceType?: OccurrenceType;
  occurrenceDate?: string | null;
  recurrenceFrequencyDays?: number | null;
  recurrenceEndDate?: string | null;
  recurrenceEndCount?: number | null;
  startTime?: string | null;
  durationMinutes?: number | null;
  externalBookingUrl?: string | null;
};

// Extrait de ProductForm (spec 15) pour être consommé par deux rendus distincts du même gating par
// type — le formulaire (admin-direct ET socio-proposal) et l'écran de modération admin d'une
// proposition de création — sans jamais dupliquer la logique de champs par type à deux endroits
// (cf. journal 2026-08-17, décision Jérôme "extraire plutôt que dupliquer").
export function useProductTypeFieldsState(init: ProductTypeFieldsInit = {}) {
  const [address, setAddress] = useState(init.address ?? "");
  const [lat, setLat] = useState(init.lat != null ? String(init.lat) : "");
  const [lon, setLon] = useState(init.lon != null ? String(init.lon) : "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(init.tagIds ?? []);

  const hasInitialTiers = Array.isArray(init.priceTiers) && (init.priceTiers as unknown[]).length > 0;
  const [priceMode, setPriceMode] = useState<PriceMode>(hasInitialTiers ? "tiers" : "simple");
  const [priceCop, setPriceCop] = useState(init.priceCop != null ? String(init.priceCop) : "");
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>(() => tiersFromColumn(init.priceTiers));
  const [minQty, setMinQty] = useState(init.minQty != null ? String(init.minQty) : "");
  const [maxQty, setMaxQty] = useState(init.maxQty != null ? String(init.maxQty) : "");

  const [checkInTime, setCheckInTime] = useState(toTimeInputValue(init.checkInTime));
  const [checkOutTime, setCheckOutTime] = useState(toTimeInputValue(init.checkOutTime));
  const [capacity, setCapacity] = useState(init.capacity != null ? String(init.capacity) : "");
  const [defaultCapacity, setDefaultCapacity] = useState(
    init.defaultCapacity != null ? String(init.defaultCapacity) : "",
  );
  const [stayRates, setStayRates] = useState<DraftStayRates>(() =>
    init.stayRates ? stayRatesFromColumn(init.stayRates) : emptyStayRates(),
  );
  const [hotelRooms, setHotelRooms] = useState<DraftRoomType[]>(() => roomTypesFromColumn(init.roomTypes));
  const [durationDays, setDurationDays] = useState(init.durationDays != null ? String(init.durationDays) : "");
  const [slotRules, setSlotRules] = useState<DraftSlotRule[]>(() => slotRulesFromColumn(init.slotRules));

  const [priceLabel, setPriceLabel] = useState(init.priceLabel ?? "");
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceType>(init.occurrenceType ?? "once");
  const [occurrenceDate, setOccurrenceDate] = useState(init.occurrenceDate ?? "");
  const [recurrenceFrequencyDays, setRecurrenceFrequencyDays] = useState(
    init.recurrenceFrequencyDays != null ? String(init.recurrenceFrequencyDays) : "",
  );
  const [recurrenceEndKind, setRecurrenceEndKind] = useState<RecurrenceEndKind>(
    init.recurrenceEndDate ? "date" : init.recurrenceEndCount != null ? "count" : "none",
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(init.recurrenceEndDate ?? "");
  const [recurrenceEndCount, setRecurrenceEndCount] = useState(
    init.recurrenceEndCount != null ? String(init.recurrenceEndCount) : "",
  );
  const [startTime, setStartTime] = useState(toTimeInputValue(init.startTime));
  const [durationMinutes, setDurationMinutes] = useState(
    init.durationMinutes != null ? String(init.durationMinutes) : "",
  );
  const [externalBookingUrl, setExternalBookingUrl] = useState(init.externalBookingUrl ?? "");

  return {
    address, setAddress, lat, setLat, lon, setLon,
    selectedTagIds, setSelectedTagIds,
    priceMode, setPriceMode, priceCop, setPriceCop, priceTiers, setPriceTiers,
    minQty, setMinQty, maxQty, setMaxQty,
    checkInTime, setCheckInTime, checkOutTime, setCheckOutTime,
    capacity, setCapacity, defaultCapacity, setDefaultCapacity, stayRates, setStayRates,
    hotelRooms, setHotelRooms,
    durationDays, setDurationDays,
    slotRules, setSlotRules,
    priceLabel, setPriceLabel,
    occurrenceType, setOccurrenceType,
    occurrenceDate, setOccurrenceDate,
    recurrenceFrequencyDays, setRecurrenceFrequencyDays,
    recurrenceEndKind, setRecurrenceEndKind,
    recurrenceEndDate, setRecurrenceEndDate,
    recurrenceEndCount, setRecurrenceEndCount,
    startTime, setStartTime,
    durationMinutes, setDurationMinutes,
    externalBookingUrl, setExternalBookingUrl,
  };
}

export type ProductTypeFieldsState = ReturnType<typeof useProductTypeFieldsState>;

// Forme brute (snake_case, miroir des colonnes réelles de `products`/du payload d'une proposition
// — les deux partagent les mêmes noms de clé) — DISTINCTE de ProductTypeFieldsInit (camelCase,
// forme attendue par useProductTypeFieldsState). Un mapping explicite est requis, jamais un cast :
// un oubli ici a déjà cassé silencieusement la pré-remplissage de ModerateProductCreationProposalForm
// (spec 15, journal 2026-08-17). Consommé par les écrans de modération (création ET édition) —
// jamais par ProductForm lui-même, qui construit son état directement depuis `EditableProduct`.
export type RawProductFieldsPayload = {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  tag_ids?: string[];
  price_cop?: number | null;
  price_tiers?: unknown;
  min_qty?: number | null;
  max_qty?: number | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  capacity?: number | null;
  default_capacity?: number | null;
  stay_rates?: unknown;
  room_types?: unknown;
  duration_days?: number | null;
  slot_rules?: unknown;
  price_label?: string | null;
  occurrence_type?: OccurrenceType;
  occurrence_date?: string | null;
  recurrence_frequency_days?: number | null;
  recurrence_end_date?: string | null;
  recurrence_end_count?: number | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  external_booking_url?: string | null;
};

export function payloadToFieldsInit(payload: RawProductFieldsPayload): ProductTypeFieldsInit {
  return {
    address: payload.address,
    lat: payload.lat,
    lon: payload.lon,
    tagIds: payload.tag_ids,
    priceCop: payload.price_cop,
    priceTiers: payload.price_tiers,
    minQty: payload.min_qty,
    maxQty: payload.max_qty,
    checkInTime: payload.check_in_time,
    checkOutTime: payload.check_out_time,
    capacity: payload.capacity,
    defaultCapacity: payload.default_capacity,
    stayRates: payload.stay_rates,
    roomTypes: payload.room_types,
    durationDays: payload.duration_days,
    slotRules: payload.slot_rules,
    priceLabel: payload.price_label,
    occurrenceType: payload.occurrence_type,
    occurrenceDate: payload.occurrence_date,
    recurrenceFrequencyDays: payload.recurrence_frequency_days,
    recurrenceEndDate: payload.recurrence_end_date,
    recurrenceEndCount: payload.recurrence_end_count,
    startTime: payload.start_time,
    durationMinutes: payload.duration_minutes,
    externalBookingUrl: payload.external_booking_url,
  };
}
