import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

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

test("un lien sans jeton affiche un message d'erreur clair, sans formulaire", async ({ page }) => {
  await page.goto("/partner/join");

  await expect(page.getByTestId("invalid-token-error")).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
});
