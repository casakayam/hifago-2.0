// Lookup couleur/variante de Chip partagé par les listes "à deux groupes + statut" de apps/admin
// (LedgerList, ReconciliationList, ...) — chaque appelant garde son propre vocabulaire de statuts
// et sa propre map de style, seul le repli commun ({color:"default", variant:"soft"}) est
// mutualisé ici pour éviter que chaque liste ne redérive le même type + le même fallback.
export type ChipColor = "default" | "accent" | "success" | "warning" | "danger";
export type ChipVariant = "primary" | "secondary" | "tertiary" | "soft";

export type ChipStyle = { color: ChipColor; variant: ChipVariant };

const DEFAULT_CHIP_STYLE: ChipStyle = { color: "default", variant: "soft" };

export function statusChip(map: Record<string, ChipStyle>, status: string): ChipStyle {
  return map[status] ?? DEFAULT_CHIP_STYLE;
}
