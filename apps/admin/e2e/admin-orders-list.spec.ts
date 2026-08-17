import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature 9 (Admin : liste des commandes), retrofit docs/specs/10-listes-standardisees-admin-socio.md
// (lot 1, écran pilote) — /admin/orders sur DataList. Les assertions ciblent les 2 commandes de
// démonstration seedées (supabase/seed.sql, "Cliente Directo Seed" et "Cliente Referido Seed") par
// leur nom de titulaire, jamais par un total de lignes ou une position absolue — robuste à
// d'autres commandes créées en parallèle par d'autres specs e2e (admin voit TOUTES les commandes,
// pas seulement celles de ce test).
//
// Tri par défaut désormais `created_at desc` (décision Jérôme 2026-08-15, remplace `date asc`) —
// la base locale accumule au fil du temps des dizaines de commandes créées par d'autres specs e2e
// (jamais nettoyées entre les runs), qui passent maintenant devant les 2 lignes seedées nommées
// une fois pour toutes il y a longtemps (page 1 leur échappe désormais). On scope donc la vue au
// filtre `date_from`/`date_to` sur leur fenêtre de dates DÉDIÉE (2026-10-01/02, volontairement
// disjointe de toute autre spec e2e, cf. supabase/seed.sql) avant toute assertion — plus robuste
// que de dépendre d'un tri/pagination par défaut pour les faire apparaître.
test("admin ouvre /admin/orders, voit les commandes seedées (avec et sans référent), filtre par statut, trie par colonne", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");
  await expect(page.locator('[data-testid^="order-line-row-"]').first()).toBeVisible();

  await page.getByTestId("filter-date_from").fill("2026-10-01");
  await page.getByTestId("filter-date_to").fill("2026-10-02");
  await page.getByTestId("server-filters-submit").click();

  const directRow = page.locator("tr", { hasText: "Cliente Directo Seed" });
  const referredRow = page.locator("tr", { hasText: "Cliente Referido Seed" });
  await expect(directRow).toBeVisible();
  await expect(referredRow).toBeVisible();

  // Première fois que referrer_partner_id (feature 7) est réellement affiché : "Directo" pour la
  // commande sans référent, le nom du partenaire référent pour l'autre.
  await expect(directRow).toContainText("Directo");
  await expect(referredRow).toContainText("Prestador Propuestas Org");

  // Filtre par statut : ServerFilters est un <form method="GET"> avec soumission explicite (pas
  // d'auto-navigation au changement de sélection, contrairement à l'ancien Select+router.push) —
  // choisir l'option PUIS cliquer "Buscar". Les 2 commandes seedées sont "reserved" (Reservada) —
  // visibles sous ce filtre, invisibles sous un filtre disjoint (aucune des deux n'est encore
  // "Realizada").
  await page.getByTestId("filter-status").click();
  await page.getByRole("option", { name: "Reservada" }).click();
  await page.getByTestId("server-filters-submit").click();
  await expect(directRow).toBeVisible();
  await expect(referredRow).toBeVisible();

  await page.getByTestId("filter-status").click();
  await page.getByRole("option", { name: "Realizada" }).click();
  await page.getByTestId("server-filters-submit").click();
  await expect(directRow).toHaveCount(0);
  await expect(referredRow).toHaveCount(0);

  await page.getByTestId("filter-status").click();
  await page.getByRole("option", { name: "Todos los estados" }).click();
  await page.getByTestId("server-filters-submit").click();
  await expect(directRow).toBeVisible();
  await expect(referredRow).toBeVisible();

  // Tri par colonne, déterministe (dates seedées distinctes, 2026-10-01 vs 2026-10-02). Comparaison
  // par position RELATIVE entre les 2 lignes connues (pas un index absolu), robuste à d'autres
  // lignes présentes dans le tableau. 1er clic sur "Fecha" : ascendant (la colonne n'est pas déjà
  // triée dessus, cf. DataList.buildSortHref — "asc" par défaut au premier clic sur une colonne).
  async function relativeOrder() {
    const rows = await page.locator('[data-testid^="order-line-row-"]').allTextContents();
    const directIndex = rows.findIndex((text) => text.includes("Cliente Directo Seed"));
    const referredIndex = rows.findIndex((text) => text.includes("Cliente Referido Seed"));
    return { directIndex, referredIndex };
  }

  await page.getByTestId("sort-date").click();
  const ascending = await relativeOrder();
  expect(ascending.directIndex).toBeGreaterThanOrEqual(0);
  expect(ascending.referredIndex).toBeGreaterThan(ascending.directIndex);

  // Second clic sur "Fecha" : bascule vers décroissant, l'ordre relatif s'inverse.
  await page.getByTestId("sort-date").click();
  const descending = await relativeOrder();
  expect(descending.directIndex).toBeGreaterThan(descending.referredIndex);
});
