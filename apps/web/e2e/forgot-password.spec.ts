import { test, expect } from "@playwright/test";
import { createTestUser, latestCallbackLink } from "@hifago/e2e-support";

// Calqué sur apps/admin/e2e/auth-connection-complete.spec.ts (test "mot de passe oublié : email
// générique, lien réel, reconnexion avec le nouveau mot de passe") — même contrat, adapté aux
// routes préfixées par locale d'apps/web. Lit le VRAI email envoyé par Supabase Auth via Mailpit
// local (latestCallbackLink) plutôt que de simuler le clic — preuve bout-en-bout réelle.
test("un client oublie son mot de passe, reçoit un vrai lien, le change, et se reconnecte avec le nouveau", async ({
  page,
  request,
  context,
}) => {
  const email = `e2e-forgot-web-${Date.now()}@test.local`;
  await createTestUser(email, "OldPassword123!");

  await page.goto("/es/entrar");
  await page.getByTestId("forgot-password-link").click();
  await page.waitForURL(/\/es\/olvide-password/);

  await page.locator('input[name="email"]').fill(email);
  await page.getByTestId("forgot-password-submit").click();
  await expect(page.getByTestId("forgot-password-sent")).toBeVisible();

  const resetLink = await latestCallbackLink(request, email);
  await page.goto(resetLink);
  await page.waitForURL(/\/es\/restablecer-password/);

  await page.locator('input[name="password"]').fill("NewPassword456!");
  await page.locator('input[name="confirm-password"]').fill("NewPassword456!");
  await page.getByTestId("reset-password-submit").click();
  await page.waitForURL(/\/es\/?$/);

  await context.clearCookies();
  await page.goto("/es/entrar");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("NewPassword456!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/es\/?$/);
});
