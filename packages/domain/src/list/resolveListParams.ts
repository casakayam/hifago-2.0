// Compose les 3 helpers de liste (spec 10) — jamais de logique dupliquée, resolvePageParams reste
// l'unique source de vérité pour `page`/`from`/`to`. `extraParams` porte le tri et les filtres
// actifs mais JAMAIS `page` : c'est ServerPagination qui y ajoute lui-même le numéro de page en
// générant ses liens, et tout changement de tri/filtre doit pouvoir retomber sur la page 1 sans
// qu'un `page` figé dans extraParams ne le contredise.
import { resolvePageParams, type ResolvedSearchParams } from "../pagination/resolvePageParams";
import {
  resolveSortParams,
  type ResolvedSort,
  type SortDirection,
  type SortWhitelist,
} from "./resolveSortParams";
import { resolveFilterParams, type FilterDefinition } from "./resolveFilterParams";

export type ResolvedListParams = {
  page: number;
  pageSize: number;
  from: number;
  to: number;
  sort: ResolvedSort;
  filters: Record<string, string>;
  extraParams: Record<string, string>;
};

export function resolveListParams(
  searchParams: ResolvedSearchParams,
  config: {
    sortWhitelist: SortWhitelist;
    defaultSort: { key: string; direction: SortDirection };
    filters?: readonly FilterDefinition[];
    pageSize?: number;
  }
): ResolvedListParams {
  const { page, pageSize, from, to } = resolvePageParams(searchParams, config.pageSize ?? 20);
  const sort = resolveSortParams(searchParams, config.sortWhitelist, config.defaultSort);
  const filters = resolveFilterParams(searchParams, config.filters ?? []);

  return {
    page,
    pageSize,
    from,
    to,
    sort,
    filters,
    extraParams: { ...filters, sort: sort.key, dir: sort.direction },
  };
}
