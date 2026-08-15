import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { formatCop } from "@hifago/domain";

// Feature 12 (Admin : consulter le ledger d'une commande) — "Cliente Ledger Seed"
// (supabase/seed.sql) porte 2 lignes sur le même produit/référent externe (Prestador Propuestas
// Org) : une fulfilled (earned, referrer_commission_cop dû tel quel) et une cancelled_by_client
// (redistributed, referrer_commission_cop redirigé vers le prestataire). Commande DÉDIÉE, pas
// "Cliente Referido Seed" (feature 9) — cf. commentaire dans seed.sql.
test("admin ouvre une commande depuis la liste, voit la ventilation par ligne, la part référent redirigée sur une ligne annulée", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");

  const seedRow = page.locator("tr", { hasText: "Cliente Ledger Seed" }).first();
  await expect(seedRow).toBeVisible();
  await seedRow.getByRole("link", { name: "Ver pedido" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/.+/);

  await expect(page.getByTestId("order-meta")).toContainText("Prestador Propuestas Org");

  const ledgerTable = page.getByTestId("ledger-table");
  await expect(ledgerTable).toBeVisible();

  const zero = formatCop(0);
  const referrerShare = formatCop(8000);
  const providerEarned = formatCop(66400); // 80000 (total) - 13600 (acompte)
  const providerRedistributed = formatCop(74400); // 66400 (part structurelle) + 8000 (commission référent redirigée)

  // Ligne fulfilled (2026-10-03) → earned : la part référent reste due au référent, pas encore au
  // prestataire.
  const fulfilledRow = ledgerTable.locator("tr", { hasText: "2026-10-03" });
  await expect(fulfilledRow).toBeVisible();
  await expect(fulfilledRow).toContainText("Ganado");
  await expect(fulfilledRow.getByTestId(/^referrer-due-/)).toHaveText(referrerShare);
  await expect(fulfilledRow.getByTestId(/^provider-due-/)).toHaveText(providerEarned);

  // Ligne cancelled_by_client (2026-10-04) → redistributed : la part référent tombe à 0 et se
  // retrouve intégralement dans la part prestataire — jamais simplement absente.
  const cancelledRow = ledgerTable.locator("tr", { hasText: "2026-10-04" });
  await expect(cancelledRow).toBeVisible();
  await expect(cancelledRow).toContainText("Redistribuido");
  await expect(cancelledRow.getByTestId(/^referrer-due-/)).toHaveText(zero);
  await expect(cancelledRow.getByTestId(/^provider-due-/)).toHaveText(providerRedistributed);
});
