import { test, expect, type Page } from "@playwright/test";
import { resetAvailability } from "@hifago/e2e-support";

// Feature 7 (attribution) — portée honnête (cf. plan) : aucun écran admin de consultation des
// commandes n'existe encore à ce stade du backlog (feature 9, plus loin) pour vérifier visuellement
// le referrer_partner_id/attribution_code/attribution_source capturé — cette résolution est déjà
// entièrement couverte par pgTAP (supabase/tests/database/create_order.test.sql, cas 15), pas
// re-prouvée ici. Ce spec se limite à ce qui est réellement observable côté client : un lien
// ?ref=<code> ne casse rien du parcours (réservation invité aboutit normalement, cf. correctif
// réservation invité) et aucun champ de code n'est jamais rendu nulle part dans l'interface
// (assertion négative explicite) — pas une extension artificielle juste pour « couvrir » un effet
// serveur déjà prouvé autrement.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = "2026-09-13"; // date dédiée à ce spec (cf. supabase/seed.sql), disjointe de
// 2026-09-05/07/10/12 utilisées par les autres specs.
const REFERRAL_CODE = "SEED-REFACTIVE"; // code seedé actif depuis la Tranche 1, cf. supabase/seed.sql.

async function assertNoCodeField(page: Page) {
  await expect(
    page.locator('[data-testid*="code" i], [data-testid*="attribution" i], [data-testid*="referral" i]')
  ).toHaveCount(0);
  await expect(
    page.locator('input[name*="code" i], input[placeholder*="code" i], input[placeholder*="código" i]')
  ).toHaveCount(0);
}

test("un lien ?ref=<code> actif ne casse rien du parcours invité, et aucun champ de code n'est jamais rendu", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  await page.goto(`/es?ref=${REFERRAL_CODE}`);
  await assertNoCodeField(page);

  await page.getByTestId("catalog-link-tour-lancha-guatape").click();
  await expect(page.getByTestId("product-name")).toBeVisible();
  await assertNoCodeField(page);

  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/es\/checkout/);
  await assertNoCodeField(page);

  // Parcours invité (correctif réservation invité) : aucune connexion, soumission directe — le
  // ?ref= capturé plus haut par proxy.ts est transmis en silence par CheckoutForm, jamais saisi.
  await page.locator('input[name="holder-name"]').fill("Cliente E2E Attribution");
  await page.locator('input[name="holder-phone"]').fill("+57 300 111 5555");
  await page.getByTestId("submit-order-button").click();

  await expect(page.getByTestId("order-success")).toBeVisible();
});
