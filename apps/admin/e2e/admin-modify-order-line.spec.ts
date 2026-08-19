import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { resetAvailability, createSignedInClient } from "@hifago/e2e-support";

// Spec 17 §0 Tranche 1 (« Modificar » — modify_order_line) — la logique de la RPC elle-même
// (arithmétique de capacité, exclusion camp, re-résolution de prix, transfert de réconciliation
// PMS) est déjà entièrement couverte par pgTAP (supabase/tests/database/modify_order_line.test.sql,
// 26 assertions) — pas re-prouvée ici, seul le parcours écran (bouton → dialogue → RPC → mise à
// jour sans rechargement) l'est, même patron que admin-order-status.spec.ts.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = "2026-09-20"; // date dédiée à ce spec, distincte de admin-order-status.spec.ts (09-15)

test("admin modifie la quantité d'une réservation depuis /admin/orders, la ligne d'origine disparaît, la nouvelle apparaît", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });

  const holderName = `Cliente E2E Modify Order Line ${Date.now()}`;
  const setupClient = await createSignedInClient(SEEDED_ACCOUNTS.operateurActif, SEEDED_PASSWORD);
  const { data: result, error: rpcError } = await setupClient.rpc("create_order", {
    p_lines: [{ product_id: PRODUCT_ID, date: DATE, qty: 1 }],
    p_holder_name: holderName,
    p_holder_email: "cliente.modify.order.line@example.com",
  });
  const created = result as { ok: boolean; order_id?: string } | null;
  if (rpcError || !created?.ok || !created.order_id) {
    throw new Error(`e2e setup: create_order a échoué : ${rpcError?.message}`);
  }

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");

  const row = page.locator("tr", { hasText: holderName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Reservada");

  await row.getByTestId(/^modify-button-/).click();
  await page.waitForSelector('[data-testid="modify-date-input"]');
  await page.getByTestId("modify-qty-input").fill("3");
  await page
    .getByTestId("modify-reason-input")
    .fill("El cliente amplió el grupo antes de la salida.");
  await page.getByTestId("confirm-modify-button").click();

  // La liste n'est filtrée par aucun statut par défaut : l'ancienne ligne (désormais superseded)
  // ET la nouvelle (reserved, qty=3) portent toutes deux le même titulaire — distinguées par leur
  // statut, jamais par une hypothèse d'ordre d'affichage.
  await expect(page.getByTestId("confirm-modify-button")).toHaveCount(0, { timeout: 5000 });
  const oldRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Sustituida" });
  const newRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Reservada" });
  await expect(oldRow).toBeVisible();
  await expect(newRow).toBeVisible();
  await expect(newRow).toContainText("3");

  await page.reload();
  const reloadedOldRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Sustituida" });
  const reloadedNewRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Reservada" });
  await expect(reloadedOldRow).toBeVisible();
  await expect(reloadedNewRow).toBeVisible();
  await expect(reloadedNewRow).toContainText("3");
});
