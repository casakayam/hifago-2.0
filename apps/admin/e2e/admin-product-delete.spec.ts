import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

// Mêmes établissement/partenaire réutilisés par admin-product-photos.spec.ts pour un produit
// dédié à ce test.
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

async function createDedicatedProduct(suffix: number) {
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Delete ${suffix}` },
      price_cop: 40000,
      sellable: true,
      slug: `delete-test-${suffix}`,
    })
    .select("id")
    .single();
  if (error || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${error?.message}`);
  }
  return { adminClient, productId: product.id as string };
}

test("admin supprime une activité jamais commandée", async ({ page, context }) => {
  const { productId } = await createDedicatedProduct(Date.now());

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}`);

  await page.getByTestId("delete-product-button").click();
  await page.getByTestId("confirm-delete-product-button").click();

  await expect(page).toHaveURL(/\/admin\/products$/);

  const response = await page.goto(`/admin/products/${productId}`);
  expect(response?.status()).toBe(404);
});

test("admin ne peut pas supprimer une activité déjà commandée — renvoyé vers la dépublication", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const { adminClient, productId } = await createDedicatedProduct(suffix);
  const date = "2026-10-20"; // date dédiée à ce test, jamais réutilisée par un autre scénario

  const { error: availError } = await adminClient.rpc("set_product_availability", {
    p_product_id: productId,
    p_date: date,
    p_capacity: 5,
  });
  if (availError) {
    throw new Error(`e2e setup: set_product_availability a échoué : ${availError.message}`);
  }

  const { data: orderResult, error: orderError } = await adminClient.rpc("create_order", {
    p_lines: [{ product_id: productId, date, qty: 1 }],
    p_holder_name: `Cliente E2E Delete ${suffix}`,
  });
  const created = orderResult as { ok: boolean; order_id?: string } | null;
  if (orderError || !created?.ok) {
    throw new Error(`e2e setup: create_order a échoué : ${orderError?.message ?? JSON.stringify(created)}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}`);

  await page.getByTestId("delete-product-button").click();
  await page.getByTestId("confirm-delete-product-button").click();

  await expect(page.getByTestId("delete-product-already-ordered")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/products/${productId}$`));

  // Le produit existe toujours en base, malgré la tentative.
  const { data: stillThere } = await adminClient
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  expect(stillThere).not.toBeNull();
});
