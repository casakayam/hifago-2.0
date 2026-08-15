import * as React from "react";
import { buttonVariants } from "@heroui/react";

/**
 * Pagination serveur, pilotée par l'URL (lacune G15, cahier des charges admin §6) — rendu en
 * liens `?page=N`, pas d'état React, `<a>` natif (pas `next/link` : `packages/ui` reste
 * indépendant de Next.js). Nommé `ServerPagination` et non `Pagination` : HeroUI exporte déjà un
 * composant `Pagination` (`@heroui/react`, primitives `Pagination.Link`/`Pagination.Previous`
 * bâties sur un `Button` react-aria — `onPress`, donc pensées pour un état client), qui
 * collisionnerait sur le nom ET ne convient pas ici : on veut un vrai lien `href` navigable sans
 * JS, pas un bouton cliqué en JS qui mute un état local. Même distinction de principe que
 * `SimpleTable` vs `Table` dans ce même fichier de composants. Reprend le libellé déjà en usage
 * (`apps/admin/app/admin/orders/OrdersTable.tsx`, boutons « Anterior »/« Siguiente ») pour rester
 * cohérent avec la pagination client déjà là ailleurs dans l'app.
 */
export type ServerPaginationProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  /** Chemin de base sans query, ex. "/admin/partners" — les autres params de recherche sont
   * préservés tels quels par l'appelant via `extraParams`. */
  basePath: string;
  extraParams?: Record<string, string>;
};

function buildHref(basePath: string, page: number, extraParams?: Record<string, string>) {
  const params = new URLSearchParams(extraParams);
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

export function ServerPagination({
  page,
  pageSize,
  totalCount,
  basePath,
  extraParams,
}: ServerPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="flex items-center gap-3" data-testid="pagination">
      {hasPrevious ? (
        <a
          href={buildHref(basePath, page - 1, extraParams)}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          data-testid="pagination-previous"
        >
          Anterior
        </a>
      ) : (
        <span className={buttonVariants({ variant: "outline", size: "sm" })} aria-disabled="true" data-disabled>
          Anterior
        </span>
      )}

      <span className="text-sm text-muted" data-testid="pagination-status">
        Página {page} de {totalPages}
      </span>

      {hasNext ? (
        <a
          href={buildHref(basePath, page + 1, extraParams)}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          data-testid="pagination-next"
        >
          Siguiente
        </a>
      ) : (
        <span className={buttonVariants({ variant: "outline", size: "sm" })} aria-disabled="true" data-disabled>
          Siguiente
        </span>
      )}
    </div>
  );
}
