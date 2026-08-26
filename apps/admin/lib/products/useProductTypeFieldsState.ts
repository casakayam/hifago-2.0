"use client";

import { useState } from "react";
import { tiersFromColumn, type PriceTier } from "@/lib/products/priceTiers";
import { emptyStayRates, stayRatesFromColumn, type DraftStayRates } from "@/lib/products/stayRates";
import { slotRulesFromColumn, type DraftSlotRule } from "@/lib/products/slotRules";
import { roomTypesFromColumn, type DraftRoomType } from "@/lib/products/hotelRooms";

// Correctif (spec 21, trouvé en vérifiant, sans lien avec elle — cf. productTypeGating.ts) :
// productTypeGating/ProductType/availabilityScreenFor vivent désormais dans un module SANS
// "use client" (ce fichier-ci le porte, pour son hook React) — un Server Component peut les
// importer directement. Réexportés ici pour ne casser aucun import client existant.
export { productTypeGating, availabilityScreenFor, type ProductType } from "@/lib/products/productTypeGating";

export type OccurrenceType = "once" | "recurring";
export type RecurrenceEndKind = "date" | "count" | "none";
export type PriceMode = "simple" | "tiers";

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
  // Nombre d'unités de ce type (3 cabañas, 8 lits) — descriptif, jamais un quota de réservation.
  // À ne pas confondre avec defaultCapacity, qui amorce product_availability (cf. migration
  // 20260826190000_product_quantity.sql, qui détaille les trois colonnes voisines).
  quantity?: number | null;
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
  // Spec 21 + refonte parcours partenaire ↔ Lobby (2026-08-25) — désormais dans
  // RawProductFieldsPayload/payloadToFieldsInit aussi : un socio peut proposer ces champs quand
  // l'établissement est connecté (choisis via LobbyOptionPicker, jamais une saisie libre), donc
  // l'écran de modération doit pouvoir les prérremplir pour la revue admin.
  lobbyCategoryId?: number | null;
  lobbyProductId?: number | null;
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
  const [quantity, setQuantity] = useState(init.quantity != null ? String(init.quantity) : "");
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
  const [lobbyCategoryId, setLobbyCategoryId] = useState(
    init.lobbyCategoryId != null ? String(init.lobbyCategoryId) : "",
  );
  const [lobbyProductId, setLobbyProductId] = useState(
    init.lobbyProductId != null ? String(init.lobbyProductId) : "",
  );
  // "none" tant que rien n'est choisi ; "picker" dès qu'une valeur existe (édition d'un produit
  // déjà lié) — jamais recalculé après le montage.
  //
  // Corrigé le 2026-08-26 : le défaut était "manual", ce qui faisait afficher un ID NUMÉRIQUE BRUT
  // à la place du nom de la catégorie dès qu'on rouvrait un produit lié — la seule information
  // vraiment utile (« à quoi suis-je lié ? ») était la seule qu'on ne montrait pas. En "picker",
  // LobbyOptionPicker résout l'id contre la liste réelle et affiche le nom, la capacité, la
  // description et les photos. "manual" reste accessible à l'admin via le sélecteur, comme
  // échappatoire pour saisir un id que la liste ne contiendrait pas.
  const [lobbyLinkMode, setLobbyLinkMode] = useState<"none" | "picker" | "manual">(() =>
    init.lobbyCategoryId != null || init.lobbyProductId != null ? "picker" : "none",
  );

  return {
    address, setAddress, lat, setLat, lon, setLon,
    selectedTagIds, setSelectedTagIds,
    priceMode, setPriceMode, priceCop, setPriceCop, priceTiers, setPriceTiers,
    minQty, setMinQty, maxQty, setMaxQty,
    checkInTime, setCheckInTime, checkOutTime, setCheckOutTime,
    capacity, setCapacity, quantity, setQuantity,
    defaultCapacity, setDefaultCapacity, stayRates, setStayRates,
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
    lobbyCategoryId, setLobbyCategoryId, lobbyProductId, setLobbyProductId,
    lobbyLinkMode, setLobbyLinkMode,
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
  quantity?: number | null;
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
  lobby_category_id?: number | null;
  lobby_product_id?: number | null;
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
    quantity: payload.quantity,
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
    lobbyCategoryId: payload.lobby_category_id,
    lobbyProductId: payload.lobby_product_id,
  };
}
