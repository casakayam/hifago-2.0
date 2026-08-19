import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient, createActiveOperatorEstablishment } from "@hifago/e2e-support";

// Symétrique à partner-propose-photo.spec.ts (produits), étendu aux établissements le 2026-08-17
// (docs/specs/... 20260817120000_establishment_photos_socio.sql). Établissement DÉDIÉ à ce test
// (même raisonnement que partner-establishment-proposals.spec.ts, test 2 "edición") : ce test
// approuve réellement une photo, la base locale n'est pas remise à zéro entre deux exécutions e2e —
// réutiliser un établissement partagé ferait grimper sa galerie d'une photo à chaque run jusqu'à
// heurter le plafond de 6.
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("un socio propose une photo d'établissement, elle n'apparaît qu'après approbation admin", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const seedName = `Establecimiento Propuesta Foto ${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const establishmentId = await createActiveOperatorEstablishment(adminClient, PARTNER_ID, seedName);

  // --- Socio : propose une photo, jamais publiée directement (invariant socio §3f) ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/establishment/${establishmentId}/edit`);

  const socioGallery = page.getByTestId("media-gallery");
  await expect(page.getByTestId("pending-photos-proposal")).toHaveCount(0);

  await socioGallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();

  // La proposition apparaît comme "en attente" — jamais directement dans la galerie publiée, mais
  // avec un aperçu visuel de la photo envoyée (symétrique au fix produit, retour Jérôme 2026-08-17).
  await expect(page.getByTestId("pending-photos-proposal")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("pending-photos-proposal")).toContainText("1 foto propuesta");
  await expect(page.getByTestId("pending-photo-item")).toHaveCount(1);
  await expect(socioGallery.getByTestId("media-gallery-item")).toHaveCount(0);

  // --- Admin : la proposition apparaît dans la file, marquée "Fotos" ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  const row = page.locator('[data-testid^="proposal-row-"]', { hasText: seedName });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Revisar" }).click();
  await expect(page).toHaveURL(/\/admin\/proposals\/.+\?entity=establishment/);

  await expect(page.getByTestId("proposed-photos")).toBeVisible();
  await expect(page.getByTestId("proposed-photo-item")).toHaveCount(1);
  await page.getByTestId("approve-button").click();
  // Le succès n'est plus un texte inline mais un toast (docs/specs/16-notifications-toast.md) —
  // HeroUI rend chaque toast avec role="alertdialog", le message passé à toast.success(...)
  // devient son titre visible.
  await expect(page.getByRole("alertdialog").filter({ hasText: "Fotos aprobadas." })).toBeVisible();

  // --- La galerie du socio reflète maintenant la photo PUBLIÉE, plus de proposition en attente ---
  await page.goto(`/partner/establishment/${establishmentId}/edit`);
  await expect(page.getByTestId("pending-photos-proposal")).toHaveCount(0);
  await expect(page.getByTestId("media-gallery").getByTestId("media-gallery-item")).toHaveCount(1);
});
