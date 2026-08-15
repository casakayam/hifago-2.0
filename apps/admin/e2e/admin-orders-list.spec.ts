import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature 9 (Admin : liste des commandes) — /admin/orders, table dense sur order_lines. Les
// assertions ciblent les 2 commandes de démonstration seedées (supabase/seed.sql, "Cliente Directo
// Seed" et "Cliente Referido Seed") par leur nom de titulaire, jamais par un total de lignes ou une
// position absolue — robuste à d'autres commandes créées en parallèle par d'autres specs e2e
// (admin voit TOUTES les commandes, pas seulement celles de ce test).
test("admin ouvre /admin/orders, voit les commandes seedées (avec et sans référent), filtre par statut, trie par colonne", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");
  await expect(page.locator('[data-testid^="order-line-row-"]').first()).toBeVisible();

  const directRow = page.locator("tr", { hasText: "Cliente Directo Seed" });
  const referredRow = page.locator("tr", { hasText: "Cliente Referido Seed" });
  await expect(directRow).toBeVisible();
  await expect(referredRow).toBeVisible();

  // Première fois que referrer_partner_id (feature 7) est réellement affiché : "Directo" pour la
  // commande sans référent, le nom du partenaire référent pour l'autre.
  await expect(directRow).toContainText("Directo");
  await expect(referredRow).toContainText("Prestador Propuestas Org");

  // Filtre par statut : les 2 commandes seedées sont "reserved" (Reservada) — visibles sous ce
  // filtre, invisibles sous un filtre disjoint (aucune des deux n'est encore "Realizada").
  await page.getByTestId("status-filter-select").click();
  await page.getByRole("option", { name: "Reservada" }).click();
  await expect(directRow).toBeVisible();
  await expect(referredRow).toBeVisible();

  await page.getByTestId("status-filter-select").click();
  await page.getByRole("option", { name: "Realizada" }).click();
  await expect(directRow).toHaveCount(0);
  await expect(referredRow).toHaveCount(0);

  await page.getByTestId("status-filter-select").click();
  await page.getByRole("option", { name: "Todos los estados" }).click();
  await expect(directRow).toBeVisible();
  await expect(referredRow).toBeVisible();

  // Tri par colonne : par défaut, date de service croissante — "Cliente Directo Seed" (2026-10-01)
  // avant "Cliente Referido Seed" (2026-10-02). Comparaison par position RELATIVE entre les 2
  // lignes connues (pas un index absolu), robuste à d'autres lignes présentes dans le tableau.
  async function relativeOrder() {
    const rows = await page.locator('[data-testid^="order-line-row-"]').allTextContents();
    const directIndex = rows.findIndex((text) => text.includes("Cliente Directo Seed"));
    const referredIndex = rows.findIndex((text) => text.includes("Cliente Referido Seed"));
    return { directIndex, referredIndex };
  }

  const ascending = await relativeOrder();
  expect(ascending.directIndex).toBeGreaterThanOrEqual(0);
  expect(ascending.referredIndex).toBeGreaterThan(ascending.directIndex);

  // Clic sur l'en-tête "Fecha" : bascule vers décroissant, l'ordre relatif s'inverse.
  await page.getByTestId("sort-date").click();
  const descending = await relativeOrder();
  expect(descending.directIndex).toBeGreaterThan(descending.referredIndex);
});
