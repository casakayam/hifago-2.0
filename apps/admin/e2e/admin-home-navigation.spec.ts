import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature 27 (docs/specs/02-admin-accueil-et-navigation.md) — jusqu'ici /admin ne faisait qu'une
// redirection vide et aucune sidebar n'existait : plusieurs écrans étaient injoignables sans
// connaître leur URL. Invariant §8 de la spec : un item de sidebar ne pointe jamais vers une
// route inexistante — testé ici par navigation directe (pas .click()) sur chaque href, un flake
// de clic déjà documenté ailleurs dans ce repo (hifago/CLAUDE.md §11) ne doit pas polluer ce test
// précis, dont le seul objet est l'existence de la route.
const SIDEBAR_ROUTES = [
  "/admin",
  "/admin/partners",
  "/admin/establishments",
  "/admin/orders",
  "/admin/clients",
  "/admin/products",
  "/admin/tags",
  "/admin/campaigns",
  "/admin/invitations",
  "/admin/proposals",
  "/admin/reconciliation",
];

test("cada route de la sidebar resuelve sin 404", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  for (const route of SIDEBAR_ROUTES) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} debería responder 200`).toBe(200);
    await expect(page.getByTestId("admin-sidebar"), `${route} debería mostrar la sidebar`).toBeVisible();
  }
});

test("la sidebar surligne el enlace activo y un clic navega de verdad", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await expect(page.getByTestId("sidebar-link--admin")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("sidebar-link--admin-clients").click();
  await expect(page).toHaveURL(/\/admin\/clients$/);
  await expect(page.getByTestId("sidebar-link--admin-clients")).toHaveAttribute("aria-current", "page");
});

test("inicio muestra los KPIs, las alertas y los 4 gráficos", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await expect(page.getByTestId("kpi-revenue")).toBeVisible();
  await expect(page.getByTestId("kpi-commissions")).toBeVisible();
  await expect(page.getByTestId("kpi-establishments")).toBeVisible();
  await expect(page.getByTestId("kpi-pending-orders")).toBeVisible();

  await expect(page.getByTestId("chart-sales")).toBeVisible();
  await expect(page.getByTestId("chart-commissions")).toBeVisible();
  await expect(page.getByTestId("chart-top-partners")).toBeVisible();
  await expect(page.getByTestId("chart-catalog-health")).toBeVisible();

  // Comisiones toujours qualifiées "generadas" (constat 1 de la spec, jamais "a pagar" tant que
  // le ledger n'existe pas côté hifago) — invariant explicite §8, vérifié dans le libellé réel.
  await expect(page.getByTestId("kpi-commissions")).toContainText("Comisiones generadas");
});

test("ventana de 90 días cambia la URL y sigue renderizando los gráficos", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await page.getByTestId("window-90").click();
  await expect(page).toHaveURL(/\/admin\?window=90$/);
  await expect(page.getByTestId("chart-sales")).toBeVisible();
});

test("clientes: filtro por texto y por email, paginación presente", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/clients");

  await expect(page.getByTestId("pagination")).toBeVisible();

  await page.getByTestId("clients-search-input").fill("Cliente Referido");
  await page.getByTestId("clients-search-submit").click();
  await expect(page).toHaveURL(/\?q=Cliente\+Referido/);
  const rows = page.locator('[data-testid^="client-row-"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Cliente Referido Seed");

  // Filtre email sans résultat → état vide explicite, pas un tableau resté sur l'ancien résultat
  // (cas limite §9 de la spec).
  await page.goto("/admin/clients?email=no-existe-en-absoluto@example.com");
  await expect(page.getByText("Ningún cliente encontrado.")).toBeVisible();
});

test("las listas paginadas ya existentes tienen los controles de paginación", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  for (const route of ["/admin/partners", "/admin/establishments", "/admin/orders", "/admin/products"]) {
    await page.goto(route);
    await expect(page.getByTestId("pagination"), `${route} debería paginar`).toBeVisible();
  }
});
