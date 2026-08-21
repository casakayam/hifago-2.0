import { test, expect } from "@playwright/test";
import {
  generateTotp,
  withDb,
  latestCallbackLink,
  createTestUser,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  ADMIN_APP_URL,
} from "@hifago/e2e-support";

// Feature 31 — révision 2026-08-19, 3e passe (docs/specs/07-connexion-inscription-complete.md
// §10) : inscription libre neutralisée au niveau UI (`/signup` redirige vers `/login`, aucun lien
// « Crear cuenta ») mais le bouton Google, lui, RESTE proposé sur `/login` (et `/partner/join`,
// cf. partner-join.spec.ts) — un blocage global (`enable_signup=false`, 2e passe) cassait aussi
// l'acceptation d'invitation via Google (retour réel de Jérôme), abandonné. À la place,
// `app/auth/callback/route.ts` nettoie a posteriori tout compte fraîchement créé (Google OU
// confirmation email `type=signup`) qui n'arrive pas via `/partner/join` — testé ci-dessous via le
// chemin email (`POST /auth/v1/signup` brut + lien de confirmation Mailpit réel), qui partage
// exactement la même logique de nettoyage que Google (jamais piloté en e2e, hifago/CLAUDE.md §6
// point 2).
test("/signup redirige et le lien « Crear cuenta » disparaît de /login ; le bouton Google, lui, reste proposé", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.waitForURL(/\/login/);

  await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
  await expect(page.getByTestId("google-signin-button")).toBeVisible();
});

test("un compte fraîchement créé hors contexte d'invitation est supprimé au retour du callback, avec message clair", async ({
  page,
  request,
}) => {
  const email = `e2e-fresh-outside-invite-${Date.now()}@test.local`;
  // Feature 32 : confirmation.html construit désormais son lien depuis {{ .RedirectTo }}
  // (dynamique, apps/web a aussi son propre /auth/callback depuis cette feature) plutôt qu'un
  // localhost:3101/auth/callback?...&next=/partner codé en dur — un appel signup SANS redirect_to
  // retomberait sur site_url nu (sans query string), un lien cassé. `redirect_to` passé
  // explicitement ici (paramètre de requête brut, cf. GoTrueClient.js) pour reproduire exactement
  // l'ancien comportement testé : next=/partner, jamais /partner/join, donc bien traité comme
  // "hors invitation" par la route de nettoyage.
  const redirectTo = new URL("/auth/callback", ADMIN_APP_URL);
  redirectTo.searchParams.set("next", "/partner");
  const signupResponse = await request.post(
    `${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo.toString())}`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { email, password: "FreshOutside1234!" },
    }
  );
  expect(signupResponse.ok()).toBe(true);

  const confirmLink = await latestCallbackLink(request, email);
  await page.goto(confirmLink);
  await page.waitForURL(/\/login\?error=google_signup_blocked/);
  // .first() : React StrictMode (dev) peut monter LoginForm deux fois et donc déclencher ce toast
  // deux fois — comportement déjà documenté et accepté (hifago/CLAUDE.md §11), sans effet en
  // production ; on vérifie juste qu'au moins une occurrence est visible.
  await expect(page.getByText(/no tiene cuenta todavía/).first()).toBeVisible();

  const stillExists = await withDb(async (client) => {
    const { rows } = await client.query("select 1 from auth.users where email = $1", [email]);
    return rows.length > 0;
  });
  expect(stillExists).toBe(false);
});

test("connexion sur un compte non confirmé redirige vers /verify-email", async ({ page }) => {
  const email = `e2e-unconfirmed-${Date.now()}@test.local`;
  await createTestUser(email, "UnconfirmedE2E1234!", { confirmed: false });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("UnconfirmedE2E1234!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/verify-email/);
  await expect(page.getByText(email)).toBeVisible();
});

test("mot de passe oublié : email générique, lien réel, reconnexion avec le nouveau mot de passe", async ({
  page,
  request,
  context,
}) => {
  const email = `e2e-forgot-${Date.now()}@test.local`;
  await createTestUser(email, "OldPassword123!");

  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill(email);
  await page.getByTestId("forgot-password-submit").click();
  await expect(page.getByTestId("forgot-password-sent")).toBeVisible();

  const resetLink = await latestCallbackLink(request, email);
  await page.goto(resetLink);
  await page.waitForURL(/\/reset-password/);
  await page.locator('input[name="password"]').fill("NewPassword456!");
  await page.locator('input[name="confirm-password"]').fill("NewPassword456!");
  await page.getByTestId("reset-password-submit").click();
  await page.waitForURL(/\/partner$|\/$/);

  await context.clearCookies();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("NewPassword456!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/partner$/);
});

test("2FA admin : optionnel (pas de redirection forcée), enrôlement volontaire fonctionnel, puis vérification à la session suivante", async ({
  page,
  context,
}) => {
  // Rendu optionnel le 2026-08-15 (décision Jérôme, après un bug d'enrôlement ayant bloqué un
  // accès admin réel) : is_admin() ne requiert plus l'AAL2
  // (20260815270000_admin_2fa_optional.sql) et aucun layout ne redirige plus vers /mfa/*. Ce test
  // couvre désormais l'usage volontaire (navigation directe), pas un blocage.
  //
  // Compte de test dédié (jamais le seed admin@hifago.test, déjà enrôlé par supabase/seed.sql
  // pour les autres specs via packages/e2e-support) — capacité admin accordée directement en base
  // (même idiome que setPartnerCodeActive/resetAvailability, packages/e2e-support/src/db.ts), pas
  // via un flux d'invitation qui n'existe pas pour ce rôle.
  const email = `e2e-2fa-admin-${Date.now()}@test.local`;
  await createTestUser(email, "TwoFaAdmin1234!");

  await withDb(async (client) => {
    await client.query(
      `insert into partner_capabilities (account_id, role, source, status)
       select id, 'admin', 'migration', 'active' from auth.users where email = $1`,
      [email]
    );
  });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("TwoFaAdmin1234!");
  await page.locator('button[type="submit"]').click();

  // Aucune redirection forcée : un compte admin va directement sur /admin sans passer par le 2FA.
  await page.waitForURL(/\/admin$/);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  // Enrôlement volontaire (navigation directe, pas via un redirect de garde) — même scénario que
  // celui rencontré en réel : le QR doit s'afficher sans qu'un layout n'ait poussé l'utilisateur ici.
  await page.goto("/mfa/enroll");
  const secret = await page.getByTestId("mfa-secret").innerText();
  await page.locator('input[name="code"]').fill(generateTotp(secret));
  await page.getByTestId("mfa-enroll-submit").click();
  await page.waitForURL(/\/admin$/);

  // Nouvelle session : le facteur existe déjà, une simple vérification suffit (pas un second
  // enrôlement) — /mfa/verify reste utilisable volontairement, toujours sans blocage automatique.
  await context.clearCookies();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("TwoFaAdmin1234!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin$/);

  await page.goto("/mfa/verify");
  await page.locator('input[name="code"]').fill(generateTotp(secret));
  await page.getByTestId("mfa-verify-submit").click();
  await page.waitForURL(/\/admin$/);
});
