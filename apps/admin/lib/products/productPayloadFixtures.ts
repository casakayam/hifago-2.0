import { renderHook } from "@testing-library/react";
import {
  useProductTypeFieldsState,
  type ProductType,
  type ProductTypeFieldsInit,
  type ProductTypeFieldsState,
} from "@/lib/products/useProductTypeFieldsState";

// Fixtures de test PARTAGÉES par productCreationPayload.test.ts, productEditPayload.test.ts et
// payloadParity.test.ts — un seul jeu de données réalistes par type, pour que les trois suites
// comparent des `fields` construits de façon identique. `ProductTypeFieldsState` dérive de
// `ReturnType<typeof useProductTypeFieldsState>` : le seul moyen fiable de construire un mock qui ne
// dérive pas de la vraie forme du hook au fil de ses évolutions est de faire tourner le hook
// lui-même via `renderHook`, pas de recopier ses ~40 champs à la main.
export function buildFields(init: ProductTypeFieldsInit = {}): ProductTypeFieldsState {
  const { result } = renderHook(() => useProductTypeFieldsState(init));
  return result.current;
}

export const FIXTURE_INIT: Record<ProductType, ProductTypeFieldsInit> = {
  activity: {
    address: "Cra 45 #10-12",
    lat: 6.25,
    lon: -75.56,
    tagIds: ["tag-activity"],
    priceCop: 50000,
    minQty: 1,
    maxQty: 10,
    defaultCapacity: 20,
    lobbyProductId: 501,
    slotRules: [{ day_of_week: 1, start_time: "09:00:00", end_time: "11:00:00", capacity: 10 }],
  },
  evento: {
    tagIds: ["tag-evento"],
    onlineBookable: true,
    eventoCapacityMode: "metered",
    isFree: false,
    eventoPaymentMode: "online",
    eventoOccupiesResource: true,
    defaultCapacity: 100,
    priceCop: 30000,
    occurrenceType: "once",
    occurrenceDate: "2026-10-01",
    startTime: "18:00:00",
    durationMinutes: 120,
  },
  camp: {
    tagIds: ["tag-camp"],
    priceCop: 200000,
    durationDays: 5,
    groupDiscountThresholdQty: 10,
    groupDiscountPct: 15,
    program: [{ day: 1, text: "Llegada y bienvenida" }],
    defaultCapacity: 30,
  },
  lodging: {
    address: "Calle 8 #5-20",
    lat: 6.2,
    lon: -75.5,
    tagIds: ["tag-lodging"],
    amenityIds: ["amenity-wifi"],
    priceCop: 80000,
    minQty: 1,
    maxQty: 4,
    checkInTime: "15:00:00",
    checkOutTime: "11:00:00",
    capacity: 4,
    unitCount: 3,
    lodgingKind: "private",
    unit: "per_person",
    lobbyCategoryId: 77,
    defaultCapacity: 5,
  },
  transport: {
    tagIds: ["tag-transport"],
    priceCop: 40000,
    minQty: 1,
    maxQty: 7,
    lobbyProductId: 900,
    transportContactPhone: "+573001234567",
    transportFirstDepartureTime: "06:00:00",
    transportLastDepartureTime: "20:00:00",
    transportSeatsPerDeparture: 7,
    transportDepartureAddress: "Aeropuerto JMC",
    transportDepartureLat: 6.16,
    transportDepartureLon: -75.42,
    transportArrivalAddress: "Guatapé",
    transportArrivalLat: 6.23,
    transportArrivalLon: -75.16,
  },
};

export const ALL_PRODUCT_TYPES: ProductType[] = ["activity", "evento", "camp", "lodging", "transport"];
