import { addDays, format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import type { CartLine } from "@/lib/cart/CartContext";

// Extrait de HotelReservationForm.tsx/LodgingReservationForm.tsx (spec 17 §0 Tranche 2) — les deux
// composants réservent une plage de nuits (check-in/check-out) sur une "entité" tarifée différente
// (une chambre pour Hotel, le produit lui-même pour Lodging) mais partagent tout le calcul qui ne
// dépend PAS de cette entité : la même plage/nuit devient un identifiant ISO, la même règle de
// palier de quantité s'applique, le même garde-fou "nuit indisponible" compare capacité/réservé/
// panier. Fonctions pures (comme resolveTierPrice l'était déjà) plutôt qu'un hook : chaque appelant
// garde son propre useMemo avec ses propres dépendances (selectedRoomId pour Hotel, aucune pour
// Lodging) — un hook générique masquerait cette différence légitime derrière une API à
// callbacks recréés à chaque rendu.
export type PriceTier = { min_qty: number; max_qty: number; price_cop: number };

export function resolveTierPrice(
  priceTiers: PriceTier[] | null,
  basePrice: number,
  qty: number
): number {
  if (!priceTiers) return basePrice;
  const match = priceTiers.find((t) => qty >= t.min_qty && qty <= t.max_qty);
  return match ? match.price_cop : basePrice;
}

// Plage [range.from, range.to) → tableau de nuits ISO (yyyy-MM-dd), check-out exclu (une plage
// 2026-01-01 → 2026-01-03 = 2 nuits : le 1er et le 2, jamais le 3, qui est le jour de départ).
export function nightsInRange(range: DateRange | undefined): string[] {
  if (!range?.from || !range?.to) return [];
  const result: string[] = [];
  for (let d = range.from; d < range.to; d = addDays(d, 1)) result.push(format(d, "yyyy-MM-dd"));
  return result;
}

// Une nuit de la plage sélectionnée est indisponible si elle n'a aucune ligne de disponibilité, ou
// si la capacité restante (déjà nette du panier en cours, cf. getInCartQty) tombe sous la quantité
// demandée. `getAvailability`/`getInCartQty` sont des lookups fournis par l'appelant (clé
// composée room_type_id+date pour Hotel, date seule pour Lodging) — jamais une Map construite ici,
// pour ne pas imposer une forme de clé.
export function hasUnavailableNightInRange(
  nights: string[],
  qty: number,
  getAvailability: (night: string) => { capacity: number; booked: number } | undefined,
  getInCartQty: (night: string) => number
): boolean {
  return nights.some((night) => {
    const row = getAvailability(night);
    const inCart = getInCartQty(night);
    return !row || row.capacity - row.booked - inCart < qty;
  });
}

// Total (pour une unité, avant multiplication par qty) sur la plage : palier de quantité par
// défaut, sauf override exact posé côté admin pour une nuit donnée (getRateOverride). Jamais la
// vraie barrière de prix — create_order reste la seule source de vérité, cf. les deux appelants.
export function estimateNightsTotal(
  nights: string[],
  tierPrice: number,
  getRateOverride: (night: string) => number | undefined
): number {
  return nights.reduce((sum, night) => sum + (getRateOverride(night) ?? tierPrice), 0);
}

// Cupos déjà occupés par le panier en cours (pas encore en base), agrégés nuit par nuit pour
// chaque ligne à plage (endDate posé) — avertissement indicatif, jamais la vraie barrière (cf. les
// deux appelants). `includeLine` filtre les lignes pertinentes (roomTypeId posé pour Hotel,
// productId correspondant pour Lodging) ; `keyFor` construit la clé de la Map retournée (composée
// pour Hotel, date seule pour Lodging) — mêmes lookups que hasUnavailableNightInRange ci-dessus.
export function buildInCartNightsMap(
  lines: CartLine[],
  includeLine: (line: CartLine) => boolean,
  keyFor: (line: CartLine, night: string) => string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (!includeLine(line) || !line.endDate) continue;
    for (let d = line.date; d < line.endDate; d = format(addDays(parseISO(d), 1), "yyyy-MM-dd")) {
      const key = keyFor(line, d);
      map.set(key, (map.get(key) ?? 0) + line.qty);
    }
  }
  return map;
}
