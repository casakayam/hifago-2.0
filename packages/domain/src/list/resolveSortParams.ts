// Tri serveur piloté par l'URL (spec 10, invariant central) — `?sort=` ne doit JAMAIS atteindre
// .order()/ORDER BY tel quel : la whitelist mappe une clé d'URL vers une expression SQL codée en
// dur côté serveur, donc aucune chaîne venue de l'utilisateur n'est jamais interpolée dans une
// requête. `?sort=` inconnu OU `?dir=` invalide retombent tous les deux sur le même défaut complet
// (clé + direction) — jamais une combinaison bâtarde clé-valide/direction-par-défaut — même posture
// défensive que resolvePageParams déjà en place (repli silencieux, jamais d'erreur).
import type { ResolvedSearchParams } from "../pagination/resolvePageParams";

export type SortDirection = "asc" | "desc";

export type SortWhitelist = Readonly<Record<string, string>>;

export type ResolvedSort = {
  key: string;
  column: string;
  direction: SortDirection;
};

export function resolveSortParams(
  searchParams: ResolvedSearchParams,
  whitelist: SortWhitelist,
  defaultSort: { key: string; direction: SortDirection }
): ResolvedSort {
  const rawSort = searchParams.sort;
  const sort = Array.isArray(rawSort) ? rawSort[0] : rawSort;
  const rawDir = searchParams.dir;
  const dir = Array.isArray(rawDir) ? rawDir[0] : rawDir;

  if (!sort || !(sort in whitelist) || (dir !== "asc" && dir !== "desc")) {
    return {
      key: defaultSort.key,
      column: whitelist[defaultSort.key],
      direction: defaultSort.direction,
    };
  }

  return { key: sort, column: whitelist[sort], direction: dir };
}
