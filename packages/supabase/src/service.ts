import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Premier usage de service_role dans hifago/ (spec docs/specs/04-gestion-images.md §7) — contourne
// RLS entièrement (hifago/CLAUDE.md §3.5) : réservé aux Route Handlers qui ont déjà vérifié la
// session de l'utilisateur AVANT d'appeler ceci (jamais un filet RLS, jamais exposé au navigateur
// — SUPABASE_SERVICE_ROLE_KEY n'a pas le préfixe NEXT_PUBLIC_). Pas de gestion de cookies : ce
// client n'agit jamais "en tant que" l'utilisateur courant, uniquement pour écrire dans Storage
// une fois l'appelant déjà authentifié/autorisé par le code appelant.
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
