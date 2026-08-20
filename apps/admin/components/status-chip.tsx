import { Chip } from "@hifago/ui";

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

// Revue admin établissements (Jérôme, 2026-08-19) — premier appelant à vouloir directement le
// <Chip> rendu plutôt que juste le style : statusChip() reste utilisé tel quel par LedgerList/
// ReconciliationList (qui composent leur propre <Chip> avec du contenu additionnel), StatusChip
// est pour les listes qui n'ont besoin de rien de plus qu'un statut + son libellé en une ligne.
export type StatusChipProps = {
  status: string;
  map: Record<string, ChipStyle>;
  labels: Record<string, string>;
  testId?: string;
};

export function StatusChip({ status, map, labels, testId }: StatusChipProps) {
  const style = statusChip(map, status);
  return (
    <Chip variant={style.variant} color={style.color} data-testid={testId}>
      {labels[status] ?? status}
    </Chip>
  );
}
