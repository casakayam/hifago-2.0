import { test, expect, type Page } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  resetAvailability,
  getAvailability,
  countOrderLines,
  mockMercadoPagoCheckout,
} from "@hifago/e2e-support";

// Le test le plus important de ce jalon (cf. plan Checkpoint B) : jusqu'ici l'invariant
// anti-survente n'était prouvé qu'au niveau pg direct (tests/concurrency/
// reserve_order_line.concurrency.mjs, Tranche 3). Ce test le prouve à travers toute la pile —
// navigateur → Next.js → supabase-js → RPC — la raison documentée du choix de Playwright plutôt
// que Cypress (hifago/CLAUDE.md §6).
//
// Feature 6 : le bouton unique "Reservar" (Checkpoint B) a disparu. La barrière anti-survente
// vit maintenant exclusivement dans create_order, appelée uniquement depuis /checkout au clic
// "Validar pedido" — reserve_order_line est d'ailleurs supprimée par la migration
// 20260813243000_create_order_rpc.sql. Chaque contexte doit donc désormais aller jusqu'au bout
// du parcours panier (catalogue → produit → ajout au panier → checkout → formulaire rempli) et
// c'est le clic final sur submit-order-button qui doit partir en concurrence réelle entre tous
// les contextes, pas seulement le clic "Añadir al carrito" (purement local, sans aucun aller-
// retour réseau — le faire concourir ne prouverait plus rien).
const PRODUCT_URL = "/es/products/tour-lancha-guatape";
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001";
const LAST_SPOT_DATE = "2026-09-10"; // capacity=1 — cf. supabase/seed.sql

const ACCOUNTS = [
  SEEDED_ACCOUNTS.referentActif,
  SEEDED_ACCOUNTS.operateurActif,
  SEEDED_ACCOUNTS.referentSuspendu,
];

test("N BrowserContext isolés, chacun jusqu'à la validation finale du panier ciblant la même place à cupo=1 → exactement un succès", async ({
  browser,
}) => {
  await resetAvailability(PRODUCT_ID, LAST_SPOT_DATE, { capacity: 1, booked: 0 });

  const pages: { page: Page; redirectUrl: string }[] = [];
  for (const email of ACCOUNTS) {
    const context = await browser.newContext();
    await loginAs(context, email, SEEDED_PASSWORD);
    const page = await context.newPage();

    await page.goto(PRODUCT_URL);
    // Spec 19 §0 Tranche 1 : le gagnant enchaînera automatiquement le paiement Mercado Pago
    // (redirection réelle) — seul l'appel SDK externe est mocké, sur chaque contexte (on ne sait
    // pas encore lequel gagnera). Sans effet sur les perdants, qui n'atteignent jamais ce point.
    const { redirectUrl } = await mockMercadoPagoCheckout(page);
    await page.locator(`[data-date="${LAST_SPOT_DATE}"]`).click();
    await page.getByTestId("add-to-cart-button").click();
    await expect(page.getByTestId("added-to-cart")).toBeVisible();

    await page.getByTestId("go-to-checkout-link").click();
    await page.locator('input[name="holder-name"]').fill(`Cliente Concurrencia ${email}`);
    await page.locator('input[name="holder-phone"]').fill(`+57 300 000 ${pages.length}000`);
    await page.locator('input[name="holder-email"]').fill(email);
    // Formulaire rempli, prêt à valider — mais on ne clique PAS encore ici : tous les clics de
    // validation doivent partir dans le même tick (Promise.all ci-dessous), pas au fil d'une
    // boucle séquentielle, pour maximiser le chevauchement réel des appels create_order.
    pages.push({ page, redirectUrl });
  }

  await Promise.all(pages.map(({ page }) => page.getByTestId("submit-order-button").click()));

  // order-success n'est qu'un état transitoire côté gagnant — la redirection Mercado Pago (mockée)
  // peut déjà l'avoir remplacé avant que Playwright ne l'observe (race constatée en testant sur le
  // parcours non-concurrent). Course fiable : "checkout-error visible" (perdant) contre "redirigé
  // vers l'URL mockée" (gagnant), jamais une lecture de order-success.
  const outcomes = await Promise.all(
    pages.map(async ({ page, redirectUrl }) => {
      const error = page.getByTestId("checkout-error");
      const result = await Promise.race([
        error.waitFor({ state: "visible" }).then(() => "full" as const),
        page.waitForURL(redirectUrl).then(() => "ok" as const),
      ]);
      return result;
    })
  );

  expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome === "full")).toHaveLength(ACCOUNTS.length - 1);

  // Preuve base directe : aucune survente malgré N validations concurrentes — exactement 1 ligne
  // de commande écrite, et booked jamais au-delà de capacity.
  const { lines, qty } = await countOrderLines(PRODUCT_ID, LAST_SPOT_DATE);
  expect(lines).toBe(1);
  expect(qty).toBe(1);
  const availability = await getAvailability(PRODUCT_ID, LAST_SPOT_DATE);
  expect(availability?.booked).toBe(1);
  expect(availability?.booked).toBeLessThanOrEqual(availability?.capacity ?? 0);

  await Promise.all(pages.map(({ page }) => page.context().close()));
});
