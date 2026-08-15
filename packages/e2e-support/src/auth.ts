import type { BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_TOTP_SECRET, generateTotp } from "./mfa";

// Feature 31 : seul compte seedé avec un facteur TOTP enrôlé aujourd'hui — étendre cette table si
// d'autres comptes de test admin apparaissent un jour, jamais en devinant un secret depuis l'email.
const TOTP_SECRETS_BY_EMAIL: Record<string, string> = {
  "admin@hifago.test": ADMIN_TOTP_SECRET,
};

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : is_admin() exige l'AAL2 —
// partagé par signInAndCollectCookies ET createSignedInClient, les deux idiomes d'authentification
// programmatique de ce fichier, pour qu'aucun des deux ne laisse une session admin bloquée en
// AAL1 (policies/RPC is_admin()-gated échoueraient silencieusement sinon).
async function completeTotpChallengeIfNeeded(supabase: SupabaseClient, email: string) {
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totpFactor = factors?.totp[0];
  if (!totpFactor) return;

  const secret = TOTP_SECRETS_BY_EMAIL[email];
  if (!secret) {
    throw new Error(
      `e2e (${email}) : facteur TOTP enrôlé mais aucun secret de test connu pour ce compte (TOTP_SECRETS_BY_EMAIL).`
    );
  }
  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId: totpFactor.id,
    code: generateTotp(secret),
  });
  if (verifyError) {
    throw new Error(`e2e (${email}) : échec de la vérification TOTP : ${verifyError.message}`);
  }
}

// Comptes seedés par Tranche 1 (supabase/seed.sql) — mot de passe commun 'Seed1234!'.
export const SEEDED_ACCOUNTS = {
  referentActif: "referent.actif@hifago.test",
  operateurActif: "operateur.actif@hifago.test",
  referentSuspendu: "referent.suspendu@hifago.test",
  admin: "admin@hifago.test",
  // Feature 15 : seul profil avec une capacité operator ACTIVE et scopée à un establishment_id
  // précis (operateurActif reste "en attente", establishment_id null — cf. supabase/seed.sql).
  operadorPropuestas: "operador.propuestas@hifago.test",
} as const;

export const SEEDED_PASSWORD = "Seed1234!";

// Origines des deux apps (monorepo web/admin, scindé le 2026-08-14) — un seul point de vérité
// pour les e2e des deux apps, plutôt qu'une constante locale redéclarée par fichier de spec.
export const WEB_APP_URL = "http://localhost:3100";
export const ADMIN_APP_URL = "http://localhost:3101";

// /es/products/[slug] et /es/r/[code] vivent dans apps/web, pas apps/admin — toute spec qui
// vérifie l'effet d'une action admin/socio sur la fiche publique passe par ces helpers plutôt
// que de reconstruire l'URL à la main.
export const webProductUrl = (slug: string) => `${WEB_APP_URL}/es/products/${slug}`;
export const webReferralUrl = (code: string) => `${WEB_APP_URL}/es/r/${code}`;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/**
 * Authentification programmatique pour les tests e2e qui n'ont pas besoin de piloter le
 * formulaire de connexion lui-même. Plutôt que de reconstruire à la main le nom/format des
 * cookies de session @supabase/ssr (dérivés de l'URL, encodage base64url, chunking), on laisse un
 * vrai `createServerClient` les calculer via un faux "cookie jar" en mémoire — plus robuste qu'une
 * réimplémentation qui casserait silencieusement à la moindre évolution du package. Le `BASE_URL`
 * auquel attacher ces cookies diffère par app (3100 web, 3101 admin) — laissé au wrapper
 * `loginAs` local de chaque app, pas figé ici.
 */
export async function signInAndCollectCookies(
  supabaseUrl: string,
  supabaseAnonKey: string,
  email: string,
  password: string
): Promise<{ name: string; value: string }[]> {
  // Map, pas un tableau : le challenge TOTP (si nécessaire, ci-dessous) réécrit les mêmes cookies
  // de session avec de nouvelles valeurs (AAL2) — un tableau accumulerait l'ancienne ET la
  // nouvelle valeur du même cookie, ambiguë pour context.addCookies().
  const jar = new Map<string, string>();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`e2e signInAndCollectCookies(${email}) a échoué : ${error.message}`);
  }

  await completeTotpChallengeIfNeeded(supabase, email);

  return Array.from(jar, ([name, value]) => ({ name, value }));
}

/** `loginAs` prêt à l'emploi pour un `BASE_URL` donné — un wrapper de 3 lignes par app. */
export function makeLoginAs(baseUrl: string) {
  return async function loginAs(context: BrowserContext, email: string, password: string) {
    const cookies = await signInAndCollectCookies(SUPABASE_URL, SUPABASE_ANON_KEY, email, password);
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseUrl })));
  };
}

/**
 * Authentification directe par mot de passe hors navigateur (setup de fixtures via de vrais
 * appels RPC/REST plutôt qu'un insert SQL brut) — même idiome que signInAndCollectCookies, sans
 * jamais avoir besoin des cookies eux-mêmes.
 */
export async function createSignedInClient(email: string, password: string) {
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`e2e createSignedInClient(${email}) a échoué : ${error.message}`);
  }
  await completeTotpChallengeIfNeeded(supabase, email);
  return supabase;
}
