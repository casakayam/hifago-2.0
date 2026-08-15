import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { webProductUrl } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

test("admin publie puis dépublie une activité, visible/invisible côté public en conséquence", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Établissement + activité dédiés à ce test — sellable=false à la création (feature 2).
  const establishmentName = `Establecimiento E2E Publish ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  await page.locator('input[name="nombre"]').fill(establishmentName);
  const partnerSearchPublish = page.getByTestId("partner-search");
  await partnerSearchPublish.click();
  await partnerSearchPublish.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await page.getByTestId("create-establishment-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const row = page.locator("tr", { hasText: establishmentName });
  await row.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);

  const productName = `Actividad E2E Publish ${Date.now()}`;
  await page.locator('input[name="nombre"]').fill(productName);
  await page.locator('input[name="price"]').fill("40000");
  await page.getByTestId("create-product-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  await row.getByRole("link", { name: /actividades/ }).click();
  await page.getByRole("link", { name: productName }).click();
  await expect(page).toHaveURL(/\/admin\/products\/.+\/edit$/);
  const editUrl = page.url();

  const statusBadge = page.getByTestId("product-status-badge");
  const toggleButton = page.getByTestId("toggle-sellable-button");
  await expect(statusBadge).toHaveText("No vendible");

  // Publier -----------------------------------------------------------------------------------
  await toggleButton.click();
  await expect(statusBadge).toHaveText("Vendible");

  const slug = slugify(productName);
  await context.clearCookies();
  const publishedResponse = await page.goto(webProductUrl(slug));
  expect(publishedResponse?.status()).toBe(200);
  await expect(page.getByText(productName)).toBeVisible();

  // Dépublier — retour en admin (cookies effacés ci-dessus) -----------------------------------
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(editUrl);
  await expect(statusBadge).toHaveText("Vendible");

  await toggleButton.click();
  await expect(statusBadge).toHaveText("No vendible");

  await context.clearCookies();
  const unpublishedResponse = await page.goto(webProductUrl(slug));
  expect(unpublishedResponse?.status()).toBe(404);
});
