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

  // Navigation directe (pas via /partner/products puis clic) : `/partner/products` est désormais
  // paginé (12/page, tri created_at desc) — cette fiche seedée le 2026-08-13 est l'une des plus
  // anciennes du partenaire et n'est plus sur la 1ʳᵉ page parmi les ~90 accumulées sur cette
  // instance locale. La visibilité RLS (products_select_own, fiche sellable=false quand même
  // visible à son propriétaire) reste couverte ailleurs (pgTAP product_proposals.test.sql) — pas
  // le sujet de CE test, qui porte sur la parité de champs de la proposition d'édition.
  await page.goto(`/partner/products/${PRODUCT_ID}/edit`);
  await page.waitForLoadState("networkidle");

  // Formulaire pré-rempli avec la fiche COMPLÈTE actuelle (pas vide) — propriété de sûreté n°3.
  // LocalizedTextField (spec 15 bis, 2026-08-17 — ce formulaire réutilise désormais exactement les
  // mêmes briques que ProductForm/ProductTypeFields, plus l'ancien name-es/name-en séparé).
  await expect(page.locator('input[name="nombre"]')).toHaveValue(
    "Caminata ecológica por el bosque nativo"
  );
  await expect(page.getByTestId("price-input")).toHaveValue("60000");
  await expect(page.getByTestId("pending-proposal")).toHaveCount(0);

  const editedName = `Caminata ecológica renovada ${Date.now()}`;
  await page.locator('input[name="nombre"]').fill(editedName);
  await page.getByTestId("submit-proposal-button").click();

  const pendingBlock = page.getByTestId("pending-proposal");
  await expect(pendingBlock).toBeVisible();
  await expect(pendingBlock).toContainText(editedName);

  await page.getByTestId("withdraw-proposal-button").click();
  await expect(pendingBlock).toHaveCount(0);
});
