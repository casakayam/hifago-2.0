import { test, expect } from "@playwright/test";
import { resetAvailability, seedDate, irAPagoTrasAgregar } from "@hifago/e2e-support";

// Un guest crée une commande (create_order vide cart_items dès qu'elle réussit, spec 32 — la
// réservation existe déjà, cupo décrémenté) et ferme l'onglet avant de payer. S'il revient sur
// /carrito ou /pago avec LA MÊME session anonyme, ces deux écrans affichaient jusqu'ici « ton
// panier est vide » sans aucun moyen de retrouver sa commande (constaté en testant en réel,
// 2026-09-14).
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = seedDate(18); // dédiée à ce spec, disjointe de 5/7/10/12/13/14/15/16/17/20 (autres specs).

test("commande créée sans payer → réapparaît sur /carrito et /pago, même session", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  await page.goto("/es/productos/tour-lancha-guatape");
  await expect(page.getByTestId("product-name")).toBeVisible();
  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await irAPagoTrasAgregar(page);

  await page.locator('input[name="holder-name"]').fill("Cliente E2E Reanudacion");
  await page.locator('input[name="holder-phone"]').fill("+57 300 444 5558");
  await page.locator('input[name="holder-email"]').fill("reanudacion.uno@example.com");
  await page.getByTestId("submit-order-button").click();
  // Aucun paiement tenté : create_order suffit à atterrir sur /reserva/<jeton>, unpaid (comme le
  // prouve déjà payment-return.spec.ts).
  await page.waitForURL(/\/reserva\//);
  const numero = await page.locator("h1").innerText();

  // Retour au panier — MÊME onglet, donc même cookie de session anonyme. getCartLines rend une
  // liste vide (create_order a vidé cart_items) : exactement le cas que ce lot corrige.
  await page.goto("/es/carrito");
  await expect(page.getByTestId("empty-cart")).toBeVisible();
  await expect(page.getByTestId("pending-orders")).toBeVisible();
  const link = page.getByTestId(/^pending-order-link-/);
  await expect(link).toHaveCount(1);

  await link.click();
  await expect(page.getByTestId("order-result")).toBeVisible();
  await expect(page.locator("h1")).toHaveText(numero);

  // Même bloc sur /pago.
  await page.goto("/es/pago");
  await expect(page.getByTestId("pending-orders")).toBeVisible();
  await expect(page.getByTestId(/^pending-order-link-/)).toHaveCount(1);
});

test("visiteur qui n'a jamais touché le panier → aucune session, aucun crash, aucun bloc affiché", async ({
  browser,
}) => {
  // Contexte NEUF : aucun cookie, donc aucune identité anonyme — le cas où
  // getPendingOrdersForViewer() doit rendre [] sans jamais planter sur `user === null`.
  const contexteVierge = await browser.newContext();
  const pageVierge = await contexteVierge.newPage();

  await pageVierge.goto("/es/carrito");
  await expect(pageVierge.getByTestId("empty-cart")).toBeVisible();
  await expect(pageVierge.getByTestId("pending-orders")).toHaveCount(0);

  await contexteVierge.close();
});
