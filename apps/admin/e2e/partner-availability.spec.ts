import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { webProductUrl } from "@hifago/e2e-support";

// "Kayak en el Embalse de Guatapé" — produit seedé (feature 15/16), sellable=true, rattaché à
// l'établissement de operadorPropuestas (seul profil seedé avec une capacité operator ACTIVE et
// scopée à un establishment_id précis, cf. e2e/support/login.ts). Réutilisé tel quel plutôt que
// créé à la volée : /partner/products liste les produits par partner_id, pas par établissement,
// donc "+ Actividad" (feature 2, écran admin) ne suffirait pas à le rendre visible au socio ici.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000006";
const PRODUCT_SLUG = "kayak-embalse-guatape";

test("un socio édite le calendrier de son propre produit, l'effet est visible côté public", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);

  await page.goto(`/partner/products/${PRODUCT_ID}/availability`);
  await page.waitForSelector(".fc");

  // Dernière cellule du mois affiché : toujours dans le mois suivant (padding de fin de grille),
  // donc toujours dans le futur par rapport à "aujourd'hui" — nécessaire pour que la date soit
  // sélectionnable côté public ensuite (le Calendar public désactive tout ce qui précède
  // startOfTodayInBogota(), cf. lot fuseau du 2026-08-28).
  const dayCells = page.locator(".fc-daygrid-day");
  const lastCell = dayCells.last();
  const targetDate = await lastCell.getAttribute("data-date");
  if (!targetDate) throw new Error("data-date introuvable sur la dernière cellule du calendrier");

  await lastCell.click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('input[name="capacity"]').fill("2");
  await page.getByTestId("save-availability-button").click();
  await page.waitForSelector('[role="dialog"]', { state: "hidden" });

  // Effet visible côté public : session socio effacée avant de vérifier (sinon le contexte reste
  // authentifié et pourrait masquer un problème de RLS public — même piège déjà rencontré en
  // feature 2/4).
  await context.clearCookies();
  await page.goto(webProductUrl(PRODUCT_SLUG));

  await page.locator(`[data-date="${targetDate}"]`).click();
  await expect(page.getByTestId("add-to-cart-button")).toBeEnabled();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
});

test("un autre socio (sans capacité sur cet établissement) ne peut pas éditer ce produit", async ({
  page,
  context,
}) => {
  // referentActif : capacité referrer seule, aucune capacité operator — partenaire différent de
  // celui qui possède PRODUCT_ID.
  await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);

  await page.goto(`/partner/products/${PRODUCT_ID}/availability`);
  await page.waitForSelector(".fc");

  const dayCells = page.locator(".fc-daygrid-day");
  await dayCells.last().click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('input[name="capacity"]').fill("999");
  await page.getByTestId("save-availability-button").click();

  // Refus métier normal (product_not_found, cf. feature 17) : un message d'erreur clair, jamais
  // un code brut, et le dialog reste ouvert (pas de succès silencieux).
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "No se encontró la actividad." })
  ).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
});
