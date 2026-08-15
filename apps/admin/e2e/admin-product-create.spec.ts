import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { webProductUrl } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

test("admin crée une activité, le compteur passe à 1, l'activité non publiée reste invisible côté public", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Établissement dédié à ce test (garantit un départ à 0 activité) — un établissement partagé
  // avec un autre test pourrait déjà en avoir. Réutilise le flux feature 1, déjà prouvé.
  const establishmentName = `Establecimiento E2E Producto ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  await page.locator('input[name="nombre"]').fill(establishmentName);
  const partnerSearchCreate = page.getByTestId("partner-search");
  await partnerSearchCreate.click();
  await partnerSearchCreate.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await page.getByTestId("create-establishment-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const row = page.locator("tr", { hasText: establishmentName });
  await expect(row).toContainText("0 actividades");

  await row.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);

  // Établissement déjà pré-rempli via ?establishment=<id> (cf. plan) — pas besoin de le
  // ressélectionner dans le formulaire.
  const productName = `Actividad E2E ${Date.now()}`;
  await page.locator('input[name="nombre"]').fill(productName);
  await page.locator('input[name="price"]').fill("50000");
  await page.getByTestId("create-product-button").click();

  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(row).toContainText("1 actividades");

  // sellable=false à la création (feature 4 publiera plus tard) : la fiche publique de
  // Checkpoint B ne doit pas l'exposer tant qu'elle n'est pas publiée. Session admin effacée
  // avant cette vérification : le contexte reste sinon authentifié admin, qui voit tout via RLS
  // (products_select_public autorise aussi is_admin()) — un faux positif sans ce nettoyage.
  await context.clearCookies();
  const slug = slugify(productName);
  const response = await page.goto(webProductUrl(slug));
  expect(response?.status()).toBe(404);
});
