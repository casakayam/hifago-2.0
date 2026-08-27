// Primitives de lecture défensive partagées par les parseurs LobbyPMS (/simplify du 2026-08-26 :
// ces trois fonctions étaient identiques au caractère près dans parseLobbyRooms.ts et
// parseLobbyServices.ts). Interne au dossier pms — volontairement PAS réexporté par le barrel
// packages/domain/src/index.ts : c'est de l'outillage de parsing, pas une notion du domaine.
//
// Discipline commune à tous les parseurs de ce dossier (cf. l'en-tête de parseLobbyRooms.ts) : la
// doc officielle de LobbyPMS s'est déjà révélée fausse une fois, donc aucun champ n'est supposé
// présent, aucune exception n'est levée, et un champ absent est OMIS plutôt que fabriqué.
//
// Les deux parseurs plus anciens du dossier (parseLobbyNightAvailability, parseLobbyBookingResponse)
// appliquent le même principe avec un idiome inline. Ils ne sont volontairement PAS réécrits ici :
// ils ont leurs tests, et les rétro-adapter n'achèterait rien aujourd'hui.

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Entier strictement positif, ou null. Accepte une chaîne numérique (Lobby en renvoie parfois). */
export function asPositiveInt(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
