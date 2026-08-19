import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  resetAvailability,
  setBooked,
  getAvailability,
  getEstablishmentName,
  countOrdersByPhone,
  getOrderLinesForPhone,
  mockMercadoPagoCheckout,
} from "@hifago/e2e-support";

// Feature 6 : "Client : composer un panier à plusieurs lignes sur une même commande
// (multi-établissement)". Le panier (lib/cart/CartContext.tsx) est un état React en mémoire
// monté au niveau du layout (public)/[locale] : il survit à une navigation CLIENT (composant
// Link de @/i18n/navigation) entre deux fiches produit, mais se réinitialise sur toute
// navigation "dure" (page.goto). Chaque étape qui doit préserver le panier clique donc un vrai
// lien plutôt que d'appeler page.goto().
const TOUR_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape (établissement A)
const TOUR_SLUG = "tour-lancha-guatape";
const TOUR_DATE = "2026-09-07";

const KAYAK_ID = "b0000000-0000-4000-8000-000000000006"; // kayak-embalse-guatape (établissement B)
const KAYAK_SLUG = "kayak-embalse-guatape";
const KAYAK_DATE = "2026-09-05";

const BACK_TO_CATALOG_LINK = "← Volver al catálogo";

// Les 2 tests ciblent kayak-embalse-guatape/2026-09-05 (la seule date seedée pour ce produit,
// cf. supabase/seed.sql) : jamais en parallèle l'un de l'autre.
test.describe.configure({ mode: "serial" });

test("panier avec une ligne par établissement → une seule commande, 2 lignes", async ({
  page,
}) => {
  await resetAvailability(TOUR_ID, TOUR_DATE, { capacity: 3, booked: 0 });
  await resetAvailability(KAYAK_ID, KAYAK_DATE, { capacity: 3, booked: 0 });
  await loginAs(page.context(), SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);

  await page.goto("/es");
  await page.getByTestId(`catalog-link-${TOUR_SLUG}`).click();
  await page.locator(`[data-date="${TOUR_DATE}"]`).click();
  await page.locator("#qty").fill("2");
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  // Retour catalogue via un vrai lien (client-side) — un page.goto() direct vers la 2e fiche
  // produit réinitialiserait le panier (comportement attendu, pas un bug).
  await page.getByRole("link", { name: BACK_TO_CATALOG_LINK, exact: true }).click();
  await expect(page).toHaveURL(/\/es\/?$/);

  await page.getByTestId(`catalog-link-${KAYAK_SLUG}`).click();
  await page.locator(`[data-date="${KAYAK_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/es\/checkout/);
  await expect(page.getByTestId(/^cart-line-/)).toHaveCount(2);

  const tourLine = page.locator('[data-testid^="cart-line-"]', { hasText: TOUR_DATE });
  const kayakLine = page.locator('[data-testid^="cart-line-"]', { hasText: KAYAK_DATE });

  const [tourEstablishment, kayakEstablishment] = await Promise.all([
    getEstablishmentName(TOUR_ID),
    getEstablishmentName(KAYAK_ID),
  ]);
  // Les 2 lignes doivent afficher chacune son propre établissement, sa propre date et sa propre
  // quantité — la preuve la plus directe qu'il s'agit bien d'un panier multi-établissement.
  await expect(tourLine).toContainText(tourEstablishment!);
  await expect(tourLine).toContainText("Cantidad: 2");
  await expect(kayakLine).toContainText(kayakEstablishment!);
  await expect(kayakLine).toContainText("Cantidad: 1");
  expect(tourEstablishment).not.toBe(kayakEstablishment);

  const phone = "+57 300 444 5555";
  await page.locator('input[name="holder-name"]').fill("Cliente E2E Multi Establecimiento");
  await page.locator('input[name="holder-phone"]').fill(phone);
  await page.locator('input[name="holder-email"]').fill("cliente.multi.establecimiento@example.com");
  // Spec 19 §0 Tranche 1 : create_order réussi enchaîne désormais automatiquement le paiement
  // Mercado Pago (redirection réelle, seul l'appel SDK externe est mocké). order-success n'est
  // qu'un état transitoire — la redirection peut déjà l'avoir remplacé avant que Playwright ne
  // l'observe (race constatée en testant) : attendre l'URL finale est le seul checkpoint fiable.
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  await page.waitForURL(redirectUrl);

  // Une seule commande, avec exactement les 2 lignes attendues (même order_id) — pas 2 commandes
  // séparées.
  expect(await countOrdersByPhone(phone)).toBe(1);
  const orderLines = await getOrderLinesForPhone(phone);
  expect(orderLines).toHaveLength(2);
  expect(new Set(orderLines.map((line) => line.order_id)).size).toBe(1);
  const tourWritten = orderLines.find((line) => line.product_id === TOUR_ID);
  const kayakWritten = orderLines.find((line) => line.product_id === KAYAK_ID);
  expect(tourWritten).toMatchObject({ date: TOUR_DATE, qty: 2 });
  expect(kayakWritten).toMatchObject({ date: KAYAK_DATE, qty: 1 });
});

test("une ligne dépasse la capacité restante de sa ressource → erreur ciblée sur cette ligne, aucune commande créée (tout-ou-rien)", async ({
  page,
}) => {
  // Un seul cupo ouvert pour tour-lancha-guatape : juste assez pour que l'ajout au panier
  // réussisse (le bouton "Añadir al carrito" exige remaining >= 1 pour être cliquable), avant
  // d'être pré-saturé directement en base — cf. commentaire plus bas.
  await resetAvailability(TOUR_ID, TOUR_DATE, { capacity: 1, booked: 0 });
  await resetAvailability(KAYAK_ID, KAYAK_DATE, { capacity: 3, booked: 0 });
  await loginAs(page.context(), SEEDED_ACCOUNTS.operateurActif, SEEDED_PASSWORD);

  await page.goto("/es");
  await page.getByTestId(`catalog-link-${TOUR_SLUG}`).click();
  await page.locator(`[data-date="${TOUR_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  await page.getByRole("link", { name: BACK_TO_CATALOG_LINK, exact: true }).click();
  await page.getByTestId(`catalog-link-${KAYAK_SLUG}`).click();
  await page.locator(`[data-date="${KAYAK_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  // Pré-sature directement la disponibilité de la ressource visée par la ligne tour-lancha, entre
  // l'ajout au panier (purement local) et la validation du panier — simule un autre acheteur qui
  // prend la dernière place pendant que ce client compose son panier. La ligne kayak, elle, reste
  // valide : le test doit prouver que TOUT le panier échoue quand même (tout-ou-rien), pas
  // seulement la ligne fautive.
  await setBooked(TOUR_ID, TOUR_DATE, 1);

  await page.getByTestId("go-to-checkout-link").click();
  await expect(page.getByTestId(/^cart-line-/)).toHaveCount(2);

  const phone = "+57 300 666 7777";
  await page.locator('input[name="holder-name"]').fill("Cliente E2E Multi Full");
  await page.locator('input[name="holder-phone"]').fill(phone);
  await page.locator('input[name="holder-email"]').fill("cliente.multi.full@example.com");
  await page.getByTestId("submit-order-button").click();

  await expect(page.getByTestId("checkout-error")).toBeVisible();
  await expect(page.getByTestId("order-success")).toHaveCount(0);

  const tourLine = page.locator('[data-testid^="cart-line-"]', { hasText: TOUR_DATE });
  const kayakLine = page.locator('[data-testid^="cart-line-"]', { hasText: KAYAK_DATE });
  // L'erreur cible spécifiquement la ligne en cause (tour-lancha, désormais complète) — pas la
  // ligne kayak, qui restait individuellement valide.
  await expect(tourLine).toHaveAttribute("data-failed", "true");
  await expect(kayakLine).toHaveAttribute("data-failed", "false");

  // Tout-ou-rien vérifiable directement en base : aucune commande créée du tout, et la ligne
  // kayak (individuellement valide) n'a pas non plus consommé son cupo.
  expect(await countOrdersByPhone(phone)).toBe(0);
  const tourAvailability = await getAvailability(TOUR_ID, TOUR_DATE);
  const kayakAvailability = await getAvailability(KAYAK_ID, KAYAK_DATE);
  expect(tourAvailability?.booked).toBe(1);
  expect(kayakAvailability?.booked).toBe(0);
});
