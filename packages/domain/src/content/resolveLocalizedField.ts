// Résolution d'un champ de contenu multilingue (colonne JSONB par langue, cf.
// hifago/CLAUDE.md §5) — distinct des libellés d'interface (next-intl). Repli obligatoire :
// une fiche saisie dans une seule langue reste affichable dans les autres, jamais un trou vide.
export type LocalizedField = Record<string, string> | null | undefined;

export function resolveLocalizedField(
  value: LocalizedField,
  locale: string,
  fallbackLocale: string = "es"
): string | null {
  if (!value) return null;
  if (value[locale]) return value[locale];
  if (value[fallbackLocale]) return value[fallbackLocale];
  const firstAvailable = Object.values(value).find(
    (v) => typeof v === "string" && v.length > 0
  );
  return firstAvailable ?? null;
}

// Les colonnes jsonb typées `unknown` par le client Supabase généré arrivent telles quelles côté
// serveur (pas de validation runtime ici) — ce cast est le seul point de passage vers
// resolveLocalizedField, partagé pour éviter qu'il soit redéclaré à chaque call site.
export function asLocalizedField(value: unknown): LocalizedField {
  return value as LocalizedField;
}
