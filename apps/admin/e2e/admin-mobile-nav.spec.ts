import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";
import { getAdminNavItems } from "../app/admin/nav-items";

// Refonte responsive mobile (AppNavShell, packages/ui) — /admin n'avait jusqu'ici aucun
// comportement mobile testé (AdminSidebar.tsx, aucun panneau, aucun testid mobile n'existait).
// Viewport posé manuellement (390×844, .claude/skills/hifago-ui/SKILL.md) : aucun projet
// Playwright mobile n'est configuré (apps/admin/playwright.config.ts, un seul projet chromium
// desktop).
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Dérivé de getAdminNavItems (source unique) plutôt que recopié en dur — sinon un renommage/ajout
// de lien passe ce test sans jamais le faire échouer, silencieusement désynchronisé.
const ADMIN_NAV_HREFS = getAdminNavItems(0).map((item) => item.href);

test("sur mobile, la sidebar devient un bouton en haut à droite qui déplie un panneau plein écran", async ({
  page,
  context,
}) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await expect(page.getByTestId("admin-sidebar")).not.toBeVisible();
  await expect(page.getByTestId("admin-mobile-nav-trigger")).toBeVisible();
  await expect(page.getByTestId("admin-mobile-nav-title")).toHaveText("Inicio");

  await page.getByTestId("admin-mobile-nav-trigger").click();
  for (const href of ADMIN_NAV_HREFS) {
    await expect(page.getByTestId(`admin-mobile-nav-link-${href.replace(/\//g, "-")}`)).toBeVisible();
  }

  await page.getByTestId("admin-mobile-nav-link--admin-partners").click();
  await expect(page).toHaveURL(/\/admin\/partners$/);
  // Le panneau se ferme à la navigation (onClick explicite + filet pathname pour retour/avance) —
  // vérifié en constatant que le lien n'est plus visible (panneau refermé), pas juste que l'URL a
  // changé.
  await expect(page.getByTestId("admin-mobile-nav-link--admin-partners")).not.toBeVisible();
  await expect(page.getByTestId("admin-mobile-nav-title")).toHaveText("Partners");
});

// Même invariant que "la sidebar affiche une pastille..." (admin-home-navigation.spec.ts), pour la
// variante mobile de la pastille — lu en base plutôt que fixturé (RPC-only en écriture, pas de
// moyen simple de forcer un total précis sans passer par le vrai flux socio de proposition) :
// robuste à l'état réel de l'instance locale partagée, jamais un nombre en dur.
test("le panneau mobile affiche la même pastille de propuestas pendientes que la sidebar desktop", async ({
  page,
  context,
}) => {
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const [{ count: productPending }, { count: establishmentPending }] = await Promise.all([
    adminClient.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    adminClient
      .from("establishment_proposals")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  const expectedCount = (productPending ?? 0) + (establishmentPending ?? 0);

  await page.setViewportSize(MOBILE_VIEWPORT);
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");
  await page.getByTestId("admin-mobile-nav-trigger").click();

  const badge = page.getByTestId("sidebar-proposals-badge-mobile");
  if (expectedCount === 0) {
    await expect(badge).toHaveCount(0);
    return;
  }
  await expect(badge).toHaveText(String(expectedCount));
});
