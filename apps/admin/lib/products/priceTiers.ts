// Paliers de prix par quantité — spec 08. Précédent technique : stay_rates côté legacy
// (src/services/stayService.js, tranches min_guests/max_guests non chevauchantes pour un
// hébergement loué en entier), jamais appliqué à une activité. Même choix que là-bas : la
// validation de non-chevauchement reste côté app, jamais un CHECK SQL sur du JSON complexe.
export type PriceTier = { minQty: string; maxQty: string; priceCop: string };

export type ParsedPriceTier = { min_qty: number; max_qty: number; price_cop: number };

export function emptyTier(): PriceTier {
  return { minQty: "", maxQty: "", priceCop: "" };
}

// Retourne un message d'erreur (à afficher tel quel) si les paliers sont invalides, sinon null.
// N'accepte que des paliers entièrement remplis — un palier partiel est déjà signalé par la
// validation HTML native (required) avant d'arriver ici.
export function validatePriceTiers(tiers: PriceTier[]): string | null {
  if (tiers.length === 0) return "Agrega al menos un tramo o vuelve al precio simple.";

  const parsed: ParsedPriceTier[] = [];
  for (const tier of tiers) {
    const min_qty = Number(tier.minQty);
    const max_qty = Number(tier.maxQty);
    const price_cop = Number(tier.priceCop);
    if (!Number.isInteger(min_qty) || min_qty < 1) {
      return "La cantidad mínima de cada tramo debe ser un entero mayor o igual a 1.";
    }
    if (!Number.isInteger(max_qty) || max_qty < min_qty) {
      return "La cantidad máxima de cada tramo debe ser mayor o igual a la mínima.";
    }
    if (!Number.isFinite(price_cop) || price_cop <= 0) {
      return "El precio de cada tramo debe ser mayor a 0.";
    }
    parsed.push({ min_qty, max_qty, price_cop });
  }

  const sorted = [...parsed].sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].min_qty <= sorted[i - 1].max_qty) {
      return "Los tramos no pueden superponerse.";
    }
  }

  return null;
}

export function toPriceTiersColumn(tiers: PriceTier[]): ParsedPriceTier[] {
  return tiers.map((tier) => ({
    min_qty: Number(tier.minQty),
    max_qty: Number(tier.maxQty),
    price_cop: Number(tier.priceCop),
  }));
}

// price_cop reste renseigné pour l'affichage catalogue/liste (formatCop côté /admin/products,
// jamais utilisé par create_order dès que price_tiers est défini, cf. spec §3) — le tramo le plus
// bas sert de valeur d'affichage "desde".
export function lowestTierPrice(tiers: PriceTier[]): number {
  return Math.min(...tiers.map((tier) => Number(tier.priceCop)));
}

// Sens inverse de toPriceTiersColumn (colonne → brouillon), pour hydrater un formulaire d'édition —
// partagé entre le prix d'un produit (ProductForm) et le prix d'une chambre (spec 13, par chambre)
// plutôt que réimplémenté à chaque consommateur.
export function tiersFromColumn(value: unknown): PriceTier[] {
  if (!Array.isArray(value) || value.length === 0) return [emptyTier()];
  return (value as ParsedPriceTier[]).map((tier) => ({
    minQty: String(tier.min_qty),
    maxQty: String(tier.max_qty),
    priceCop: String(tier.price_cop),
  }));
}
