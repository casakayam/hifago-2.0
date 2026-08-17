import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { checkboxInput, createSignedInClient, selectValue, toggleCheckbox, webProductUrl } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 13 — active type='hotel' dans le même ProductForm que l'activité/l'alojamiento (specs
// 11/12) : nom/lieu/photos/tags/check-in-check-out réutilisent le mécanisme existant (couvert par
// admin-product-create.spec.ts/admin-product-lodging.spec.ts), ce test se concentre sur ce qui
// diverge — un hôtel n'a pas de prix propre, ses chambres (product_room_types) en ont chacune un —
// tout en exerçant le chemin complet création → édition, cf. CLAUDE.md §6.5.
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("admin crée un hotel avec 2 tipos de habitación (dortoir prix simple, privada por tramos), l'édite et vérifie la persistance", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const establishmentName = `Establecimiento E2E Hotel ${Date.now()}`;
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
  await page.getByRole("option", { name: "Hotel" }).click();

  const suffix = Date.now();
  const nameEs = `Hotel Guatapé ES ${suffix}`;
  await page.locator('input[name="nombre"]').fill(nameEs);

  // Lieu (réutilisation du parcours activité/alojamiento) — opcional.
  await page.getByTestId("address-input").fill("Calle del Recuerdo, Guatapé");
  await page.getByTestId("lat-input").fill("6.2331");
  await page.getByTestId("lon-input").fill("-75.1601");

  // Foto (opcional, même staging que l'activité/l'alojamiento).
  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Aucun bloc "Precio" au niveau hôtel — le prix vit sur les chambres (spec 13 §3).
  await expect(page.getByTestId("price-input")).toHaveCount(0);
  await expect(page.getByTestId("price-tiers-editor")).toHaveCount(0);

  // Check-in/check-out (réutilisés de la spec 12) — pas de champ capacité au niveau hôtel.
  await page.getByTestId("check-in-input").fill("14:00");
  await page.getByTestId("check-out-input").fill("10:00");
  await expect(page.getByTestId("capacity-input")).toHaveCount(0);

  // Habitación 0 — dortoir (valeur par défaut), prix simple, une foto y un prix par período.
  await page.getByTestId("add-room-button").click();
  await page.getByTestId("room-name-input-0").fill("Dormitorio mixto 6 camas");
  await page.getByTestId("room-capacity-0").fill("6");
  await page.getByTestId("room-quantity-0").fill("2");
  await page.getByTestId("room-price-input-0").fill("45000");
  await page.getByTestId("room-min-qty-0").fill("1");
  await page.getByTestId("room-max-qty-0").fill("6");

  const room0 = page.getByTestId("room-0");

  // Prix par período de la habitación 0 (StayRatesEditor réutilisé de la spec 12, testIdPrefix
  // "room-0-") — Checkbox HeroUI v3 : cibler l'input natif, jamais le wrapper (CLAUDE.md §11.5).
  // Avant la foto, volontairement : le clic forcé sur la checkbox ne doit pas courir contre le
  // redimensionnement du bloc Fotos causé par l'apparition de la vignette juste en dessous.
  await toggleCheckbox(room0.getByTestId("room-0-stay-rates-month-12"));
  await room0.getByTestId("room-0-stay-rates-season-surcharge-input").fill("15");

  // Foto de la habitación 0 — stagée (pas encore d'id), même mécanique que la foto de l'hôtel mais
  // scopée à sa propre carte (data-testid="room-0") : plusieurs galeries coexistent sur cet écran.
  await room0.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(room0.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Habitación 1 — chambre privée, prix par tramos.
  await page.getByTestId("add-room-button").click();
  await page.getByTestId("room-kind-1").click();
  await page.getByRole("option", { name: "Habitación privada" }).click();
  await page.getByTestId("room-name-input-1").fill("Habitación doble");
  await page.getByTestId("room-capacity-1").fill("2");
  await page.getByTestId("room-price-mode-toggle-1").click();
  await page.getByTestId("room-price-tier-min-1-0").fill("1");
  await page.getByTestId("room-price-tier-max-1-0").fill("2");
  await page.getByTestId("room-price-tier-price-1-0").fill("120000");

  await page.getByTestId("create-product-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(row).toContainText("1 actividades");

  // sellable=false à la création — même garde-fou que pour une activité/un alojamiento.
  await context.clearCookies();
  const slug = slugify(nameEs);
  const publicResponse = await page.goto(webProductUrl(slug));
  expect(publicResponse?.status()).toBe(404);

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: created } = await adminClient.from("products").select("id").eq("slug", slug).single();
  if (!created) throw new Error("e2e: hotel introuvable après création");
  const productId = created.id as string;

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByRole("heading", { name: "Editar hotel" })).toBeVisible();

  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEs);
  await expect(page.getByTestId("address-input")).toHaveValue("Calle del Recuerdo, Guatapé");
  await expect(page.getByTestId("check-in-input")).toHaveValue("14:00");
  await expect(page.getByTestId("check-out-input")).toHaveValue("10:00");

  // Les chambres vivent dans un bloc séparé à sauvegarde immédiate (ProductHotelRoomsBlock),
  // contrairement à check-in/check-out qui sont de simples colonnes products (spec 13 §0).
  await expect(page.getByTestId("room-capacity-0")).toHaveValue("6");
  await expect(page.getByTestId("room-quantity-0")).toHaveValue("2");
  await expect(page.getByTestId("room-price-input-0")).toHaveValue("45000");
  await expect(page.getByTestId("room-min-qty-0")).toHaveValue("1");
  await expect(page.getByTestId("room-max-qty-0")).toHaveValue("6");
  // selectValue() scope l'assertion à la valeur affichée, pas au <select> natif caché qui liste
  // toujours le texte de toutes les options possibles (CLAUDE.md §11.3).
  await expect(selectValue(page.getByTestId("room-kind-0"))).toContainText("Dormitorio");
  await expect(page.getByTestId("room-capacity-1")).toHaveValue("2");
  await expect(selectValue(page.getByTestId("room-kind-1"))).toContainText("Habitación privada");
  await expect(page.getByTestId("room-price-tiers-editor-1")).toBeVisible();
  await expect(page.getByTestId("room-price-tier-price-1-0")).toHaveValue("120000");

  // Foto et prix par período de la habitación 0 : persistés (galerie live, l'id de la chambre est
  // maintenant connu — plus le mode "stagé" de la création).
  const editRoom0 = page.getByTestId("room-0");
  await expect(editRoom0.getByTestId("media-gallery-item")).toHaveCount(1);
  await expect(checkboxInput(editRoom0.getByTestId("room-0-stay-rates-month-12"))).toBeChecked();
  await expect(editRoom0.getByTestId("room-0-stay-rates-season-surcharge-input")).toHaveValue("15");

  // Ajoute une 3e habitación PENDANT l'édition (pas encore d'id) puis sauvegarde — exerce le chemin
  // upsert : room 0/1 mis à jour en place (id stable), room 2 insérée. C'est le scénario exact que
  // le passage delete-all-reinsert → upsert corrige : avant ce correctif, sauvegarder ici aurait
  // supprimé et recréé TOUTES les chambres, effaçant en cascade la photo de la room 0 ci-dessus.
  await page.getByTestId("add-room-button").click();
  await page.getByTestId("room-name-input-2").fill("Habitación individual");
  await page.getByTestId("room-capacity-2").fill("1");
  await page.getByTestId("room-price-input-2").fill("35000");

  await page.getByTestId("room-capacity-0").fill("8");
  await page.getByTestId("save-hotel-rooms-button").click();
  await expect(page.getByText("Guardado.")).toBeVisible();
  await page.reload();

  await expect(page.getByTestId("room-capacity-0")).toHaveValue("8");
  // La preuve : la photo de la room 0 (jamais retouchée dans ce "Guardar") a survécu à l'ajout et
  // à la sauvegarde d'une chambre différente.
  await expect(page.getByTestId("room-0").getByTestId("media-gallery-item")).toHaveCount(1);
  await expect(page.getByTestId("room-2")).toBeVisible();
  await expect(page.getByTestId("room-capacity-2")).toHaveValue("1");
  await expect(page.getByTestId("room-price-input-2")).toHaveValue("35000");
});
