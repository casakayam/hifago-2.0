import type { FilterDefinition } from "@hifago/domain";
import type { DataListFilter } from "@hifago/ui";
import { STATUS_LABELS } from "@/app/admin/orders/statusLabels";
import { AUDIENCE_LABELS, CAMPAIGN_STATUS_LABELS, CHANNEL_LABELS } from "@/app/admin/campaigns/campaignLabels";
import { INVITATION_STATUS_LABELS, ONBOARDING_PATH_LABELS } from "@/app/admin/invitations/invitationLabels";

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — deux jeux de définitions par liste,
// volontairement séparés : `*_FILTER_DEFINITIONS` (packages/domain, kind text|enum|date) sert
// resolveFilterParams côté serveur (validation) ; `*_FILTERS` (packages/ui, kind text|select|date)
// sert ServerFilters côté rendu (label, options affichées). Les valeurs enum/options sont dérivées
// de la même source (STATUS_LABELS) pour ne jamais diverger entre validation et affichage.

export const ORDERS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "enum", name: "status", allowed: Object.keys(STATUS_LABELS) },
  { kind: "date", name: "date_from" },
  { kind: "date", name: "date_to" },
  { kind: "text", name: "q" },
];

export const ORDERS_FILTERS: DataListFilter[] = [
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  { kind: "date", name: "date_from", label: "Desde" },
  { kind: "date", name: "date_to", label: "Hasta" },
  { kind: "text", name: "q", label: "Titular", placeholder: "Nombre del titular" },
];

// products.type — check constraint réel (products_type_check,
// supabase/migrations/20260814190000_products_evento_vitrine.sql). Pas de traduction ES établie
// dans le projet pour ces 6 valeurs (la colonne "Tipo" de la liste affiche déjà la valeur brute
// telle quelle, cf. ProductsList.tsx) — le filtre reprend la même convention plutôt que d'inventer
// une traduction non tranchée.
const PRODUCT_TYPES = ["lodging", "activity", "transport", "tour", "camp", "evento"] as const;

export const PRODUCTS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "type", allowed: PRODUCT_TYPES },
  { kind: "enum", name: "sellable", allowed: ["true", "false"] },
];

export const PRODUCTS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre", placeholder: "Nombre del producto" },
  {
    kind: "select",
    name: "type",
    label: "Tipo",
    allLabel: "Todos los tipos",
    options: PRODUCT_TYPES.map((type) => ({ value: type, label: type })),
  },
  {
    kind: "select",
    name: "sellable",
    label: "Estado",
    allLabel: "Todos los estados",
    // Labels déjà en place dans la liste actuelle (product.sellable ? "Publicado" : "Borrador").
    options: [
      { value: "true", label: "Publicado" },
      { value: "false", label: "Borrador" },
    ],
  },
];

export const CAMPAIGNS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(CAMPAIGN_STATUS_LABELS) },
  { kind: "enum", name: "audience", allowed: Object.keys(AUDIENCE_LABELS) },
  { kind: "enum", name: "channel", allowed: Object.keys(CHANNEL_LABELS) },
];

export const CAMPAIGNS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por mensaje", placeholder: "Mensaje" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "audience",
    label: "Audiencia",
    allLabel: "Todas las audiencias",
    options: Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "channel",
    label: "Canal",
    allLabel: "Todos los canales",
    options: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })),
  },
];

// establishments.status ('active'|'archived') — même vocabulaire ES qu'ailleurs dans l'app
// (partner/(app)/page.tsx : Activo/Suspendido pour un autre statut, "Archivado" étendu ici pour
// la valeur propre à establishments/partners, absente de cette vocabulaire-là).
const ESTABLISHMENT_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  archived: "Archivado",
};

export const ESTABLISHMENTS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(ESTABLISHMENT_STATUS_LABELS) },
  { kind: "enum", name: "operated_directly", allowed: ["true", "false"] },
];

export const ESTABLISHMENTS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre", placeholder: "Nombre del establecimiento" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(ESTABLISHMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "operated_directly",
    label: "Operado directamente",
    allLabel: "Todos",
    options: [
      { value: "true", label: "Sí" },
      { value: "false", label: "No" },
    ],
  },
];

export const INVITATIONS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(INVITATION_STATUS_LABELS) },
  { kind: "enum", name: "path", allowed: Object.keys(ONBOARDING_PATH_LABELS) },
];

export const INVITATIONS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Código", placeholder: "Código promocional" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(INVITATION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "path",
    label: "Tipo",
    allLabel: "Todos los tipos",
    options: Object.entries(ONBOARDING_PATH_LABELS).map(([value, label]) => ({ value, label })),
  },
];

// partners.status ('active'|'suspended'|'archived') — vocabulaire propre à cette colonne, distinct
// du statut de capacité affiché sur le dashboard socio (partner/(app)/page.tsx).
const PARTNER_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  suspended: "Suspendido",
  archived: "Archivado",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "Persona",
  organization: "Organización",
};

// partner_capabilities.role ('referrer'|'operator'|'admin') — mêmes libellés Referente/Prestador
// déjà en place sur le dashboard socio (partner/(app)/page.tsx, ROLE_LABELS) ; "admin" n'y figure
// pas (rôle jamais affiché côté socio), ajouté ici pour ce filtre admin uniquement.
const PARTNER_ROLE_LABELS: Record<string, string> = {
  referrer: "Referente",
  operator: "Prestador",
  admin: "Admin",
};

export const PARTNERS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(PARTNER_STATUS_LABELS) },
  { kind: "enum", name: "entity_type", allowed: Object.keys(ENTITY_TYPE_LABELS) },
  { kind: "enum", name: "role", allowed: Object.keys(PARTNER_ROLE_LABELS) },
  { kind: "text", name: "city" },
];

export const PARTNERS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre o email", placeholder: "Nombre o email" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(PARTNER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "entity_type",
    label: "Tipo",
    allLabel: "Todos los tipos",
    options: Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "role",
    label: "Rol activo",
    allLabel: "Todos los roles",
    options: Object.entries(PARTNER_ROLE_LABELS).map(([value, label]) => ({ value, label })),
  },
  { kind: "text", name: "city", label: "Ciudad", placeholder: "Ciudad" },
];

export const TAGS_FILTER_DEFINITIONS: FilterDefinition[] = [{ kind: "text", name: "q" }];

export const TAGS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre", placeholder: "Nombre de la etiqueta" },
];
