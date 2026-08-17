// Chambres d'un hôtel — spec 13. Miroir structurel de slotRules.ts/priceTiers.ts (même convention :
// type "brouillon" en strings pour les inputs contrôlés, validation retournant un message d'erreur
// ou null, conversion vers les types réels de colonne juste avant l'écriture). Réutilise tel quel
// PriceTier/priceTiers.ts (une chambre a son propre prix, exactement le mécanisme déjà construit
// pour l'alojamiento, spec 12) et LocalizedValue/localized-text-field.tsx (nom/description i18n) —
// zéro nouveau mécanisme de prix ou d'i18n, seulement l'orchestration "plusieurs chambres".
//
// Comparé à la V1 (« refaire pas réinventer ») : terrain vierge, aucun hôtel à chambres n'a jamais
// géré son propre prix/capacité hors PMS (cf. spec 13 §1). Alignement volontaire sur la forme des
// données retournées par GET /api/v1/rooms de LobbyPMS (docs/3-integrations/lobby_pms_api.md) :
// `quantity` (nb de chambres physiques de ce type, distinct de `capacity`) et `description` i18n
// miroir de `descriptions[]` — anticipe une future Tranche 2 sans redesign, aucun appel réseau ici.
import {
  emptyTier,
  lowestTierPrice,
  toPriceTiersColumn,
  validatePriceTiers,
  type PriceTier,
} from "@/lib/products/priceTiers";
import { buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";
import {
  emptyStayRates,
  toStayRatesColumn,
  validateStayRates,
  type DraftStayRates,
} from "@/lib/products/stayRates";
import type { StagedPhoto } from "@/components/product-photos-staged";
import type { MediaGalleryPhoto } from "@hifago/ui";

export type RoomKind = "dorm" | "private";

export type DraftRoomType = {
  // Absent pour une chambre pas encore enregistrée (création, ou ajoutée pendant une session
  // d'édition avant le premier "Guardar") — présent et stable dès l'insert, jamais changé après
  // (upsert, pas delete-reinsert, cf. ProductHotelRoomsBlock — nécessaire pour ne pas perdre les
  // photos d'une chambre déjà enregistrée à chaque édition d'une AUTRE chambre).
  id?: string;
  kind: RoomKind;
  name: LocalizedValue;
  description: LocalizedValue;
  capacity: string;
  quantity: string;
  priceMode: "simple" | "tiers";
  priceCop: string;
  priceTiers: PriceTier[];
  minQty: string;
  maxQty: string;
  stayRates: DraftStayRates;
  // Photos "stagées" tant que la chambre n'a pas d'id (upload immédiat vers Storage, rattachement
  // différé) — même pattern que StagedProductPhotos au niveau produit. Plus lu une fois `id` connu.
  photos: StagedPhoto[];
  // Galerie déjà en base (room_media), connue seulement si `id` est présent — chargée une fois par
  // la page d'édition, ensuite tenue à jour localement au fil des ajouts/suppressions immédiats.
  savedPhotos: MediaGalleryPhoto[];
};

export type RoomTypeRow = {
  kind: RoomKind;
  name: Record<string, string>;
  description: Record<string, string> | null;
  capacity: number;
  quantity: number | null;
  price_cop: number;
  price_tiers: { min_qty: number; max_qty: number; price_cop: number }[] | null;
  min_qty: number | null;
  max_qty: number | null;
  stay_rates: ReturnType<typeof toStayRatesColumn>;
  sort: number;
};

export const KIND_LABELS: Record<RoomKind, string> = {
  dorm: "Dormitorio",
  private: "Habitación privada",
};

export function emptyRoomType(): DraftRoomType {
  return {
    kind: "dorm",
    name: {},
    description: {},
    capacity: "",
    quantity: "",
    priceMode: "simple",
    priceCop: "",
    priceTiers: [emptyTier()],
    minQty: "",
    maxQty: "",
    stayRates: emptyStayRates(),
    photos: [],
    savedPhotos: [],
  };
}

// Retourne un message d'erreur (à afficher tel quel) si une chambre est invalide, sinon null. Un
// tableau vide est valide (les chambres restent optionnelles à la saisie, même si un hôtel sans
// aucune chambre n'a rien à vendre — pas un cas bloquant côté formulaire, cf. spec 13 §3).
export function validateRoomTypes(rooms: DraftRoomType[]): string | null {
  for (const room of rooms) {
    const capacity = Number(room.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return "La capacidad de cada habitación debe ser un número entero de al menos 1.";
    }
    if (room.quantity.trim()) {
      const quantity = Number(room.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return "La cantidad de habitaciones de un tipo debe ser un número entero de al menos 1.";
      }
    }
    if (room.priceMode === "tiers") {
      const tiersError = validatePriceTiers(room.priceTiers);
      if (tiersError) return tiersError;
    } else {
      const price = Number(room.priceCop);
      if (!Number.isFinite(price) || price <= 0) {
        return "El precio de cada habitación debe ser mayor a 0.";
      }
    }
    if (room.minQty.trim() && room.maxQty.trim() && Number(room.minQty) > Number(room.maxQty)) {
      return "La cantidad mínima de una habitación no puede ser mayor a la máxima.";
    }
    const stayRatesError = validateStayRates(room.stayRates);
    if (stayRatesError) return stayRatesError;
  }
  return null;
}

// Conversion d'une seule chambre — appelée en boucle par les deux points d'écriture (création,
// édition en upsert) plutôt qu'un insert en bloc, pour connaître l'id de chaque chambre au moment
// d'y rattacher ses photos (staged ou déjà en base).
export function toRoomTypeRow(room: DraftRoomType, sort: number): RoomTypeRow {
  const usesTiers = room.priceMode === "tiers";
  return {
    kind: room.kind,
    name: buildLocalizedPayload(room.name) ?? { es: KIND_LABELS[room.kind] },
    description: buildLocalizedPayload(room.description) ?? null,
    capacity: Number(room.capacity),
    quantity: room.quantity.trim() ? Number(room.quantity) : null,
    price_cop: usesTiers ? lowestTierPrice(room.priceTiers) : Number(room.priceCop),
    price_tiers: usesTiers ? toPriceTiersColumn(room.priceTiers) : null,
    min_qty: room.minQty.trim() ? Number(room.minQty) : null,
    max_qty: room.maxQty.trim() ? Number(room.maxQty) : null,
    stay_rates: toStayRatesColumn(room.stayRates),
    sort,
  };
}

export function toRoomTypeRows(rooms: DraftRoomType[]): RoomTypeRow[] {
  return rooms.map((room, index) => toRoomTypeRow(room, index));
}
