import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

// Mêmes établissement/partenaire réutilisés par admin-product-photos.spec.ts pour un produit
// dédié à ce test (jamais un produit ou un tag seedé partagé).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

test("admin assigne puis retire un tag sur une activité depuis l'écran d'édition", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const slug = `tags-test-${suffix}`;
  const tagLabel = `Etiqueta Producto E2E ${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Tags ${suffix}` },
      price_cop: 50000,
      sellable: false,
      slug,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  const { data: tag, error: tagError } = await adminClient
    .from("catalog_tags")
    .insert({ label: { es: tagLabel }, slug: `${slug}-tag` })
    .select("id")
    .single();
  if (tagError || !tag) {
    throw new Error(`e2e setup: création du tag a échoué : ${tagError?.message}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${product.id}/edit`);

  // SearchableCombobox-like : taper une requête avant de cliquer (piège CLAUDE.md §11.7), pas un
  // clic à l'aveugle sur la première option d'une liste non filtrée.
  const tagsInput = page.getByTestId("tags-multiselect");
  await tagsInput.click();
  await tagsInput.fill(tagLabel);
  await page.getByRole("option", { name: tagLabel }).click();

  await expect(
    page.getByTestId("tags-multiselect-selected").getByText(tagLabel),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await adminClient
        .from("product_tag_assignments")
        .select("tag_id")
        .eq("product_id", product.id);
      return data?.length ?? 0;
    })
    .toBe(1);

  await page
    .getByTestId("tags-multiselect-selected")
    .getByRole("button", { name: `Quitar ${tagLabel}` })
    .click();

  await expect(
    page.getByTestId("tags-multiselect-selected").getByText(tagLabel),
  ).toHaveCount(0);

  await expect
    .poll(async () => {
      const { data } = await adminClient
        .from("product_tag_assignments")
        .select("tag_id")
        .eq("product_id", product.id);
      return data?.length ?? 0;
    })
    .toBe(0);
});

test("admin crée un tag à la volée depuis le multi-select, sans passer par /admin/tags", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const slug = `tags-create-inline-${suffix}`;
  const newTagLabel = `Etiqueta Inline E2E ${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Tags Inline ${suffix}` },
      price_cop: 50000,
      sellable: false,
      slug,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${product.id}/edit`);

  const tagsInput = page.getByTestId("tags-multiselect");
  await tagsInput.click();
  await tagsInput.fill(newTagLabel);
  await page.getByRole("option", { name: `+ Crear "${newTagLabel}"` }).click();

  await expect(
    page.getByTestId("tags-multiselect-selected").getByText(newTagLabel),
  ).toBeVisible({ timeout: 10000 });

  // Le tag existe réellement en base (pas seulement dans l'état local du composant) et est bien
  // assigné à cette activité.
  const { data: createdTag } = await adminClient
    .from("catalog_tags")
    .select("id")
    .eq("label->>es", newTagLabel)
    .single();
  expect(createdTag).not.toBeNull();

  const { data: assignments } = await adminClient
    .from("product_tag_assignments")
    .select("tag_id")
    .eq("product_id", product.id);
  expect(assignments).toEqual([{ tag_id: createdTag?.id }]);
});
