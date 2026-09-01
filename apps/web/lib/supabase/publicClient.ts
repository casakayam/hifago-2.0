import { createClient } from "@supabase/supabase-js";
import type { Database } from "@hifago/supabase/database.types";

/**
 * Client Supabase ANONYME et SANS COOKIES, pour le contenu strictement public.
 *
 * Distinct des trois clients de @hifago/supabase (browser / server-avec-cookies / service_role).
 * Reste local à apps/web tant qu'il n'a qu'un consommateur : hifago/CLAUDE.md §2.1 n'admet une
 * migration vers packages/ que si elle est PROUVÉE consommée par les deux apps, jamais anticipée.
 *
 * Trois raisons de ne pas réutiliser `createClient` de @hifago/supabase/server ici :
 *  - un sitemap n'a aucune session à lire ;
 *  - `server.ts` appelle `cookies()`, ce qui force le rendu dynamique — l'éviter prépare la sortie
 *    du tout-dynamique d'apps/web (chantier séparé) ;
 *  - sans `cookies()`, l'appelant est testable unitairement : aucun mock de `next/headers`
 *    n'existe dans ce dépôt.
 *
 * ⚠️ JAMAIS `createServiceRoleClient` pour du contenu public : il contournerait la RLS, donc
 * `sellable` et `status`, et publierait au monde des fiches non publiées. Ici la RLS anon
 * s'applique pleinement — c'est le point, pas une limitation.
 */
export function createPublicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Rien à persister ni à rafraîchir : ce client ne connaît aucune session, et un timer de
    // refresh dans un rendu serveur ne servirait qu'à fuir.
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
