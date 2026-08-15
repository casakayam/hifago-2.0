import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

test("admin crée une etiqueta depuis /admin/tags, puis la supprime", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const tagLabel = `Etiqueta E2E ${Date.now()}`;
  await page.goto("/admin/tags");

  await page.getByTestId("new-tag-input").fill(tagLabel);
  await page.getByTestId("create-tag-button").click();

  const row = page.locator("tr", { hasText: tagLabel });
  await expect(row).toBeVisible();
  await expect(row).toContainText("0");

  await row.getByText("Eliminar").click();
  await page.getByTestId(/^confirm-delete-tag-/).click();

  await expect(page.locator("tr", { hasText: tagLabel })).toHaveCount(0);
});
