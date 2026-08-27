import { asLodgingUnit, type LodgingUnit } from "@hifago/domain";

// Libellés espagnols de products.unit — l'unité de PRIX affichée à côté du montant sur la fiche
// publique. Déclarés une fois, comme LODGING_KIND_LABELS à côté, et pour la même raison : deux
// écrans les affichent (formulaire et modération), et deux copies auraient pu diverger en silence.
export const LODGING_UNIT_LABELS: Record<LodgingUnit, string> = {
  per_person: "Por persona",
  per_two: "Por dos personas",
  per_house: "Por alojamiento completo",
};

export function lodgingUnitLabel(value: unknown): string | null {
  const unit = asLodgingUnit(value);
  return unit ? LODGING_UNIT_LABELS[unit] : null;
}
