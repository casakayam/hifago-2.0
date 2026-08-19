import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

// Garde partagée par les layouts /partner/products, /partner/establishment et /partner/reservations
// (extrait le 2026-08-18, ex-duplication verbatim des trois — garde partner_id ajoutée le
// 2026-08-17, cf. l'historique conservé dans chacun de ces layouts appelants). Un compte sans
// partner_id (inscription libre, pas encore rejoint via invitation ou création admin) ni admin
// (qui n'a lui non plus jamais de partner_id — capacité portée par le compte lui-même, sans
// organisation, cf. commentaire de 20260813161117_identity_core_tables.sql) est redirigé vers
// `fallbackPath`. La vraie barrière de données reste toujours la RLS/les RPC internes propres à
// chaque écran (cf. commentaires de chaque layout appelant) — cette garde évite seulement
// d'afficher un écran vide à un visiteur sans rôle du tout.
export async function requirePartnerOrAdmin(
  supabase: SupabaseClient,
  userId: string,
  fallbackPath = "/partner"
): Promise<{ partnerId: string | null; isAdmin: boolean }> {
  const [{ data: partnerId }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("partner_id_for_account", { uid: userId }),
    supabase.rpc("is_admin", { uid: userId }),
  ]);

  if (!partnerId && !isAdmin) {
    redirect(fallbackPath);
  }

  return { partnerId, isAdmin: Boolean(isAdmin) };
}
