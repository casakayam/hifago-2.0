import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.3) — jusqu'ici seul
// /admin/invitations/new existait, aucun suivi de ce qui a été envoyé/consommé/expiré.

test("la liste pagine et une invitación pendiente puede revocarse", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const code = `E2E-REVOKE-${Date.now()}`;
  await page.goto("/admin/invitations/new");
  await page.locator('input[name="code"]').fill(code);
  await page.getByTestId("onboarding-path-select").click();
  await page.getByRole("option", { name: "Referente" }).click();
  await page.getByTestId("create-invitation-button").click();
  await expect(page.getByTestId("invitation-link")).toBeVisible();

  await page.goto("/admin/invitations");
  await expect(page.getByTestId("pagination")).toBeVisible();

  const row = page.locator('[data-testid^="invitation-row-"]', { hasText: code });
  await expect(row).toContainText("Pendiente");

  await row.getByTestId(/^revoke-invitation-/).click();
  await page.getByTestId("confirm-revoke-button").click();

  await expect(row).toContainText("Revocada");
  await expect(row.getByTestId(/^revoke-invitation-/)).toHaveCount(0);
});

// Scénario à deux acteurs (même patron que partner-join.spec.ts) : un Prestador invité qui
// s'inscrit sans qu'aucun établissement n'existe encore doit apparaître comme actionnable côté
// admin (§1 constat 2 de la spec — la mécanique de rattachement existe déjà et est sûre,
// seule sa visibilité manquait), avec un lien qui préremplit bien le partenaire résolu.
test("un Prestador consumido sin establecimiento aparece con el badge accionable", async ({
  browser,
}) => {
  const code = `E2E-PRESTADOR-${Date.now()}`;
  const signerName = `Prestador E2E ${Date.now()}`;

  const adminContext = await browser.newContext();
  await loginAs(adminContext, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const adminPage = await adminContext.newPage();

  await adminPage.goto("/admin/invitations/new");
  await adminPage.locator('input[name="code"]').fill(code);
  await adminPage.getByTestId("onboarding-path-select").click();
  await adminPage.getByRole("option", { name: "Prestador" }).click();
  await adminPage.getByTestId("create-invitation-button").click();

  const link = await adminPage.getByTestId("invitation-link").inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();
  await visitorPage.goto(`/partner/join?token=${token}`);
  await visitorPage.locator('input[name="name"]').fill(signerName);
  await visitorPage
    .locator('input[name="email"]')
    .fill(`prestador-e2e-${Date.now()}@test.local`);
  await visitorPage.locator('input[name="password"]').fill("PrestadorJoin1234!");
  await visitorPage.getByTestId("consent-checkbox").click();
  await visitorPage.getByTestId("join-submit-button").click();
  await visitorPage.waitForURL("**/partner");

  // Le dashboard du partenaire reflète déjà l'attente (§5.1) — vérifié ici au passage, avant de
  // repasser côté admin.
  await expect(visitorPage.getByTestId("partner-establishment-pending")).toBeVisible();
  await visitorContext.close();

  await adminPage.goto("/admin/invitations");
  const row = adminPage.locator('[data-testid^="invitation-row-"]', { hasText: code });
  await expect(row).toContainText("Consumida");
  const badge = row.getByTestId(/^invitation-missing-establishment-/);
  await expect(badge).toBeVisible();

  // Navigation directe sur le href plutôt que .click() : flake de clic déjà documenté ailleurs
  // dans ce repo (hifago/CLAUDE.md §11, admin-home-navigation.spec.ts) — hors sujet ici, ce test
  // vérifie le lien généré et le préremplissage, pas la fiabilité du clic React Aria.
  const href = await badge.getAttribute("href");
  expect(href).toMatch(/\/admin\/establishments\/new\?partner_id=/);
  await adminPage.goto(href!);
  await expect(adminPage.getByTestId("partner-search")).toHaveValue(signerName);

  await adminContext.close();
});
