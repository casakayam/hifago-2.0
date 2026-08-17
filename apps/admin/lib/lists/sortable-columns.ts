import type { SortWhitelist } from "@hifago/domain";

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — une whitelist par liste, clé d'URL ->
// expression SQL. Ici les deux coïncident (aucune colonne jsonb à déréférencer côté orders), mais
// le mapping reste explicite plutôt qu'un simple tableau de clés : c'est ce qui empêche une clé
// d'URL non whitelistée d'atteindre .order() (invariant de sécurité central de la spec).
export const ORDERS_SORT_WHITELIST: SortWhitelist = {
  date: "date",
  created_at: "created_at",
  qty: "qty",
  status: "status",
  total_cop: "total_cop",
};

// Décision Jérôme (2026-08-15) : "plus récent en premier" partout, y compris sur /admin/orders —
// remplace l'ancien défaut `date asc` ("prochaines échéances en premier"). Ce dernier reste
// accessible en un clic sur l'en-tête "Fecha", juste plus le tri par défaut à l'ouverture.
export const ORDERS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;

// `name` -> `name->>es` : products.name est jsonb multilingue (même idiome que le filtre `q`
// déjà en place sur cette liste), la clé d'URL reste "name" — jamais l'expression jsonb elle-même.
export const PRODUCTS_SORT_WHITELIST: SortWhitelist = {
  created_at: "created_at",
  name: "name->>es",
  price_cop: "price_cop",
  type: "type",
  updated_at: "updated_at",
};

export const PRODUCTS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;

// comm_campaigns n'a pas de updated_at (20260814230000_campaign_engine.sql) — created_at seule
// colonne temporelle disponible.
export const CAMPAIGNS_SORT_WHITELIST: SortWhitelist = {
  created_at: "created_at",
  audience: "audience",
  channel: "channel",
  status: "status",
};
export const CAMPAIGNS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;

export const ESTABLISHMENTS_SORT_WHITELIST: SortWhitelist = {
  created_at: "created_at",
  name: "name->>es",
  status: "status",
  updated_at: "updated_at",
};
export const ESTABLISHMENTS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;

export const INVITATIONS_SORT_WHITELIST: SortWhitelist = {
  created_at: "created_at",
  expires_at: "expires_at",
  consumed_at: "consumed_at",
  status: "status",
  promo_code: "promo_code",
  onboarding_path: "onboarding_path",
};
export const INVITATIONS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;

export const PARTNERS_SORT_WHITELIST: SortWhitelist = {
  created_at: "created_at",
  display_name: "display_name",
  status: "status",
  entity_type: "entity_type",
  partner_city: "partner_city",
  updated_at: "updated_at",
};
// Remplace l'ancien défaut display_name asc (alphabétique) — même règle générale que orders/
// products/etc (décision Jérôme 2026-08-15) ; l'ordre alphabétique reste accessible en un clic.
export const PARTNERS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;

// catalog_tags n'a pas de updated_at (20260815210000_catalog_tags.sql) — created_at/slug/label
// seules colonnes disponibles.
export const TAGS_SORT_WHITELIST: SortWhitelist = {
  created_at: "created_at",
  slug: "slug",
  label: "label->>es",
};
// Remplace l'ancien défaut slug asc (alphabétique) — même règle générale, ordre alphabétique
// reste accessible en un clic sur "Etiqueta".
export const TAGS_DEFAULT_SORT = { key: "created_at", direction: "desc" } as const;
