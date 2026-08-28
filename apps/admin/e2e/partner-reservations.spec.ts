import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  createSignedInClient,
  webProductUrl,
  mockMercadoPagoCheckout,
  nextMonthIsoDate,
} from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 17 §0 Tranche 1 (« Mis Reservas » + lien calendrier→commandes) — établissement/partenaire
// operadorPropuestas déjà utilisé ailleurs dans la suite (capacité operator ACTIVE scopée, cf.
// supabase/seed.sql), mais un produit DÉDIÉ à ce test : ce test approuve une vraie réservation, la
// base locale n'est pas remise à zéro entre deux exécutions e2e.
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

// Le 15 du mois SUIVANT (jamais le mois courant, dont le nombre de jours restants dépend de la date
// d'exécution) : un clic "mois suivant" suffit pour l'atteindre sur le calendrier admin. Le mois est
// désormais celui de GUATAPÉ (lot fuseau, 2026-08-28) — cette copie locale partait de
// `getUTCMonth()`, donc du mois suivant d'UTC, qui diverge du mois affiché à l'écran le 31 au soir.

test("un socio voit dans Mis reservas une réservation réelle sur son produit, avec le téléphone du client visible ; l'admin y accède aussi depuis le calendrier", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const productName = `Actividad Reservas E2E ${stamp}`;
  const holderName = `Cliente Reservas E2E ${stamp}`;
  const holderPhone = "+57 300 111 2233";
  const date = nextMonthIsoDate(15);

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: productName },
      price_cop: 45000,
      sellable: true,
      slug: slugify(productName),
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }
  // product_availability est RPC-only (aucun insert direct, même en admin) — set_product_availability
  // même patron que availability-calendar.tsx.
  const { data: availabilityResult, error: availabilityError } = await adminClient.rpc(
    "set_product_availability",
    { p_product_id: product.id, p_date: date, p_capacity: 5, p_open: true }
  );
  if (availabilityError || !(availabilityResult as { ok: boolean } | null)?.ok) {
    throw new Error(
      `e2e setup: ouverture de la disponibilité a échoué : ${availabilityError?.message ?? JSON.stringify(availabilityResult)}`
    );
  }

  // --- Client anonyme : réservation réelle, jamais via l'UI socio/admin (create_order) ---------
  await context.clearCookies();
  await page.goto(webProductUrl(slugify(productName)));
  await page.locator(`[data-date="${date}"]`).click();
  await expect(page.getByTestId("add-to-cart-button")).toBeEnabled();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.locator('input[name="holder-name"]').fill(holderName);
  await page.locator('input[name="holder-phone"]').fill(holderPhone);
  await page.locator('input[name="holder-email"]').fill(`cliente.reservas.${stamp}@example.com`);
  // Spec 19 §0 Tranche 1 : create_order réussi enchaîne désormais automatiquement le paiement
  // Mercado Pago (redirection réelle, seul l'appel SDK externe est mocké). order-success n'est
  // qu'un état transitoire — la redirection peut déjà l'avoir remplacé avant que Playwright ne
  // l'observe (race constatée en testant) : attendre l'URL finale est le seul checkpoint fiable.
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();
  await page.waitForURL(redirectUrl);

  // --- Socio operator : voit la réservation dans Mis reservas, téléphone du client visible -------
  // Décision Jérôme (2026-08-19, refonte vue prestataire) : lève la restriction "PII minimale"
  // documentée en 20260817180000 (order_lines.holder_phone/holder_email désormais exposés au
  // prestataire sur ses propres établissements, cf. migration 20260819180000). Inversion de
  // l'assertion précédente ("sans le téléphone du client").
  // Sans filtre explicite, "Mis reservas" s'ouvre par défaut sur la semaine à venir (demande
  // Jérôme, refonte vue prestataire 2026-08-19) — `date` (15 du mois suivant) en est délibérément
  // hors bornes (cf. commentaire de nextMonthMidDate()), donc `date_to` explicite ici pour inclure
  // la réservation sans dépendre de la date d'exécution du test.
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/reservations?date_to=${date}`);

  const row = page.locator("tr", { hasText: holderName });
  await expect(row).toBeVisible();
  await expect(row).toContainText(productName);
  await expect(row).toContainText(holderPhone);

  // --- Admin : le calendrier produit lie vers les réservations de ce jour précisément -----------
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${product.id}/availability`);
  await page.waitForSelector(".fc");
  await page.locator(".fc-next-button").click();
  await page.locator(`.fc-daygrid-day[data-date="${date}"]`).click();
  await page.waitForSelector('[role="dialog"]');

  const viewOrdersLink = page.getByTestId("view-day-orders-link");
  await expect(viewOrdersLink).toBeVisible();
  await expect(viewOrdersLink).toContainText("(1)");
  await viewOrdersLink.click();
  await expect(page).toHaveURL(/\/admin\/orders\?/);
  await expect(page.locator("tr", { hasText: holderName })).toBeVisible();

  // --- Spec 19 §0 Tranche 0 : le socio marque lui-même "Cliente no vino" sur SA réservation ------
  // Élargissement d'autorisation de set_order_line_status (migration 20260818150000) : seule
  // transition que l'operator peut désormais déclencher lui-même, jamais via l'admin ici.
  // Retour Jérôme (2026-08-20) : "Cliente no vino"/"Cancelar" retirés de la liste, ne restent que
  // sur la fiche détail (ReservationActions.tsx) — clic ligne puis action, plus une action rapide
  // depuis la liste.
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/reservations?date_to=${date}`);

  const reservationRow = page.locator("tr", { hasText: holderName });
  await expect(reservationRow).toBeVisible();
  await expect(reservationRow.getByTestId(/^reservation-status-/)).toContainText("Reservada");

  await reservationRow.getByRole("link", { name: "Ver ficha" }).click();
  await expect(page).toHaveURL(/\/partner\/reservations\/.+$/);

  await page.getByTestId("detail-no-show-button").click();
  await page.waitForSelector('[data-testid="status-reason-input"]');
  await page.getByTestId("status-reason-input").fill("Cliente no llegó al punto de encuentro (e2e).");
  await page.getByTestId("confirm-status-button").click();

  // La fiche détail reflète le nouveau statut, le bouton n'est plus visible (transition déjà faite,
  // ReservationActions.tsx retourne null dès que status !== 'reserved').
  await expect(page.getByTestId("reservation-detail-status")).toContainText("Ausencia");
  await expect(page.getByTestId("detail-no-show-button")).toHaveCount(0);
});
