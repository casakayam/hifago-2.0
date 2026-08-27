import { asLodgingKind, type LodgingKind } from "@hifago/domain";

// Libellés espagnols de products.lodging_kind (apps/admin n'est pas localisé — hifago/CLAUDE.md §2
// point 1). Déclarés UNE fois parce que deux écrans les affichent : le formulaire (Select) et
// l'écran de modération (liste de comparaison). Deux copies auraient pu diverger sans erreur de
// compilation — le formulaire aurait dit « Casa entera » là où la modération aurait gardé l'ancien
// mot, et le modérateur n'aurait pas eu de quoi s'en apercevoir.
export const LODGING_KIND_LABELS: Record<LodgingKind, string> = {
  dorm: "Cama en dormitorio",
  private: "Habitación privada",
  whole_house: "Casa entera",
};

/**
 * Libellé d'une valeur venue d'un payload jsonb, ou `null` si le champ n'est pas renseigné (état
 * légitime : la colonne est facultative) ou porte une valeur hors domaine. L'appelant décide de
 * l'affichage du vide — « — » côté modération.
 */
export function lodgingKindLabel(value: unknown): string | null {
  const kind = asLodgingKind(value);
  return kind ? LODGING_KIND_LABELS[kind] : null;
}
