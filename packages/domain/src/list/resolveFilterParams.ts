// Filtres déclaratifs pilotés par l'URL (spec 10) — une valeur invalide ou hors liste fermée est
// ignorée, jamais transmise à la requête ni levée en erreur (même posture défensive que
// resolvePageParams/resolveSortParams). Le résultat ne contient jamais de clé avec une chaîne
// vide : "filtre vidé puis formulaire soumis" doit redevenir "paramètre absent", jamais "" transmis
// à la requête (sinon un `.eq("champ", "")` filtrerait tout au lieu de ne rien filtrer).
import type { ResolvedSearchParams } from "../pagination/resolvePageParams";

export type FilterDefinition =
  | { name: string; kind: "text" }
  | { name: string; kind: "enum"; allowed: readonly string[] }
  | { name: string; kind: "date" };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveFilterParams(
  searchParams: ResolvedSearchParams,
  definitions: readonly FilterDefinition[]
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const definition of definitions) {
    const raw = searchParams[definition.name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) continue;

    if (definition.kind === "text") {
      const trimmed = value.trim();
      if (trimmed) result[definition.name] = trimmed;
      continue;
    }

    if (definition.kind === "enum") {
      if (definition.allowed.includes(value)) result[definition.name] = value;
      continue;
    }

    if (DATE_PATTERN.test(value)) result[definition.name] = value;
  }

  return result;
}
