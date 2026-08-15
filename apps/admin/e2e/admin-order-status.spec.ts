import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { resetAvailability, getOrderLineStatuses, createSignedInClient } from "@hifago/e2e-support";

// Feature 10 (Admin : changer manuellement le statut d'une ligne de commande) — extension de
// /admin/orders (feature 9). La logique de set_order_line_status elle-même (non-admin, motif
// obligatoire, statut restreint, ligne introuvable, audit_log) est déjà entièrement couverte par
// pgTAP (supabase/tests/database/set_order_line_status.test.sql) — pas re-prouvée ici, seul le
// parcours écran l'est.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = "2026-09-15"; // date dédiée à ce spec (cf. supabase/seed.sql)

test("admin ouvre /admin/orders, fait passer une ligne reserved à no_show avec un motif, le badge se met à jour sans rechargement", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  const holderName = `Cliente E2E Order Status ${Date.now()}`;
  const setupClient = await createSignedInClient(SEEDED_ACCOUNTS.operateurActif, SEEDED_PASSWORD);
  const { data: result, error: rpcError } = await setupClient.rpc("create_order", {
    p_lines: [{ product_id: PRODUCT_ID, date: DATE, qty: 1 }],
    p_holder_name: holderName,
  });
  const created = result as { ok: boolean; order_id?: string } | null;
  if (rpcError || !created?.ok || !created.order_id) {
    throw new Error(`e2e setup: create_order a échoué : ${rpcError?.message}`);
  }
  const orderId = created.order_id;

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");

  const row = page.locator("tr", { hasText: holderName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Reservada");

  await row.getByTestId(/^change-status-button-/).click();
  await page.waitForSelector('[data-testid="new-status-select"]');
  await page.getByTestId("new-status-select").click();
  await page.getByRole("option", { name: "Ausencia" }).click();
  await page
    .getByTestId("status-reason-input")
    .fill("El cliente no se presentó en el punto de encuentro.");
  await page.getByTestId("confirm-status-button").click();

  // Le badge se met à jour dans la table sans recharger la page complète (état client, pas un
  // page.reload() ici) — c'est précisément ce qui est vérifié : l'absence de rechargement.
  await expect(row).toContainText("Ausencia", { timeout: 5000 });
  await expect(page.getByTestId("new-status-select")).toHaveCount(0);

  // Confirmation en base, au-delà de l'écran.
  const statuses = await getOrderLineStatuses(orderId);
  expect(statuses).toEqual(["no_show"]);
});
