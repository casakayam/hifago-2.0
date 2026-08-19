import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

// Même établissement/partenaire que le produit seedé de partner-propose-edit.spec.ts
// (operador.propuestas@hifago.test, capacité operator ACTIVE, cf. supabase/seed.sql — Feature 15)
// — mais un produit DÉDIÉ à ce test, pas le produit seedé partagé : ce test approuve réellement
// une photo jusqu'à publication, et la base locale n'est pas remise à zéro entre deux exécutions
// e2e (même raisonnement que admin-moderate-proposal.spec.ts) — réutiliser le produit seedé
// ferait grimper sa galerie d'une photo à chaque run jusqu'à heurter le plafond de 6.
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("un socio propose une photo, elle n'apparaît qu'après approbation admin", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Propuesta Foto ${suffix}` },
      price_cop: 45000,
      category: "bienestar",
      sellable: false,
      slug: `propose-photo-test-${suffix}`,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }
  const PRODUCT_ID = product.id;

  // --- Socio : propose une photo, jamais publiée directement (invariant socio §3f) ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/products/${PRODUCT_ID}/edit`);

  const socioGallery = page.getByTestId("media-gallery");
  await expect(page.getByTestId("pending-photos-proposal")).toHaveCount(0);

  await socioGallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();

  // La proposition apparaît comme "en attente" — jamais directement dans la galerie publiée, mais
  // avec un aperçu visuel de la photo envoyée (retour Jérôme 2026-08-17 : le module n'affichait
  // rien après l'ajout, juste un compteur texte).
  await expect(page.getByTestId("pending-photos-proposal")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("pending-photos-proposal")).toContainText("1 foto propuesta");
  await expect(page.getByTestId("pending-photo-item")).toHaveCount(1);
  await expect(socioGallery.getByTestId("media-gallery-item")).toHaveCount(0);

  // --- Admin : la proposition apparaît dans la file, marquée "Fotos" ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  // Filtre par le nom du produit (unique par run, cf. suffix) — pas juste "Fotos" générique, pour
  // ne pas ramasser un reliquat d'un run précédent laissé pending par un échec (base locale non
  // remise à zéro entre deux exécutions e2e).
  const row = page.locator('[data-testid^="proposal-row-"]', {
    hasText: `Actividad Propuesta Foto ${suffix}`,
  });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Revisar" }).click();
  await expect(page).toHaveURL(/\/admin\/proposals\/.+/);

  await expect(page.getByTestId("proposed-photos")).toBeVisible();
  await expect(page.getByTestId("proposed-photo-item")).toHaveCount(1);
  await page.getByTestId("approve-button").click();
  // Le succès n'est plus un texte inline mais un toast (docs/specs/16-notifications-toast.md) —
  // HeroUI rend chaque toast avec role="alertdialog", le message passé à toast.success(...)
  // devient son titre visible.
  await expect(page.getByRole("alertdialog").filter({ hasText: "Fotos aprobadas." })).toBeVisible();

  // --- La galerie du socio reflète maintenant la photo PUBLIÉE, plus de proposition en attente ---
  await page.goto(`/partner/products/${PRODUCT_ID}/edit`);
  await expect(page.getByTestId("pending-photos-proposal")).toHaveCount(0);
  await expect(page.getByTestId("media-gallery").getByTestId("media-gallery-item")).toHaveCount(1);
});
