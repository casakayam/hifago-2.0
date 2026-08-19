import { test, expect, type Page } from "@playwright/test";
import { generateTotp, withDb, latestCallbackLink } from "@hifago/e2e-support";

async function signUp(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm-password"]').fill(password);
  await page.getByTestId("signup-submit-button").click();
  await page.waitForURL(/\/verify-email/);
}

test("inscription libre : confirmation email obligatoire, renvoi possible, atterrit sur /partner", async ({
  page,
  request,
}) => {
  const email = `e2e-signup-${Date.now()}@test.local`;
  await signUp(page, email, "SignupE2E1234!");
  await expect(page.getByText(email)).toBeVisible();

  // Renvoi : un deuxième email doit arriver (pas seulement le bouton qui se désactive). Attente
  // > 1s (config.toml [auth.email] max_frequency) : sans elle, Supabase rejette ce renvoi comme
  // trop rapproché du signUp() qui vient d'envoyer le premier email.
  await page.waitForTimeout(1100);
  await page.getByTestId("resend-confirmation-button").click();
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Correo reenviado." })
  ).toBeVisible();

  const link = await latestCallbackLink(request, email);
  await page.goto(link);
  await page.waitForURL(/\/partner$/);
  await expect(page.getByText("Aún no tienes ningún rol asignado.")).toBeVisible();

  // Garde partner_id (constat 2026-08-17) : un compte sans partner_id ne doit jamais atteindre
  // /partner/establishment/* — jusqu'ici seule la soumission du formulaire échouait (reason
  // `not_a_partner` de submit_establishment_creation_proposal), sans explication à l'écran.
  await page.goto("/partner/establishment/new");
  await page.waitForURL(/\/partner$/);
  await expect(page.getByText("Aún no tienes ningún rol asignado.")).toBeVisible();
});

test("connexion sur un compte non confirmé redirige vers /verify-email", async ({ page }) => {
  const email = `e2e-unconfirmed-${Date.now()}@test.local`;
  await signUp(page, email, "UnconfirmedE2E1234!");

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
  await signUp(page, email, "OldPassword123!");
  await page.goto(await latestCallbackLink(request, email));
  await page.waitForURL(/\/partner$/);
  await context.clearCookies();

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

test("/login et /signup affichent le bouton Google", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("google-signin-button")).toBeVisible();
  await page.goto("/signup");
  await expect(page.getByTestId("google-signin-button")).toBeVisible();
});

test("2FA admin : optionnel (pas de redirection forcée), enrôlement volontaire fonctionnel, puis vérification à la session suivante", async ({
  page,
  request,
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
  await signUp(page, email, "TwoFaAdmin1234!");
  await page.goto(await latestCallbackLink(request, email));
  await page.waitForURL(/\/partner$/);

  await withDb(async (client) => {
    await client.query(
      `insert into partner_capabilities (account_id, role, source, status)
       select id, 'admin', 'migration', 'active' from auth.users where email = $1`,
      [email]
    );
  });

  await context.clearCookies();
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
