import { test, expect } from "@playwright/test";
import { resetAvailability, mockMercadoPagoCheckout, seedDate } from "@hifago/e2e-support";

// Spec 33 — LE SEGMENT QUE PERSONNE NE REGARDAIT.
//
// Ce fichier existe parce qu'aucun des onze e2e qui traversaient le checkout n'atterrissait là où
// un vrai client atterrit : `mockMercadoPagoCheckout` renvoyait vers l'ACCUEIL. Quand la spec 32 a
// fait vider `cart_items` par `create_order`, le retour de paiement est devenu une page blanche —
// sans qu'une seule ligne de test ne vire au rouge.
//
// ⚠️ C'est aussi le seul filet POSSIBLE ici : `MERCADOPAGO_WEBHOOK_SECRET` est absent en local et
// aucun identifiant sandbox n'est configuré, donc un parcours manuel ne quitte jamais le site —
// `startPayment` échoue en « Mercado Pago indisponible » avant toute redirection. Ce que la machine
// locale ne peut pas exercer à la main, elle doit le simuler ici.
//
// Ce que ces tests prouvent, et qu'aucun autre ne prouve :
//   1. une commande acceptée mène à une ADRESSE, pas à un état React — donc elle survit à F5 ;
//   2. cette adresse porte le numéro de réservation, le récapitulatif et les totaux ;
//   3. elle reste ouvrable SANS SESSION (contexte navigateur neuf) — le cas du lien de l'email ;
//   4. un jeton inconnu rend 404, jamais une page à moitié rendue.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = seedDate(17); // date dédiée à ce spec (cf. supabase/seed.sql, capacity 5) — toutes
// les autres dates de tour-lancha-guatape sont déjà réservées à une spec, cf. le seed.

// Les tests visent la même ressource (produit, date) : jamais en parallèle l'un de l'autre.
test.describe.configure({ mode: "serial" });

/** Parcours complet jusqu'à l'écran de résultat. Rend l'URL atteinte, jeton compris. */
async function commanderJusquAuResultat(page: import("@playwright/test").Page, email: string) {
  // ⚠️ ENTRÉE PAR LA FICHE, PAS PAR L'ACCUEIL, et c'est délibéré. Mesuré le 2026-09-10 :
  // `tour-lancha-guatape` est 11ᵉ des 11 activités vendables en `created_at desc`, or une section
  // de l'accueil plafonne à 8 — il est donc HORS ÉCRAN tant que des résidus d'e2e traînent en base
  // (dette connue, `playwright.config.ts` et `docs/dette-technique.md`). Passer par l'accueil
  // ferait échouer ce fichier pour une raison qui n'a rien à voir avec ce qu'il mesure.
  // Un lien profond vers une fiche est de toute façon un vrai parcours client (cahier §2b.1 :
  // « arrivée sur l'accueil, OU directement sur une fiche par lien profond, QR ou lien attribué »).
  await page.goto("/es/productos/tour-lancha-guatape");
  await expect(page.getByTestId("product-name")).toBeVisible();
  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/es\/pago/);

  await page.locator('input[name="holder-name"]').fill("Cliente E2E Retorno");
  await page.locator('input[name="holder-phone"]').fill("+57 300 444 5555");
  await page.locator('input[name="holder-email"]').fill(email);

  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();
  await page.waitForURL(redirectUrl);
  return page.url();
}

test("commande validée → adresse propre à la commande, avec numéro, récapitulatif et totaux", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  const url = await commanderJusquAuResultat(page, "retorno.uno@example.com");

  // L'adresse porte un jeton de 32 caractères hex, jamais l'UUID de la commande (spec 33 ② : le
  // numéro affiché et la clé d'accès sont deux objets distincts).
  expect(url).toMatch(/\/es\/reserva\/[0-9a-f]{32}(\?|$)/);

  await expect(page.getByTestId("order-result")).toBeVisible();
  // Un vrai numéro dictable, jamais l'UUID brut que l'ancien écran affichait.
  await expect(page.locator("h1")).toContainText(/HFG-\d{6}/);
  await expect(page.getByTestId(/^order-line-/)).toHaveCount(1);
  await expect(page.getByTestId("order-total")).toBeVisible();
  await expect(page.getByTestId("order-acompte")).toBeVisible();
  await expect(page.getByTestId("order-remainder")).toBeVisible();

  // Pas encore payé (Mercado Pago n'a jamais été atteint) : l'écran doit le dire et proposer de
  // payer — jamais laisser croire que la réservation est confirmée.
  await expect(page.getByTestId("order-state-unpaid")).toBeVisible();
  await expect(page.getByTestId("pay-button")).toBeVisible();
});

test("l'adresse survit à un rechargement — c'était tout le défaut de l'ancien écran", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  const url = await commanderJusquAuResultat(page, "retorno.dos@example.com");
  const numero = await page.locator("h1").innerText();

  // LE test de non-régression du lot : l'ancien écran vivait dans un `useState`, donc un F5 (ou le
  // retour depuis Mercado Pago, qui est un rechargement) le faisait disparaître et laissait
  // « ton panier est vide ».
  await page.reload();
  await expect(page.getByTestId("order-result")).toBeVisible();
  await expect(page.locator("h1")).toHaveText(numero);
  await expect(page.getByTestId("empty-cart")).toHaveCount(0);

  expect(page.url()).toContain(url.split("?")[0]);
});

test("le lien s'ouvre SANS session — le cas du client qui clique depuis son email", async ({
  page,
  browser,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });
  const url = await commanderJusquAuResultat(page, "retorno.tres@example.com");
  const numero = await page.locator("h1").innerText();

  // Contexte NEUF : aucun cookie, donc aucune session — pas même l'identité anonyme que
  // `CartContext` pose au premier ajout au panier. C'est exactement l'état d'un client qui ouvre
  // le lien sur un autre appareil, des mois plus tard.
  const contexteVierge = await browser.newContext();
  const pageVierge = await contexteVierge.newPage();
  await pageVierge.goto(url);

  await expect(pageVierge.getByTestId("order-result")).toBeVisible();
  await expect(pageVierge.locator("h1")).toHaveText(numero);
  // Sans compte réel, l'écran propose de s'en créer un (le rattachement par email, Tranche 3).
  await expect(pageVierge.getByTestId("create-account-link")).toBeVisible();

  await contexteVierge.close();
});

test("un jeton inconnu rend 404, jamais une page à moitié rendue", async ({ page }) => {
  const response = await page.goto(`/es/reserva/${"a".repeat(32)}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("order-result")).toHaveCount(0);
});

test("un jeton malformé rend 404 lui aussi — jamais un message qui trahirait le format attendu", async ({
  page,
}) => {
  const response = await page.goto("/es/reserva/pas-un-jeton");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("order-result")).toHaveCount(0);
});
