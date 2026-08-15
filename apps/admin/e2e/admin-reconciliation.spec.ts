import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature 22 (Admin : file de réconciliation PMS) — parcours écran. La logique de
// resolve_reconciliation_entry elle-même (non-admin, motif obligatoire, entrée introuvable/déjà
// traitée, resolved_by/resolved_at/resolution_note, audit_log) est déjà entièrement couverte par
// pgTAP (supabase/tests/database/pms_reconciliation.test.sql) — pas re-prouvée ici, seul le
// parcours écran l'est.
//
// Entrées seedées (supabase/seed.sql, stables via order_id + date — cf. résumé agent backend
// feature 22) : "Cliente Directo Seed" (status open) et "Cliente Referido Seed" (status
// retrying), toutes deux sur Casa Kayam Guatapé. Aucune entrée permanently_failed seedée — le
// groupe échec permanent doit donc rester vide dans ce parcours.
test("admin voit les entrées seedées groupées correctement, résout une entrée open avec un motif, elle disparaît du groupe actionnable", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/reconciliation");

  const actionableGroup = page.getByTestId("reconciliation-actionable-group");
  const failedGroup = page.getByTestId("reconciliation-failed-group");

  // Les 2 entrées seedées (open/retrying) sont actionnables, aucune en échec permanent.
  await expect(actionableGroup).toContainText("Cliente Directo Seed");
  await expect(actionableGroup).toContainText("Cliente Referido Seed");
  await expect(failedGroup).not.toContainText("Cliente Directo Seed");
  await expect(failedGroup).not.toContainText("Cliente Referido Seed");

  const openEntry = actionableGroup
    .getByTestId("reconciliation-entry")
    .filter({ hasText: "Cliente Directo Seed" });
  await expect(openEntry).toBeVisible();

  await openEntry.getByTestId("resolve-entry-button").click();

  await page.waitForSelector('[data-testid="resolution-note-input"]');
  await page
    .getByTestId("resolution-note-input")
    .fill("Reserva confirmada manualmente en LobbyPMS tras revisión.");
  await page.getByTestId("confirm-resolve-button").click();

  // L'entrée résolue disparaît silencieusement du groupe actionnable (mise à jour d'état local,
  // pas de router.refresh(), cf. ReconciliationList.tsx) et ne rejoint pas non plus le groupe
  // échec permanent (transition système uniquement, jamais résultat d'une résolution admin).
  await expect(
    actionableGroup.getByTestId("reconciliation-entry").filter({ hasText: "Cliente Directo Seed" })
  ).toHaveCount(0);
  await expect(failedGroup).not.toContainText("Cliente Directo Seed");

  // L'entrée retrying, non touchée par cette résolution, reste actionnable.
  await expect(actionableGroup).toContainText("Cliente Referido Seed");
});
