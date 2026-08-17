import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient, webProductUrl } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 14 — active type='transport' dans le même ProductForm que l'activité/l'alojamiento/l'hôtel
// (specs 11/12/13) : nom/lieu/tags/photos/prix-tramos réutilisent le mécanisme existant (couvert
// par admin-product-create.spec.ts/admin-product-lodging.spec.ts), ce test se concentre sur ce qui
// diverge — un trajet de transport n'a ni check-in/check-out ni capacité produit (contrairement à
// l'alojamiento/l'hôtel), le prix par tramos couvrant seul les paliers de capacité de véhicule
// (« hasta 4/7 pers. » de la V1) — tout en exerçant le chemin complet création → édition, cf.
// CLAUDE.md §6.5.
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("admin crée un transport (prix par tramos de capacidad de vehículo), l'édite et vérifie la persistance", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const establishmentName = `Establecimiento E2E Transporte ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  await page.locator('input[name="nombre"]').fill(establishmentName);
  const partnerSearch = page.getByTestId("partner-search");
  await partnerSearch.click();
  await partnerSearch.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await page.getByTestId("create-establishment-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const row = page.locator("tr", { hasText: establishmentName });
  await row.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);
  // Même piège d'hydratation que ProductForm pour une activité (CLAUDE.md §11.8) — le composant
  // est partagé, le risque est identique.
  await page.waitForLoadState("networkidle");

  await page.getByTestId("type-select").click();
  await page.getByRole("option", { name: "Transporte" }).click();

  const suffix = Date.now();
  const nameEs = `Privado aeropuerto Guatapé ES ${suffix}`;
  await page.locator('input[name="nombre"]').fill(nameEs);

  // Lieu (réutilisation du parcours activité/alojamiento/hôtel) — opcional, point de départ.
  await page.getByTestId("address-input").fill("Aeropuerto José María Córdova, Rionegro");
  await page.getByTestId("lat-input").fill("6.1645");
  await page.getByTestId("lon-input").fill("-75.4231");

  // Foto (opcional, même staging que les autres types).
  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Precio por tramos de capacidad de vehículo (spec 14 §3 — un producto con tramos en lugar de las
  // fichas separadas "hasta 4 pers."/"hasta 7 pers." de la V1) + bornes de cantidad.
  await page.getByTestId("price-mode-toggle").click();
  await page.getByTestId("price-tier-min-0").fill("1");
  await page.getByTestId("price-tier-max-0").fill("4");
  await page.getByTestId("price-tier-price-0").fill("210000");
  await page.getByTestId("add-price-tier-button").click();
  await page.getByTestId("price-tier-min-1").fill("5");
  await page.getByTestId("price-tier-max-1").fill("7");
  await page.getByTestId("price-tier-price-1").fill("362000");
  await page.getByTestId("min-qty-input").fill("1");
  await page.getByTestId("max-qty-input").fill("7");

  // Pas de check-in/check-out ni de capacité produit pour un transport (schedule='date' en V1, le
  // transporteur dispatche son propre parc — même absence que pour une activité, spec 14 §gating).
  await expect(page.getByTestId("check-in-input")).toHaveCount(0);
  await expect(page.getByTestId("capacity-input")).toHaveCount(0);

  await page.getByTestId("create-product-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(row).toContainText("1 actividades");

  // sellable=false à la création — même garde-fou que pour les autres types.
  await context.clearCookies();
  const slug = slugify(nameEs);
  const publicResponse = await page.goto(webProductUrl(slug));
  expect(publicResponse?.status()).toBe(404);

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: created } = await adminClient
    .from("products")
    .select("id, type")
    .eq("slug", slug)
    .single();
  if (!created) throw new Error("e2e: transport introuvable après création");
  expect(created.type).toBe("transport");
  const productId = created.id as string;

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByRole("heading", { name: "Editar transporte" })).toBeVisible();

  // Contrairement aux chambres d'hôtel (table enfant, bloc édition séparé), le prix par tramos est
  // une simple colonne products : préremplie directement dans ProductForm, aucun bloc séparé.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEs);
  await expect(page.getByTestId("address-input")).toHaveValue("Aeropuerto José María Córdova, Rionegro");
  await expect(page.getByTestId("price-tiers-editor")).toBeVisible();
  await expect(page.getByTestId("price-tier-price-0")).toHaveValue("210000");
  await expect(page.getByTestId("price-tier-price-1")).toHaveValue("362000");
  await expect(page.getByTestId("min-qty-input")).toHaveValue("1");
  await expect(page.getByTestId("max-qty-input")).toHaveValue("7");
  await expect(page.getByTestId("check-in-input")).toHaveCount(0);
  await expect(page.getByTestId("capacity-input")).toHaveCount(0);

  // Édite directement dans le même submit (pas de bouton de sauvegarde séparé pour ces champs).
  await page.getByTestId("price-tier-price-1").fill("380000");
  await page.getByTestId("save-product-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments\/[0-9a-f-]{36}$/);

  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByTestId("price-tier-price-1")).toHaveValue("380000");
});
