import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_TOTP_SECRET, generateTotp } from "./mfa";
import { withDb } from "./db";

// Feature 31 (docs/specs/07-connexion-inscription-complete.md) — Mailpit local (port 54324, déjà
// exposé par `supabase start`) reçoit réellement les emails de confirmation/reset envoyés par
// Supabase Auth : ces tests lisent le vrai email plutôt que de simuler le clic, seule façon de
// prouver que le lien {{ .TokenHash }} + /auth/callback fonctionne de bout en bout. Centralisé ici
// (au lieu de deux copies locales, auth-connection-complete.spec.ts et partner-join.spec.ts) —
// même classe de helper d'authentification programmatique que signInAndCollectCookies/
// createSignedInClient ci-dessous.
export async function latestCallbackLink(
  request: APIRequestContext,
  toEmail: string
): Promise<string> {
  const listRes = await request.get("http://127.0.0.1:54324/api/v1/messages?limit=20");
  const { messages } = await listRes.json();
  const message = messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === toEmail)
  );
  expect(message, `aucun email reçu pour ${toEmail}`).toBeTruthy();
  const full = await (await request.get(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)).json();
  const match = (full.HTML as string).match(/href="([^"]*auth\/callback[^"]*)"/);
  expect(match, "aucun lien /auth/callback trouvé dans l'email").toBeTruthy();
  return match![1].replace(/&amp;/g, "&");
}

// Feature 31 : seul compte seedé avec un facteur TOTP enrôlé aujourd'hui — étendre cette table si
// d'autres comptes de test admin apparaissent un jour, jamais en devinant un secret depuis l'email.
const TOTP_SECRETS_BY_EMAIL: Record<string, string> = {
  "admin@hifago.test": ADMIN_TOTP_SECRET,
};

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : is_admin() exige l'AAL2 —
// partagé par signInAndCollectCookies ET createSignedInClient, les deux idiomes d'authentification
// programmatique de ce fichier, pour qu'aucun des deux ne laisse une session admin bloquée en
// AAL1 (policies/RPC is_admin()-gated échoueraient silencieusement sinon).
async function completeTotpChallengeIfNeeded(
  supabase: SupabaseClient,
  email: string,
  password: string
) {
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totpFactor = factors?.totp[0];
  if (!totpFactor) return;

  const secret = TOTP_SECRETS_BY_EMAIL[email];
  if (!secret) {
    throw new Error(
      `e2e (${email}) : facteur TOTP enrôlé mais aucun secret de test connu pour ce compte (TOTP_SECRETS_BY_EMAIL).`
    );
  }
  // ⚠️ RÉESSAI SUR DEADLOCK, ajouté le 2026-09-08 après diagnostic. Message réel observé :
  // « Failed to update sessions. ERROR: deadlock detected (SQLSTATE 40P01) ».
  //
  // CE QUI SE PASSE. Tous les specs admin partagent LE compte `admin@hifago.test` — le seul avec un
  // facteur TOTP seedé. Quand deux workers Playwright le font monter en AAL2 au même moment, GoTrue
  // met à jour TOUTES les sessions de cet utilisateur dans chacune des deux transactions ; elles
  // verrouillent les mêmes lignes d'`auth.sessions` dans un ordre différent, et Postgres en tue
  // une. C'est la contention déjà nommée dans `.claude/rules/tests.md` (« un compte TOTP seedé
  // partagé, contention constatée à 4 workers »), dont la parade était jusqu'ici de sérialiser des
  // fichiers entiers.
  //
  // ⚠️ ET CE N'EST PAS le diagnostic qui figurait au backlog (« GoTrue chiffre désormais les
  // secrets, la vérification échoue »). Vérifié le 2026-09-08 : le secret en clair du seed est
  // accepté, une session isolée obtient l'AAL2 sans problème, et deux vérifications avec le MÊME
  // code réussissent — il n'y a pas d'anti-rejeu non plus. La panne est une CONCURRENCE, pas un
  // format.
  //
  // POURQUOI UN RETRY PLUTÔT QUE `mode: "serial"`. Un deadlock est transitoire par définition :
  // Postgres annule l'une des deux transactions, donc rien n'a été écrit et rejouer est sûr.
  // Réessayer coûte quelques centaines de millisecondes à la collision près, là où sérialiser un
  // fichier coûte le parallélisme à CHAQUE exécution — et il faudrait le faire fichier par fichier,
  // en l'oubliant sur le prochain.
  await verifierTotp(supabase, email, password, totpFactor.id, secret);
}

/**
 * Sérialise TOUTE la séquence « connexion + montée en AAL2 » d'un compte à facteur TOTP partagé.
 *
 * ⚠️ DIAGNOSTIC COMPLET (2026-09-08), parce que trois correctifs partiels ont échoué avant celui-ci
 * et qu'il ne faut pas les retenter :
 *
 *   • Tous les specs admin partagent LE compte `admin@hifago.test` — donc l'unique facteur TOTP
 *     seedé. C'est lui la ressource contentieuse, pas les sessions.
 *   • Deux workers qui montent en AAL2 en même temps produisent un « deadlock detected
 *     (SQLSTATE 40P01) », visible SEULEMENT dans `docker logs supabase_auth_*` : le client, lui,
 *     reçoit un « Unexpected failure » générique. C'est pourquoi le backlog l'attribuait à tort au
 *     chiffrement des secrets par GoTrue — vérifié le 2026-09-08 : le secret en clair du seed est
 *     accepté, et une session isolée obtient l'AAL2 sans problème.
 *   • Ce qui NE SUFFIT PAS, mesuré : le seul réessai (les workers se re-deadlockent à l'identique) ;
 *     la purge des 45 sessions accumulées (le deadlock survient même à zéro session) ; et un verrou
 *     posé autour du seul verify — pendant qu'un worker attendait son tour, la montée en AAL2 de
 *     l'autre invalidait sa session, et il échouait sur « Auth session missing! ».
 *
 * D'où un verrou qui englobe la connexion ELLE-MÊME. Il ne sérialise que ça : quelques centaines de
 * millisecondes par worker, après quoi navigation, assertions et requêtes redeviennent parallèles —
 * bien moins cher qu'un `mode: "serial"` sur des fichiers entiers, et valable pour TOUS les specs
 * admin sans en modifier aucun.
 *
 * ⚠️ La correction structurelle reste un compte admin (donc un facteur) PAR WORKER, comme le
 * prescrit `AGENTS-PARALLELES.md` point 5 pour tout enregistrement seedé partagé. C'est un lot à
 * part : il faut N comptes seedés et un choix par `parallelIndex`.
 */
async function withVerrouAuthPartagee<T>(email: string, fn: () => Promise<T>): Promise<T> {
  // ⚠️ LE VERROU NE S'APPLIQUE QU'AUX COMPTES À FACTEUR TOTP PARTAGÉ, et cette condition n'est pas
  // une optimisation : sans elle, la première version sérialisait TOUTES les connexions e2e — y
  // compris celles des comptes clients de `apps/web`, qui n'ont aucun facteur MFA et ne se
  // disputent donc rien. Mesuré le 2026-09-08 : la suite web est passée de 1 à 3 échecs
  // (`reserve`, `signup` en timeout), parce que chaque connexion attendait le tour des autres et
  // ouvrait une connexion Postgres pour rien. Un verrou trop large coûte plus qu'il ne protège.
  if (!TOTP_SECRETS_BY_EMAIL[email]) return fn();

  // Clé arbitraire mais FIXE : tout ce qui se connecte à un compte à TOTP partagé doit prendre le
  // MÊME verrou, sinon il ne sert à rien.
  const CLE = 290908;
  return withDb(async (db) => {
    await db.query("select pg_advisory_lock($1)", [CLE]);
    try {
      return await fn();
    } finally {
      await db.query("select pg_advisory_unlock($1)", [CLE]);
    }
  });
}

/** La vérification elle-même, une fois le tour du worker venu. */
async function verifierTotp(
  supabase: SupabaseClient,
  email: string,
  password: string,
  factorId: string,
  secret: string
) {
  let derniereErreur = "";
  for (let essai = 0; essai < 4; essai += 1) {
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      // Le code est régénéré à CHAQUE essai : une tentative peut tomber juste après un changement
      // de fenêtre de 30 s, et rejouer le code périmé échouerait pour une autre raison.
      code: generateTotp(secret),
    });
    if (!verifyError) return;

    derniereErreur = verifyError.message;

    // ⚠️ LE PIÈGE DE CE FILTRE, vérifié dans les logs du conteneur `supabase_auth_*` : le client ne
    // voit JAMAIS le mot « deadlock ». GoTrue journalise
    // « Unhandled server error: ERROR: deadlock detected (SQLSTATE 40P01) » et renvoie au client un
    // « Unexpected failure, please check server logs for more information » — et le deadlock frappe
    // aussi bien `/challenge` que le verify. Filtrer sur « deadlock » ne rejouerait donc rien du
    // tout : c'est ce message générique qu'il faut reconnaître.
    //
    // On rejoue donc les erreurs SERVEUR transitoires, jamais les refus métier : un code faux, un
    // secret erroné ou un facteur absent portent un message explicite et ne s'arrangeront pas en
    // réessayant — échouer tout de suite dit la vérité plus vite.
    const transitoire =
      /deadlock|40P01|could not serialize|40001|unexpected failure|internal server error/i.test(
        derniereErreur
      );
    if (!transitoire) break;

    // Attente courte et DÉSYNCHRONISÉE : deux workers qui réessaieraient au même instant se
    // redeadlockeraient à l'identique.
    await new Promise((resolve) => setTimeout(resolve, 120 * (essai + 1) + Math.random() * 120));

    // ⚠️ RECONNEXION OBLIGATOIRE avant de rejouer, constatée le 2026-09-08 : un échec serveur
    // pendant le challenge emporte la session AAL1 avec lui, et les tentatives suivantes
    // échouaient alors sur « Auth session missing! » — une erreur qui ressemble à un bug de
    // helper alors qu'elle n'est que la conséquence de la première.
    const { error: reconnexion } = await supabase.auth.signInWithPassword({ email, password });
    if (reconnexion) {
      throw new Error(
        `e2e (${email}) : reconnexion impossible après un échec TOTP transitoire : ${reconnexion.message}`
      );
    }
  }

  // Le message client est souvent générique : le motif réel est dans les logs du conteneur
  // (`docker logs supabase_auth_<projet>`), et c'est là qu'il faut regarder — pas ici.
  throw new Error(
    `e2e (${email}) : échec de la vérification TOTP après 4 tentatives : ${derniereErreur}` +
      " — motif réel dans `docker logs supabase_auth_<projet>` (souvent un deadlock sur" +
      " auth.sessions, le compte admin TOTP étant partagé par tous les workers)."
  );
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

// /es/productos/[slug] et /es/r/[code] vivent dans apps/web, pas apps/admin — toute spec qui
// vérifie l'effet d'une action admin/socio sur la fiche publique passe par ces helpers plutôt
// que de reconstruire l'URL à la main.
export const webProductUrl = (slug: string) => `${WEB_APP_URL}/es/productos/${slug}`;
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

  await withVerrouAuthPartagee(email, async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(`e2e signInAndCollectCookies(${email}) a échoué : ${error.message}`);
    }
    await completeTotpChallengeIfNeeded(supabase, email, password);
  });

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
  await withVerrouAuthPartagee(email, async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(`e2e createSignedInClient(${email}) a échoué : ${error.message}`);
    }
    await completeTotpChallengeIfNeeded(supabase, email, password);
  });
  return supabase;
}
