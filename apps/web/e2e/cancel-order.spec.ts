import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { resetAvailability, getOrderLineStatuses, createSignedInClient } from "@hifago/e2e-support";

// Feature 8 (Client : annuler sa réservation) : pilote réellement /account/orders — la commande
// apparaît, clic sur Annuler, l'état affiché change, un rechargement de page confirme la
// persistance réelle (pas un état client optimiste non sauvegardé). La logique de cancel_order
// elle-même (order_not_found, booked inchangé, ligne fulfilled intacte, no_active_lines) est déjà
// entièrement couverte par pgTAP (supabase/tests/database/cancel_order.test.sql) — pas re-prouvée
// ici, seul le parcours écran l'est.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = "2026-09-14"; // date dédiée à ce spec (cf. supabase/seed.sql)

test("un client connecté annule sa réservation depuis /account/orders, l'état persiste après rechargement", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  // Setup — réservation créée directement via create_order (dogfooding, pas un insert brut),
  // pour la vitesse : le parcours panier → checkout complet est déjà prouvé par reserve.spec.ts,
  // pas l'objet de ce test.
  const setupClient = await createSignedInClient(SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  const { data: result, error: rpcError } = await setupClient.rpc("create_order", {
    p_lines: [{ product_id: PRODUCT_ID, date: DATE, qty: 1 }],
    p_holder_name: "Cliente E2E Cancel",
  });
  const created = result as { ok: boolean; order_id?: string } | null;
  if (rpcError || !created?.ok || !created.order_id) {
    throw new Error(`e2e setup: create_order a échoué : ${rpcError?.message}`);
  }
  const orderId = created.order_id;

  await loginAs(page.context(), SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  await page.goto("/es/account/orders");

  const orderRow = page.getByTestId(`order-row-${orderId}`);
  await expect(orderRow).toBeVisible();
  await expect(page.getByTestId(`order-status-${orderId}`)).toHaveText("1 de 1 líneas activas");

  const cancelButton = page.getByTestId(`cancel-order-button-${orderId}`);
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  // L'état affiché change : plus aucune ligne active → le résumé se met à jour et le bouton
  // disparaît (rien à annuler de plus).
  await expect(page.getByTestId(`order-status-${orderId}`)).toHaveText("0 de 1 líneas activas");
  await expect(cancelButton).toHaveCount(0);

  // Rechargement de page : confirme la persistance réelle, pas un état client optimiste non
  // sauvegardé (le Server Component relit orders/order_lines depuis la base à chaque requête).
  await page.reload();
  await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible();
  await expect(page.getByTestId(`order-status-${orderId}`)).toHaveText("0 de 1 líneas activas");
  await expect(page.getByTestId(`cancel-order-button-${orderId}`)).toHaveCount(0);

  // Confirmation en base, au-delà de l'écran.
  const statuses = await getOrderLineStatuses(orderId);
  expect(statuses).toEqual(["cancelled_by_client"]);
});
