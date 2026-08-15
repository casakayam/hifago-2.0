import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient, webProductUrl } from "@hifago/e2e-support";

// Mêmes établissement/partenaire réutilisés par admin-moderate-proposal.spec.ts pour un produit
// dédié à ce test (jamais un produit seedé partagé — cf. son commentaire).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("un admin ajoute (recadre), réordonne et retire des photos sur une activité", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const slug = `photos-test-${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Fotos ${suffix}` },
      price_cop: 50000,
      category: "bienestar",
      sellable: true,
      slug,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${product.id}/edit`);

  const gallery = page.getByTestId("media-gallery");
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(0);

  // Première photo — sélection ouvre le recadrage, confirmer déclenche l'upload (Route Handler +
  // add_catalog_media).
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Deuxième photo — la première doit rester marquée "Portada" (couverture = première position).
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(2, { timeout: 10000 });

  // Réordonner : déplacer la deuxième photo vers la gauche (flèche ‹) — devient la couverture.
  const items = gallery.getByTestId("media-gallery-item");
  await items.nth(1).getByTestId("media-gallery-move-left").click();
  // reorder_gallery est asynchrone — attendre que le badge "Portada" se stabilise sur la nouvelle
  // première position avant de continuer.
  await expect(items.nth(0).getByText("Portada")).toBeVisible({ timeout: 10000 });

  // Retrait direct d'une photo.
  await items.nth(0).getByTestId("media-gallery-delete").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // La galerie client (carrousel) reflète la photo restante.
  await context.clearCookies();
  await page.goto(webProductUrl(slug));
  await expect(page.getByTestId("carousel")).toBeVisible();
});
