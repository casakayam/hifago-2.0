// Remise par seuil de remplissage cumulé (camps) — migration 20260914130000, demande Jérôme du
// 2026-09-14. Deux valeurs libres par camp : seuil de personnes ET pourcentage, tous deux à la main
// de l'admin/prestataire (cahier des charges client §"remise optionnelle par quantité/nombre de
// personnes", décision 2026-08-11/13). Distinct de price_tiers (priceTiers.ts) : ce mécanisme porte
// sur le remplissage CUMULÉ d'une session de camp (product_availability.booked à la date de
// départ), pas la quantité d'une seule ligne de commande — les deux sont complémentaires, jamais
// substituables. Seul le type camp peut porter cette config (products_group_discount_camp_only).
export type GroupDiscount = { thresholdQty: string; pct: string };

export function emptyGroupDiscount(): GroupDiscount {
  return { thresholdQty: "", pct: "" };
}

// Retourne un message d'erreur (à afficher tel quel) si la config est invalide, sinon null. Les
// deux champs vides est un état valide (pas de remise configurée pour ce camp) — miroir du CHECK
// SQL products_group_discount_pair : les deux doivent être remplis ensemble, ou aucun des deux.
export function validateGroupDiscount(discount: GroupDiscount): string | null {
  const thresholdEmpty = discount.thresholdQty.trim() === "";
  const pctEmpty = discount.pct.trim() === "";
  if (thresholdEmpty && pctEmpty) return null;
  if (thresholdEmpty !== pctEmpty) {
    return "Completa el umbral de personas y el porcentaje de descuento juntos, o deja ambos vacíos.";
  }

  const thresholdQty = Number(discount.thresholdQty);
  const pct = Number(discount.pct);
  if (!Number.isInteger(thresholdQty) || thresholdQty < 1) {
    return "El umbral de personas debe ser un número entero mayor o igual a 1.";
  }
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    return "El porcentaje de descuento debe ser mayor a 0 y menor a 100.";
  }
  return null;
}

// pct saisi en pourcentage entier lisible (ex: "20") → fraction pour la colonne group_discount_pct
// (0.20) — même convention que acompte_pct/referrer_pct/app_pct déjà sur order_lines.
export function toGroupDiscountColumns(discount: GroupDiscount): {
  group_discount_threshold_qty: number | null;
  group_discount_pct: number | null;
} {
  if (discount.thresholdQty.trim() === "" && discount.pct.trim() === "") {
    return { group_discount_threshold_qty: null, group_discount_pct: null };
  }
  return {
    group_discount_threshold_qty: Number(discount.thresholdQty),
    group_discount_pct: Number(discount.pct) / 100,
  };
}

// Sens inverse de toGroupDiscountColumns, pour hydrater un formulaire d'édition depuis la colonne
// (fraction) ou depuis le payload d'une proposition — même forme dans les deux cas.
export function groupDiscountFromColumns(
  thresholdQty: number | null | undefined,
  pct: number | null | undefined,
): GroupDiscount {
  if (thresholdQty == null || pct == null) return emptyGroupDiscount();
  return { thresholdQty: String(thresholdQty), pct: String(Math.round(pct * 100)) };
}
