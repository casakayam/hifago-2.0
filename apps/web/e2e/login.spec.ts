import { test, expect } from "@playwright/test";
import { SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { resetAvailability, countOrderLines, mockMercadoPagoCheckout } from "@hifago/e2e-support";

// Feature 6 : la fiche produit n'a plus aucun état dépendant de l'authentification (le bouton
// "Añadir al carrito" est identique connecté ou non — la vérification de session a été déplacée
// au checkout, cf. app/(public)/[locale]/checkout/CheckoutForm.tsx). La preuve que la session
// posée par le formulaire de login survit à une navigation serveur suivante (proxy.ts +
// lib/supabase/server.ts) se fait donc désormais en poussant le parcours jusqu'au bout : si la
// session ne survivait pas, /checkout lirait isAuthenticated=false et create_order échouerait en
// not_authenticated au lieu de réussir.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = "2026-09-12"; // date dédiée à ce spec (cf. supabase/seed.sql), disjointe de
// 2026-09-05/07/10 utilisées par reserve.spec.ts / reserve-concurrency.spec.ts.

// Seul test qui pilote vraiment le formulaire de connexion (cf. hifago/CLAUDE.md §6 — jamais de
// clic UI pour l'auth des tests qui n'en ont pas besoin, mais celui-ci teste précisément l'écran
// de login lui-même, pas seulement un contournement).
test("un compte seedé peut se connecter via le formulaire /[locale]/login", async ({ page }) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  await page.goto("/es/login");
  await page.locator('input[name="email"]').fill(SEEDED_ACCOUNTS.referentActif);
  await page.locator('input[name="password"]').fill(SEEDED_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Redirection vers la page par défaut (pas de ?next= dans ce test).
  await expect(page).toHaveURL(/\/es\/?$/);

  await page.getByTestId("catalog-link-tour-lancha-guatape").click();
  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/es\/checkout/);
  // Preuve directe : isAuthenticated=true a été lu côté serveur pour CETTE requête — le message
  // "Inicia sesión para validar tu pedido." ne doit jamais apparaître ici.
  await expect(page.getByText("Inicia sesión")).toHaveCount(0);

  await page.locator('input[name="holder-name"]').fill("Cliente E2E Login");
  await page.locator('input[name="holder-phone"]').fill("+57 300 111 4444");
  await page.locator('input[name="holder-email"]').fill("cliente.login@example.com");
  // Spec 19 §0 Tranche 1 : create_order réussi enchaîne désormais automatiquement le paiement
  // Mercado Pago (redirection réelle, seul l'appel SDK externe est mocké). order-success n'est
  // qu'un état transitoire — la redirection peut déjà l'avoir remplacé avant que Playwright ne
  // l'observe (race constatée en testant) : attendre l'URL finale est le seul checkpoint fiable.
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  // Preuve la plus forte : create_order a lui-même relu auth.uid() côté serveur et accepté la
  // commande — la session posée par le formulaire de login a donc bien survécu jusque-là.
  await page.waitForURL(redirectUrl);
  const { lines } = await countOrderLines(PRODUCT_ID, DATE);
  expect(lines).toBe(1);
});

test("un identifiant invalide affiche une erreur claire, sans redirection", async ({ page }) => {
  await page.goto("/es/login");

  await page.locator('input[name="email"]').fill(SEEDED_ACCOUNTS.referentActif);
  await page.locator('input[name="password"]').fill("mot-de-passe-invalide");
  await page.locator('button[type="submit"]').click();

  await expect(page.getByTestId("login-error")).toBeVisible();
  await expect(page).toHaveURL(/\/es\/login/);
});
