// Pagination serveur (lacune G15, cahier des charges admin §6 : « doit être paginée dès la
// cible, pas ajoutée quand elle deviendra visiblement lente ») — un seul point de vérité pour
// convertir le paramètre d'URL `?page=N` en bornes `.range()` Supabase. `page` toujours >= 1
// (jamais 0/négatif, même sur une entrée invalide ou absente) — la liste reste utilisable plutôt
// que de renvoyer une erreur sur un lien mal formé.
export type ResolvedSearchParams = Record<string, string | string[] | undefined>;

export type PageParams = {
  page: number;
  pageSize: number;
  from: number;
  to: number;
};

export function resolvePageParams(
  searchParams: ResolvedSearchParams,
  defaultPageSize = 20
): PageParams {
  const raw = searchParams.page;
  const rawValue = Array.isArray(raw) ? raw[0] : raw;
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : 1;
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const from = (page - 1) * defaultPageSize;
  const to = from + defaultPageSize - 1;
  return { page, pageSize: defaultPageSize, from, to };
}
