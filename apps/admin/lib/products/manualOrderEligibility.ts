import type { ProductType } from "@/lib/products/useProductTypeFieldsState";

// Miroir côté client de la même règle appliquée côté serveur, SOURCE DE VÉRITÉ :
// supabase/migrations/20260818190000_create_manual_order_line_rpc.sql, `create_manual_order_line`
// (~ligne 86, `if v_product_type in ('hotel', 'lodging', 'camp') then ...`) — 'hotel'/'lodging'
// (chambre/tarif par nuit, hors périmètre d'une réservation manuelle walk-in) et 'camp' (ressource
// partagée multi-jours provider_resource_calendar/availability_blocks, non répliquée dans cette
// RPC). Ce littéral n'existe qu'ici côté TS : toute divergence future avec la migration SQL doit
// être répercutée aux deux endroits à la main (pas de dérivation automatique depuis un signal
// serveur — hors périmètre de ce nettoyage, cf. AGENTS.md/le commentaire de page.tsx qui l'utilise).
export const MANUAL_ORDER_INELIGIBLE_TYPES: readonly ProductType[] = ["hotel", "lodging", "camp"];
