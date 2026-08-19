import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { latestCallbackLink } from "@hifago/e2e-support";

// Les deux tests qui créent une invitation admin partagent le même compte admin seedé, dont le
// facteur TOTP a montré une contention sous exécution parallèle (constaté 2026-08-17, cf. entrée
// hifago/CLAUDE.md §12 la plus récente) — même rationale que partner-establishment-proposals.spec.ts.
test.describe.configure({ mode: "serial" });

// Scénario complet à deux acteurs (cf. plan Feature 13) : un admin crée une invitation et copie le
// lien, puis un contexte navigateur DIFFÉRENT (nouveau visiteur, jamais authentifié) ouvre ce
// lien, remplit le formulaire et atterrit sur son dashboard avec le rôle obtenu — preuve de bout
// en bout des trois écrans (/admin/invitations/new, /partner/join, /partner) dans le même test.
// Depuis la feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md), la
// consommation réussie redirige vers /partner au lieu d'afficher un message inline.
test("un admin crée une invitation, un nouveau visiteur la consomme et atterrit sur son dashboard", async ({
  browser,
}) => {
  // Nom unique par run : la base locale n'est pas remise à zéro entre deux exécutions (comme
  // admin-establishment.spec.ts) — un code fixe casserait la contrainte unique dès la 2e exécution.
  const code = `E2E-JOIN-${Date.now()}`;

  // --- Acteur 1 : l'admin crée l'invitation ---------------------------------------------------
  const adminContext = await browser.newContext();
  await loginAs(adminContext, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const adminPage = await adminContext.newPage();

  await adminPage.goto("/admin/invitations/new");

  await adminPage.locator('input[name="code"]').fill(code);
  await adminPage.getByTestId("onboarding-path-select").click();
  await adminPage.getByRole("option", { name: "Referente" }).click();
  await adminPage.getByTestId("create-invitation-button").click();

  const linkInput = adminPage.getByTestId("invitation-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  await adminContext.close();

  // --- Acteur 2 : un visiteur différent, jamais authentifié, consomme l'invitation -----------
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();

  await visitorPage.goto(`/partner/join?token=${token}`);

  // Les conditions sont consultables sans cocher la case au passage (signalé par Jérôme, ajouté
  // le 2026-08-15) — ouvrir/fermer la modale ne doit jamais basculer la case toute seule, un
  // bouton imbriqué dans Checkbox.Content déclencherait ce bug (cf. commentaire JoinForm.tsx).
  const consentCheckbox = visitorPage.getByTestId("consent-checkbox").locator('input[type="checkbox"]');
  await visitorPage.getByTestId("view-terms-button").click();
  await expect(visitorPage.getByRole("heading", { name: "Conditions du rôle partenaire" })).toBeVisible();
  await expect(visitorPage.getByText(/Lorem ipsum/)).toBeVisible();
  await expect(consentCheckbox).not.toBeChecked();
  await visitorPage.getByTestId("close-terms-button").click();
  await expect(consentCheckbox).not.toBeChecked();

  await visitorPage.locator('input[name="name"]').fill("Nouvelle Organisation E2E");
  await visitorPage
    .locator('input[name="email"]')
    .fill(`partner-join-e2e-${Date.now()}@test.local`);
  await visitorPage.locator('input[name="password"]').fill("PartnerJoin1234!");
  await visitorPage.getByTestId("consent-checkbox").click();
  await visitorPage.getByTestId("join-submit-button").click();

  await visitorPage.waitForURL("**/partner");
  await expect(visitorPage.getByTestId("partner-role-referrer")).toBeVisible();
  await expect(visitorPage.getByTestId("partner-role-referrer")).toContainText("Referente");

  await visitorContext.close();
});

// Constat 2026-08-17 : un visiteur déjà authentifié (bouton "Continuar con Google", ou toute
// session existante) sautait tout le formulaire créateur de compte — consume_partner_invitation
// ne s'appuie que sur auth.uid(), jamais sur le mode de connexion (cf. JoinForm.tsx). Piloter le
// vrai écran Google OAuth n'est pas testable en e2e (jamais le vrai écran Google, cf.
// hifago/CLAUDE.md §6 point 2) : ce test établit une session par inscription libre + confirmation
// Mailpit réelle (même chemin que auth-connection-complete.spec.ts) puis rouvre /partner/join avec
// cette session déjà active — exactement l'état dans lequel /auth/callback dépose un visiteur venu
// de Google, seule la provenance de la session diffère.
test("un visiteur déjà authentifié consomme l'invitation sans recréer de compte", async ({
  browser,
  request,
}) => {
  const code = `E2E-JOIN-CONNECTED-${Date.now()}`;

  const adminContext = await browser.newContext();
  await loginAs(adminContext, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const adminPage = await adminContext.newPage();

  await adminPage.goto("/admin/invitations/new");
  await adminPage.locator('input[name="code"]').fill(code);
  await adminPage.getByTestId("onboarding-path-select").click();
  await adminPage.getByRole("option", { name: "Referente" }).click();
  await adminPage.getByTestId("create-invitation-button").click();

  const linkInput = adminPage.getByTestId("invitation-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  await adminContext.close();

  // --- Visiteur : compte confirmé et déjà connecté (inscription libre, hors chemin invitation) ---
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();
  const email = `e2e-join-connected-${Date.now()}@test.local`;

  await visitorPage.goto("/signup");
  await visitorPage.locator('input[name="email"]').fill(email);
  await visitorPage.locator('input[name="password"]').fill("JoinConnected1234!");
  await visitorPage.locator('input[name="confirm-password"]').fill("JoinConnected1234!");
  await visitorPage.getByTestId("signup-submit-button").click();
  await visitorPage.waitForURL(/\/verify-email/);

  const confirmLink = await latestCallbackLink(request, email);
  await visitorPage.goto(confirmLink);
  await visitorPage.waitForURL(/\/partner$/);

  // --- Le même visiteur, déjà connecté, ouvre le lien d'invitation ---
  await visitorPage.goto(`/partner/join?token=${token}`);

  await expect(visitorPage.getByTestId("join-connected-as")).toContainText(email);
  await expect(visitorPage.getByTestId("google-signin-button")).toHaveCount(0);
  await expect(visitorPage.locator('input[name="email"]')).toHaveCount(0);
  await expect(visitorPage.locator('input[name="password"]')).toHaveCount(0);

  await visitorPage.locator('input[name="name"]').fill("Visiteur Déjà Connecté E2E");
  await visitorPage.getByTestId("consent-checkbox").click();
  await visitorPage.getByTestId("join-submit-button").click();

  await visitorPage.waitForURL("**/partner");
  await expect(visitorPage.getByTestId("partner-role-referrer")).toBeVisible();

  await visitorContext.close();
});

test("un lien sans jeton affiche un message d'erreur clair, sans formulaire", async ({ page }) => {
  await page.goto("/partner/join");

  await expect(page.getByTestId("invalid-token-error")).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
});
