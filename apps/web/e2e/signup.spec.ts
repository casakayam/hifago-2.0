import { test, expect } from "@playwright/test";
import {
  resetAvailability,
  countOrderLines,
  mockMercadoPagoCheckout,
  latestCallbackLink,
} from "@hifago/e2e-support";

// Feature 32 : chemin heureux unique — inscription client sur apps/web (jusqu'ici inexistante,
// cf. docs/01-cahier-des-charges-client.md §2), confirmation par email réelle (Mailpit local,
// même mécanisme que auth-connection-complete.spec.ts côté apps/admin), connexion automatique via
// le callback, puis panier → checkout avec pré-remplissage (§3.5) → paiement mocké. Un seul test :
// les variantes de validation (mot de passe trop court, emails déjà pris) n'ont pas de logique
// dérivée non triviale dans SignupForm.tsx (cf. CLAUDE.md §6.5) — pas de test composant dédié.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = "2026-09-15"; // dédiée à ce spec, disjointe de 2026-09-05/07/10/12/13/14 (autres specs).

test("un client s'inscrit, confirme par email, puis paie connecté avec ses infos pré-remplies", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  const email = `e2e-signup-${Date.now()}@test.local`;
  const password = "Seed1234!";

  await page.goto("/es/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm-password"]').fill(password);
  await page.getByTestId("signup-submit-button").click();

  await page.waitForURL(new RegExp(`/es/verify-email\\?email=${encodeURIComponent(email)}`));

  const confirmLink = await latestCallbackLink(page.request, email);
  await page.goto(confirmLink);
  // next=/es encodé dans emailRedirectTo (SignupForm.tsx) : atterrit connecté sur l'accueil.
  await page.waitForURL(/\/es\/?$/);

  await page.getByTestId("catalog-link-tour-lancha-guatape").click();
  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/es\/checkout/);

  // §3.5 — premier achat de ce compte tout juste créé (aucune commande antérieure) : l'email doit
  // déjà être rempli depuis auth.users.email, nom/téléphone doivent rester vides.
  await expect(page.locator('input[name="holder-email"]')).toHaveValue(email);
  await expect(page.locator('input[name="holder-name"]')).toHaveValue("");
  await expect(page.locator('input[name="holder-phone"]')).toHaveValue("");

  await page.locator('input[name="holder-name"]').fill("Cliente E2E Signup");
  await page.locator('input[name="holder-phone"]').fill("+57 300 111 5555");

  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  await page.waitForURL(redirectUrl);
  const { lines } = await countOrderLines(PRODUCT_ID, DATE);
  expect(lines).toBe(1);
});
