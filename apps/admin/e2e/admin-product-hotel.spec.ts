import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { checkboxInput, createSignedInClient, selectValue, toggleCheckbox } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 13 — type='hotel' : un hôtel n'a pas de prix propre, ses chambres (product_room_types) en
// ont chacune un. Ce test exerce la gestion des chambres et sa persistance.
//
// RÉÉCRIT le 2026-08-26. « Hotel » a été retiré du sélecteur Tipo (décision Jérôme sur le modèle
// hébergement, spec 24 §4 : un hôtel est l'ÉTABLISSEMENT, ses chambres sont des Alojamientos
// vendables) — la création d'un hôtel par le formulaire n'existe donc plus, et ce test ne peut plus
// l'emprunter. Le produit est désormais posé en fixture, et les chambres sont construites par le
// bloc d'édition (ProductHotelRoomsBlock), qui est le chemin réellement vivant : les galeries y
// sont « live » (l'id de la chambre est connu), pas « stagées ».
//
// COUVERTURE PERDUE, assumée : le mode stagé de HotelRoomsEditor (chambres et photos rattachées
// après coup dans le même clic de création) n'est plus atteignable depuis aucun écran, donc plus
// testé. Le code correspondant reste en place jusqu'au retrait complet de la branche hôtel
// (T3 de la spec 24), qui touche create_order et exige une migration de données.
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("admin gère les 2 tipos de habitación d'un hotel existant (dortoir prix simple, privada por tramos) et vérifie la persistance", async ({
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

  // Le produit hôtel est posé directement en base : le formulaire ne sait plus en créer.
  // partner_id est dérivé de l'établissement, comme le fait ProductForm lui-même.
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: establishment } = await adminClient
    .from("establishments")
    .select("id, partner_id")
    .eq("name->>es", establishmentName)
    .single();
  if (!establishment) throw new Error("e2e: établissement introuvable après création");

  const suffix = Date.now();
  const nameEs = `Hotel Guatapé ES ${suffix}`;
  const { data: created } = await adminClient
    .from("products")
    .insert({
      partner_id: establishment.partner_id,
      establishment_id: establishment.id,
      type: "hotel",
      name: { es: nameEs },
      slug: slugify(nameEs),
      // Un hôtel n'a pas de prix propre (products_price_cop_required_unless_evento l'exempte).
      price_cop: null,
      address: "Calle del Recuerdo, Guatapé",
      check_in_time: "14:00",
      check_out_time: "10:00",
      sellable: true,
    })
    .select("id")
    .single();
  if (!created) throw new Error("e2e: hotel introuvable après création");
  const productId = created.id as string;

  await page.goto(`/admin/products/${productId}/edit`);
  // Même piège d'hydratation que ProductForm pour une activité (CLAUDE.md §11.8).
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Editar hotel" })).toBeVisible();

  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEs);
  await expect(page.getByTestId("address-input")).toHaveValue("Calle del Recuerdo, Guatapé");
  await expect(page.getByTestId("check-in-input")).toHaveValue("14:00");
  await expect(page.getByTestId("check-out-input")).toHaveValue("10:00");

  // Les chambres sont construites ICI, dans le bloc à sauvegarde immédiate
  // (ProductHotelRoomsBlock) — le seul chemin qui existe encore depuis la fermeture de la création
  // d'un hôtel. Chaque chambre reçoit son id dès la sauvegarde, donc sa galerie est « live ».

  // Habitación 0 — dortoir (valeur par défaut), prix simple.
  await page.getByTestId("add-room-button").click();
  await page.getByTestId("room-name-input-0").fill("Dormitorio mixto 6 camas");
  await page.getByTestId("room-capacity-0").fill("6");
  await page.getByTestId("room-quantity-0").fill("2");
  await page.getByTestId("room-price-input-0").fill("45000");
  await page.getByTestId("room-min-qty-0").fill("1");
  await page.getByTestId("room-max-qty-0").fill("6");

  const room0 = page.getByTestId("room-0");
  // Prix par période (StayRatesEditor, testIdPrefix "room-0-") — Checkbox HeroUI v3 : cibler
  // l'input natif, jamais le wrapper (CLAUDE.md §11.5).
  await toggleCheckbox(room0.getByTestId("room-0-stay-rates-month-12"));
  await room0.getByTestId("room-0-stay-rates-season-surcharge-input").fill("15");

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

  await page.getByTestId("save-hotel-rooms-button").click();
  await expect(page.getByRole("alertdialog").filter({ hasText: "Habitaciones guardadas." })).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");

  // Foto de la habitación 0 — galerie live (l'id existe depuis la sauvegarde ci-dessus), scopée à
  // sa propre carte : plusieurs galeries coexistent sur cet écran.
  const savedRoom0 = page.getByTestId("room-0");
  await savedRoom0.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(savedRoom0.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });
  await page.reload();
  await page.waitForLoadState("networkidle");

  // Aucun bloc « Precio » au niveau hôtel — le prix vit sur les chambres (spec 13 §3).
  await expect(page.getByTestId("price-input")).toHaveCount(0);
  await expect(page.getByTestId("price-tiers-editor")).toHaveCount(0);

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
  await expect(page.getByRole("alertdialog").filter({ hasText: "Habitaciones guardadas." })).toBeVisible();
  await page.reload();

  await expect(page.getByTestId("room-capacity-0")).toHaveValue("8");
  // La preuve : la photo de la room 0 (jamais retouchée dans ce "Guardar") a survécu à l'ajout et
  // à la sauvegarde d'une chambre différente.
  await expect(page.getByTestId("room-0").getByTestId("media-gallery-item")).toHaveCount(1);
  await expect(page.getByTestId("room-2")).toBeVisible();
  await expect(page.getByTestId("room-capacity-2")).toHaveValue("1");
  await expect(page.getByTestId("room-price-input-2")).toHaveValue("35000");
});
