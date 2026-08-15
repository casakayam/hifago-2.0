import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Produit seedé pour ce profil précis (operador.propuestas@hifago.test, capacité operator ACTIVE
// et scopée à un establishment_id, cf. supabase/seed.sql — Feature 15).
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000005";

test("un socio propose une modification sur sa propre activité, la voit en attente, puis la retire", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);

  await page.goto("/partner/products");

  // products_select_own (feature 15) prouvée en pratique : cette fiche est sellable=false, donc
  // invisible du catalogue public — elle n'apparaît ici que grâce à la nouvelle policy.
  const row = page.getByTestId(`product-row-${PRODUCT_ID}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("No publicada");

  await page.getByTestId(`edit-link-${PRODUCT_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/partner/products/${PRODUCT_ID}/edit`));

  // Formulaire pré-rempli avec la fiche COMPLÈTE actuelle (pas vide) — propriété de sûreté n°3.
  await expect(page.locator('input[name="name-es"]')).toHaveValue(
    "Caminata ecológica por el bosque nativo"
  );
  await expect(page.locator('input[name="price"]')).toHaveValue("60000");
  await expect(page.getByTestId("pending-proposal")).toHaveCount(0);

  const editedName = `Caminata ecológica renovada ${Date.now()}`;
  await page.locator('input[name="name-es"]').fill(editedName);
  await page.getByTestId("submit-proposal-button").click();

  const pendingBlock = page.getByTestId("pending-proposal");
  await expect(pendingBlock).toBeVisible();
  await expect(pendingBlock).toContainText(editedName);

  await page.getByTestId("withdraw-proposal-button").click();
  await expect(pendingBlock).toHaveCount(0);
});
