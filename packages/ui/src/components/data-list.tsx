"use client";

import * as React from "react";
import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { buttonVariants, Disclosure } from "@heroui/react";
import { cn } from "../lib/utils";
import { ServerPagination } from "./pagination";
import { ServerFilters } from "./server-filters";
import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "./simple-table";

/**
 * docs/specs/10-listes-standardisees-admin-socio.md §5.1 — composant unique pour les 13 listes
 * admin/socio : pagination et tri pilotés par l'URL (jamais un état React), filtres déclaratifs
 * (rendus via `ServerFilters` en interne quand `filters` est fourni — cf. `server-filters.tsx`),
 * clic-ligne vers une page de détail, actions selon ce qui est réellement possible par entité.
 */

// Tri résolu (packages/domain resolveSortParams) — un seul type partagé plutôt que ce littéral
// retapé dans chaque composant de liste consommateur.
export type DataListSort = { key: string; direction: "asc" | "desc" };

export type DataListColumn<Row> = {
  id: string; // = clé d'URL ?sort= ET id TanStack — jamais l'expression SQL
  header: string;
  // défaut (si absent) : String(row[id as keyof Row]) — n'utiliser ce défaut que si `id` est
  // LITTÉRALEMENT le nom de la propriété sur Row (ex. id "type" ↔ row.type). Dès que `id` sert
  // aussi de clé de tri SQL en snake_case (ex. "promo_code", "total_cop") alors que Row est en
  // camelCase (promoCode, amount), le défaut retombe silencieusement sur `undefined` — fournir
  // `cell` explicitement dans ce cas (bug réel constaté sur InvitationsList, colonne "Código").
  cell?: (row: Row) => React.ReactNode;
  sortable?: boolean; // défaut false ; true ⇒ id DOIT être dans la whitelist serveur
  align?: "left" | "right";
  className?: string;
};

export type DataListAction<Row> = {
  id: string;
  label: string; // "Ver" | "Editar" | "Eliminar" | "Revisar" | "Resolver" | …
  href?: (row: Row) => string;
  render?: (row: Row) => React.ReactNode; // action à état (dialog) fournie par le composant client de la page
  isVisible?: (row: Row) => boolean;
  variant?: "outline" | "danger";
  // Seulement lu quand `href` est fourni (rendu en <a data-testid=...>) — un `render` custom porte
  // son propre testid à l'intérieur du composant qu'il rend, ce champ y serait mort.
  testId?: (row: Row) => string;
};

// Action "Ver"/"Editar" standard vers la fiche détail — factorise le pattern répété tel quel dans
// la quasi-totalité des 13 listes (href/testId = `${basePath}/${id}`, identique à `rowHref` par
// défaut ci-dessous).
export function viewAction<Row>(
  basePath: string,
  testIdPrefix: string,
  label = "Ver"
): DataListAction<Row & { id: string }> {
  return {
    id: "view",
    label,
    href: (row) => `${basePath}/${row.id}`,
    testId: (row) => `${testIdPrefix}-detail-link-${row.id}`,
  };
}

export type DataListFilter =
  | { kind: "text"; name: string; label: string; placeholder?: string }
  | { kind: "select"; name: string; label: string; allLabel: string; options: { value: string; label: string }[] }
  | { kind: "date"; name: string; label: string };

export type DataListProps<Row> = {
  rows: Row[]; // déjà la page courante, déjà filtrée/triée par le serveur
  getRowId: (row: Row) => string;
  columns: DataListColumn<Row>[];
  actions?: DataListAction<Row>[];
  // Défaut (si absent) : `${basePath}/${getRowId(row)}` — ne fournir explicitement que lorsque la
  // route de détail ne correspond pas à cette forme (ex. OrdersTable, dont l'id de ligne est celui
  // de la order_line mais la fiche est celle de la commande, `orderId`). Retourner `undefined`
  // pour une ligne donnée désactive le stretched-link sur CETTE ligne (1re colonne rendue en texte
  // brut) — échappatoire pour une liste sans fiche détail réelle à offrir, plutôt que forcer une
  // page de fiche minimale n'affichant aucune donnée de plus que la ligne elle-même (déjà constaté
  // deux fois : admin/tags/[id]/page.tsx, partner/commissions/[id]/page.tsx).
  rowHref?: (row: Row) => string | undefined;
  basePath: string;
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filters?: DataListFilter[];
  filterValues?: Record<string, string>;
  extraParams: Record<string, string>; // sort+dir+filtres actifs — jamais page
  ariaLabel: string;
  rowTestIdPrefix: string; // ⇒ data-testid={`${prefix}-row-${id}`}
  emptyMessage: string;
  emptyTestId?: string;
  toolbar?: React.ReactNode; // bouton "Nuevo …", bloc de totaux, bannière
};

// TanStack Table v9 : les fonctionnalités sont des plugins enregistrés explicitement (comme dans
// OrdersTable.tsx). On enregistre rowSortingFeature/rowPaginationFeature pour disposer des
// OPTIONS manualSorting/manualPagination/rowCount et de la state slice `sorting` — mais jamais
// `sortedRowModel`/`paginatedRowModel` : c'est l'invariant central de la spec, `rows` est déjà la
// page triée/filtrée par le serveur, aucun retri/repagine client ne doit avoir lieu.
const dataListFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
});

// `Row` est un générique non contraint (contrat imposé par la spec), mais TanStack Table exige
// `TData extends Record<string, any> | Array<any>`. On fait tourner le plumbing TanStack sur un
// type de ligne "opaque" et on caste au point d'appel des fonctions fournies par l'appelant
// (col.cell, action.href/render/isVisible, rowHref, getRowId) — elles reçoivent toujours le vrai
// `Row` à l'exécution, seul le typage interne à ce composant est assoupli.
type OpaqueRow = Record<string, unknown>;

const columnHelper = createColumnHelper<typeof dataListFeatures, OpaqueRow>();

// Icône entonnoir minimale — aucune n'existe dans le jeu d'icônes HeroUI (`components/icons.js`),
// pas la peine d'une dépendance pour un seul glyphe.
function FilterIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 5h14M6 10h8M8.5 15h3" />
    </svg>
  );
}

function buildSortHref(
  basePath: string,
  extraParams: Record<string, string>,
  sort: { key: string; direction: "asc" | "desc" },
  columnId: string
) {
  // Toggle si déjà triée sur cette colonne, "asc" par défaut sinon. `page` n'apparaît jamais ici
  // (changer de tri revient toujours à la page 1, implicitement, en l'omettant).
  const nextDirection = sort.key === columnId && sort.direction === "asc" ? "desc" : "asc";
  const params = new URLSearchParams({ ...extraParams, sort: columnId, dir: nextDirection });
  return `${basePath}?${params.toString()}`;
}

export function DataList<Row>(props: DataListProps<Row>): React.ReactElement {
  const {
    rows,
    getRowId,
    columns,
    actions,
    rowHref = (row) => `${props.basePath}/${getRowId(row)}`,
    basePath,
    page,
    pageSize,
    totalCount,
    sort,
    filters,
    filterValues,
    extraParams,
    ariaLabel,
    rowTestIdPrefix,
    emptyMessage,
    emptyTestId,
    toolbar,
  } = props;

  const columnById = React.useMemo(() => new Map(columns.map((col) => [col.id, col])), [columns]);
  const hasActions = Boolean(actions && actions.length > 0);
  const totalColumnCount = columns.length + (hasActions ? 1 : 0);

  const columnDefs = React.useMemo(() => {
    const dataColumns = columns.map((col, index) =>
      columnHelper.display({
        id: col.id,
        // Rendu via un header-template TanStack (fonction) plutôt qu'une chaîne : c'est ce qui
        // permet d'obtenir le lien de tri <a> à travers `table.FlexRender`, comme OrdersTable.tsx
        // le fait pour son bouton de tri.
        header: () =>
          col.sortable ? (
            <a
              href={buildSortHref(basePath, extraParams, sort, col.id)}
              className="inline-flex items-center gap-1"
              data-testid={`sort-${col.id}`}
            >
              {col.header}
              {sort.key === col.id ? (
                <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span>
              ) : null}
            </a>
          ) : (
            col.header
          ),
        cell: (info) => {
          const row = info.row.original as unknown as Row;
          const content = col.cell ? col.cell(row) : String((row as Record<string, unknown>)[col.id]);
          // Stretched link (spec §5.1) : seule la 1ʳᵉ colonne porte le vrai <a> qui couvre toute
          // la ligne via son `::after` — un vrai lien, jamais un onClick sur <tr> (clavier,
          // clic-milieu, copier-lien restent utilisables). La <tr> porte `relative` plus bas pour
          // que ce `::after` (absolute + inset-0) s'ancre dessus.
          if (index === 0) {
            const href = rowHref(row);
            if (href) {
              return <a href={href} className="after:absolute after:inset-0">{content}</a>;
            }
          }
          return content;
        },
      })
    );

    if (!hasActions) {
      return columnHelper.columns(dataColumns);
    }

    const actionsColumn = columnHelper.display({
      id: "__actions",
      header: "",
      cell: (info) => {
        const row = info.row.original as unknown as Row;
        const visibleActions = (actions ?? []).filter((action) => !action.isVisible || action.isVisible(row));
        if (visibleActions.length === 0) return null;
        return (
          <div className="flex gap-2">
            {visibleActions.map((action) =>
              action.render ? (
                <React.Fragment key={action.id}>{action.render(row)}</React.Fragment>
              ) : action.href ? (
                <a
                  key={action.id}
                  href={action.href(row)}
                  className={buttonVariants({
                    variant: action.variant === "danger" ? "danger" : "outline",
                    size: "sm",
                  })}
                  data-testid={action.testId?.(row)}
                >
                  {action.label}
                </a>
              ) : null
            )}
          </div>
        );
      },
    });

    return columnHelper.columns([...dataColumns, actionsColumn]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sort/extraParams sont des littéraux
    // recréés à chaque rendu côté appelant (page Server Component) ; les inclure ferait
    // recalculer les colonnes à chaque rendu, ce qui reste correct (juste non optimal), donc on
    // les inclut quand même explicitement plutôt que de risquer un lien de tri périmé.
  }, [columns, actions, hasActions, rowHref, basePath, extraParams, sort]);

  const table = useTable({
    features: dataListFeatures,
    columns: columnDefs,
    data: rows as unknown as OpaqueRow[],
    getRowId: (row) => getRowId(row as unknown as Row),
    // Invariant central (spec §0/§8) : `rows` est déjà la page triée/filtrée par le serveur —
    // aucun sortedRowModel/paginatedRowModel enregistré, ces deux options empêchent tout retri ou
    // repagine côté client.
    manualSorting: true,
    manualPagination: true,
    rowCount: totalCount,
    state: {
      sorting: [{ id: sort.key, desc: sort.direction === "desc" }],
    },
  });

  const hasFilters = Boolean(toolbar) || Boolean(filters && filters.length > 0);
  // Nombre de filtres DÉCLARATIFS (`DataListFilter[]`) réellement posés — n'inclut pas les
  // paramètres propres à un `toolbar` custom (ex. PartnersFilterBar `location_q`/`radius_km`),
  // qui n'existent pas dans `filterValues`. Juste un indicateur visuel, pas un contrat.
  const activeFilterCount = (filters ?? []).filter((f) => Boolean(filterValues?.[f.name])).length;

  // Repliés par défaut sur mobile (Jérôme, 2026-08-20 : un formulaire de filtres complet prenait
  // toute la hauteur visible avant d'atteindre la liste) — mais ce même repli s'appliquait AUSSI
  // au desktop, jamais voulu (aucune contrainte de hauteur là-bas), simplement pas distingué à
  // l'origine. Correction 2026-09-26 (retour Jérôme) : ouverts par défaut à partir de `md` (768px).
  // Pas de CSS pur possible ici (contrairement à `app-nav-shell.tsx`, qui affiche deux arbres DOM
  // distincts sélectionnés par `hidden md:flex`) — un seul jeu de champs, contrôlé par l'état
  // `Disclosure` sous-jacent (attribut `hidden` + hauteur posés impérativement par React Aria).
  // Même patron déjà accepté dans ce repo pour un problème identique (mode d'un composant tiers
  // sans équivalent CSS) : `PartnerAgenda.tsx`, `matchMedia` direct dans un effet, jamais un hook
  // `useMediaQuery` générique. `isExpanded`/`onExpandedChange` (contrôlé) remplace `defaultExpanded`
  // — rendu serveur toujours replié (aucun accès à `window`), corrigé après montage si desktop.
  const [isFiltersExpanded, setIsFiltersExpanded] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const applyFromViewport = () => setIsFiltersExpanded(mql.matches);
    applyFromViewport();
    mql.addEventListener("change", applyFromViewport);
    return () => mql.removeEventListener("change", applyFromViewport);
  }, []);

  return (
    <div className="flex w-full flex-col gap-4">
      {hasFilters ? (
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <Disclosure isExpanded={isFiltersExpanded} onExpandedChange={setIsFiltersExpanded}>
            <Disclosure.Trigger
              data-testid="filters-toggle"
              className={cn(
                "flex w-full items-center gap-2 border border-default bg-overlay px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors",
                // Desktop : plus besoin d'un vrai bouton, les champs sont déjà visibles — juste un
                // petit lien discret pour qui veut regagner la hauteur.
                "md:w-auto md:border-0 md:bg-transparent md:p-0 md:text-xs md:font-normal md:text-muted md:underline md:underline-offset-2 md:hover:text-foreground"
              )}
            >
              <FilterIcon className="size-4 shrink-0 text-muted md:hidden" aria-hidden="true" />
              {isFiltersExpanded ? "Ocultar filtros" : "Filtros"}
              {!isFiltersExpanded && activeFilterCount > 0 ? (
                <span
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center bg-accent px-1 text-[11px] font-semibold text-accent-foreground md:hidden"
                  data-testid="filters-active-count"
                >
                  {activeFilterCount}
                </span>
              ) : null}
              <Disclosure.Indicator className="md:hidden" />
            </Disclosure.Trigger>
            <Disclosure.Content>
              <Disclosure.Body className="flex flex-col gap-4 p-0 pt-3">
                {toolbar}
                {filters && filters.length > 0 ? (
                  <ServerFilters
                    basePath={basePath}
                    filters={filters}
                    values={filterValues}
                    // Préserve le tri actif à la soumission du formulaire de filtres — jamais "page"
                    // (tout changement de filtre revient implicitement à la page 1, en l'omettant,
                    // même règle que buildSortHref ci-dessus).
                    hiddenParams={{ sort: sort.key, dir: sort.direction }}
                  />
                ) : null}
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        </div>
      ) : null}

      <SimpleTable aria-label={ariaLabel}>
        <SimpleTableHeader>
          {table.getHeaderGroups().map((group) => (
            <SimpleTableRow key={group.id}>
              {group.headers.map((header) => {
                const col = columnById.get(header.column.id);
                return (
                  <SimpleTableHead
                    key={header.id}
                    className={cn(col?.align === "right" && "text-right", col?.className)}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </SimpleTableHead>
                );
              })}
            </SimpleTableRow>
          ))}
        </SimpleTableHeader>
        <SimpleTableBody>
          {rows.length === 0 ? (
            <SimpleTableRow>
              <SimpleTableCell
                colSpan={totalColumnCount}
                className="text-center text-muted"
                data-testid={emptyTestId}
              >
                {emptyMessage}
              </SimpleTableCell>
            </SimpleTableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <SimpleTableRow key={row.id} className="relative" data-testid={`${rowTestIdPrefix}-row-${row.id}`}>
                {row.getAllCells().map((cell, index) => {
                  const col = columnById.get(cell.column.id);
                  return (
                    <SimpleTableCell
                      key={cell.id}
                      // Reflow mobile (SimpleTableCell, max-md:) : "" pour la colonne actions
                      // (header vide) — pas de libellé affiché, juste les boutons.
                      data-label={col?.header ?? ""}
                      className={cn(
                        // Toute cellule autre que la 1re (qui PORTE le stretched link) passe
                        // au-dessus de son `::after` — sinon un lien/bouton propre à cette
                        // cellule (colonne actions, ou une colonne avec son propre lien comme
                        // "Actividades" sur EstablishmentsList) ne recevrait jamais le clic.
                        // Généralisé (plus un opt-in par colonne) après un bug réel constaté sur
                        // EstablishmentsList — cf. docs/specs/10-...md, lot 4.
                        index !== 0 && "relative z-10",
                        col?.align === "right" && "text-right",
                        col?.className
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </SimpleTableCell>
                  );
                })}
              </SimpleTableRow>
            ))
          )}
        </SimpleTableBody>
      </SimpleTable>

      <ServerPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath={basePath}
        extraParams={extraParams}
      />
    </div>
  );
}
