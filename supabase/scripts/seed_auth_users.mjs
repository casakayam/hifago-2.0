// Crée les comptes de test de supabase/seed.sql via l'API Admin Auth Supabase
// (supabase.auth.admin.createUser), avec un UUID fixe par compte — jamais un
// `insert into auth.users` direct, bloqué sur Supabase Cloud (permission denied for schema
// auth, constaté 2026-08-21 : pas un grant manquant, une restriction plateforme, absente en
// local où l'image Docker tourne en superuser). Les UUID sont ceux déjà référencés partout
// ailleurs dans seed.sql (partner_accounts, orders, order_lines...) — ne jamais les changer
// sans mettre à jour ces deux fichiers ensemble.
//
// Le trigger on_auth_user_created (20260813163438_identity_account_provisioning.sql) provisionne
// partner_accounts à l'INSERT réel dans auth.users — createUser() déclenche ce même trigger
// (GoTrue fait un vrai INSERT SQL), donc ce script DOIT tourner avant seed.sql, jamais après.
//
// Usage local :
//   SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SERVICE_ROLE_KEY="$(npx supabase status -o env | grep SERVICE_ROLE_KEY | cut -d'"' -f2)" \
//     node supabase/scripts/seed_auth_users.mjs
//
// Usage préprod (jamais sans /hifago-verify-compte au préalable, cf. hifago/CLAUDE.md §8.1) :
//   SUPABASE_URL="https://<project-ref>.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<en variable de
//     session uniquement, jamais dans un fichier — cf. §8.2>" node supabase/scripts/seed_auth_users.mjs
//
// Idempotent volontairement absent : ce script suppose une base fraîche (après `db reset`/juste
// après les migrations sur un projet cloud neuf) — un compte déjà existant fait échouer l'appel
// avec un message explicite plutôt que de continuer silencieusement sur un état ambigu.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis en variables d'environnement " +
      "(jamais de valeur par défaut codée en dur ici — cf. hifago/CLAUDE.md §8.2)."
  );
  process.exit(1);
}

const SEED_PASSWORD = "Seed1234!";

// Mêmes 5 comptes que la boucle profile + admin@hifago.test + operador.propuestas@hifago.test
// de seed.sql (mot de passe requis : connexion e2e réelle sur ces comptes).
const USERS_WITH_PASSWORD = [
  { id: "a0000000-0000-4000-8000-000000000002", email: "referent.actif@hifago.test" },
  { id: "a0000000-0000-4000-8000-000000000003", email: "operateur.actif@hifago.test" },
  { id: "a0000000-0000-4000-8000-000000000004", email: "referent.suspendu@hifago.test" },
  { id: "a0000000-0000-4000-8000-000000000005", email: "admin@hifago.test" },
  { id: "a0000000-0000-4000-8000-000000000006", email: "operador.propuestas@hifago.test" },
];

// Feature 25 (audiences/campagne) : jamais connectés, seulement ciblés par une campagne admin —
// aucun mot de passe, comme l'`insert into auth.users (id, email)` minimal qu'ils remplacent.
const USERS_WITHOUT_PASSWORD = [
  { id: "d0000000-0000-4000-8000-000000000001", email: "campaign-client-consent-seed@test.local" },
  { id: "d0000000-0000-4000-8000-000000000002", email: "campaign-client-no-consent-seed@test.local" },
];

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const user of [...USERS_WITH_PASSWORD, ...USERS_WITHOUT_PASSWORD]) {
    const withPassword = USERS_WITH_PASSWORD.includes(user);
    const { error } = await admin.auth.admin.createUser({
      id: user.id,
      email: user.email,
      email_confirm: true,
      ...(withPassword ? { password: SEED_PASSWORD } : {}),
    });
    if (error) {
      throw new Error(`création ${user.email} (${user.id}) a échoué : ${error.message}`);
    }
    console.log(`✓ auth.users créé : ${user.email} (${user.id})`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
