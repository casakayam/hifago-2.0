import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature "Mi cuenta" — écran de réglages du compte socio (nom/WhatsApp individuels sur
// partner_accounts, jamais partagés avec un éventuel collègue du même partenaire, cf. migration
// 20260819100000). Un seul test chemin heureux (CLAUDE.md §6.5) : email/mot de passe ne sont pas
// couverts en e2e, aucun précédent dans le repo pour tester les flux email Supabase Auth
// (ResetPasswordForm/ForgotPasswordForm n'ont eux-mêmes aucun test e2e).
test("un socio actualiza su nombre y WhatsApp, la persistencia se mantiene, luego cierra sesión", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  await page.goto("/partner/account");
  await page.waitForLoadState("networkidle");

  const newName = `Referente Actif ${Date.now()}`;
  await page.getByTestId("profile-full-name-input").fill(newName);
  await page.getByTestId("profile-phone-input").fill("+57 300 1234567");
  await page.getByTestId("save-profile-button").click();

  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Perfil actualizado." })
  ).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("profile-full-name-input")).toHaveValue(newName);
  await expect(page.getByTestId("profile-phone-input")).toHaveValue("+57 300 1234567");

  // Cuenta de pago (spec 19 §10 point 7, self-service ajouté le 2026-08-25) : "referent.actif" a
  // une capacité referrer, donc le bloc doit être visible. Bouton grisé tant qu'aucune saisie
  // n'a été faite (même contrat que save-profile-button).
  const payoutInput = page.getByTestId("payout-mercadopago-account-input");
  await expect(payoutInput).toBeVisible();
  const savePayoutButton = page.getByTestId("save-payout-account-button");
  await expect(savePayoutButton).toBeDisabled();

  const mercadopagoAccount = `referente-${Date.now()}@mp.test`;
  await payoutInput.fill(mercadopagoAccount);
  await expect(savePayoutButton).toBeEnabled();
  await savePayoutButton.click();

  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Cuenta de pago actualizada." })
  ).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("payout-mercadopago-account-input")).toHaveValue(mercadopagoAccount);

  await page.getByTestId("logout-button-page").click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/partner");
  await expect(page).toHaveURL(/\/login/);
});
