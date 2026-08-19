import type { SupabaseClient } from "@supabase/supabase-js";

// Extrait le 2026-08-19 — reservations/page.tsx et page.tsx (accueil socio, spec 20) dérivaient
// chacun séparément « les établissements que CE partenaire opère activement » (role "operator",
// status "active") : reservations/page.tsx via une requête SQL déjà filtrée (`.eq("role",
// "operator").eq("status","active")`), page.tsx via un fetch de TOUTES les capacités (nécessaire
// là-bas pour la carte de statut, qui affiche aussi les rôles/statuts non-operator/non-active) puis
// un filtre JS équivalent. Deux implémentations de la même règle métier, un seul endroit maintenant.
export type PartnerCapabilityForFilter = {
  role: string;
  status: string;
  establishment_id: string | null;
};

// Prédicat + projection partagés — page.tsx a déjà les lignes non filtrées en mémoire (carte de
// statut), donc pas de requête supplémentaire à lui faire refaire : il appelle directement cette
// fonction pure sur les lignes qu'il a déjà.
export function selectActiveOperatorEstablishmentIds(
  capabilities: PartnerCapabilityForFilter[]
): string[] {
  return capabilities
    .filter((row) => row.role === "operator" && row.status === "active")
    .map((row) => row.establishment_id)
    .filter((id): id is string => Boolean(id));
}

// reservations/page.tsx n'a besoin QUE des établissements opérés (jamais des lignes non filtrées) —
// requête filtrée côté serveur directement, même règle métier que
// selectActiveOperatorEstablishmentIds ci-dessus, traduite en `.eq(...)` plutôt qu'un filtre JS
// après un fetch complet.
export async function getActiveOperatorEstablishmentIds(
  supabase: SupabaseClient,
  partnerId: string | null
): Promise<string[]> {
  if (!partnerId) return [];

  const { data } = await supabase
    .from("partner_capabilities")
    .select("establishment_id")
    .eq("partner_id", partnerId)
    .eq("role", "operator")
    .eq("status", "active");

  return (data ?? [])
    .map((c) => c.establishment_id as string | null)
    .filter((id): id is string => Boolean(id));
}
