import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Refonte vue référent (2026-08-20, docs/specs/22-vue-referent-restreinte.md) — un référent pur
// (aucune capacité operator, quel que soit son statut) n'a rien à faire sur "Mi establecimiento y
// actividades"/"Mis reservas" : ses ventes attribuées vivent sur /partner/commissions (déjà couvert
// par partner-commissions.spec.ts/partner-qr-tool.spec.ts). "referent.actif" (SEEDED_ACCOUNTS) est
// le seul compte seedé avec exactement une capacité referrer et aucune operator (supabase/seed.sql,
// grep confirmé — le seul insert 'operator' du seed cible b0000000-...-0003, un autre partenaire).
test("un référent pur ne voit pas Mi establecimiento/Mis reservas dans la nav, et l'accès direct par URL redirige", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  await page.goto("/partner");

  await expect(page.getByTestId("partner-nav-link--partner")).toBeVisible();
  await expect(page.getByTestId("partner-nav-link--partner-commissions")).toBeVisible();
  await expect(page.getByTestId("partner-nav-link--partner-tools")).toBeVisible();
  await expect(page.getByTestId("partner-nav-link--partner-account")).toBeVisible();
  await expect(page.getByTestId("partner-nav-link--partner-establishment")).toHaveCount(0);
  await expect(page.getByTestId("partner-nav-link--partner-reservations")).toHaveCount(0);

  // Garde serveur réelle, pas juste un lien masqué — l'accès direct par URL redirige vers /partner.
  await page.goto("/partner/establishment");
  await expect(page).toHaveURL(/\/partner$/);

  await page.goto("/partner/reservations");
  await expect(page).toHaveURL(/\/partner$/);
});

// Symétrique : un compte qui cumule les deux capacités (operator + referrer) garde la nav complète
// — ce lot ne doit rien fermer pour lui. "operador.propuestas" (SEEDED_ACCOUNTS) est déjà utilisé
// avec ce rôle double par partner-reservations.spec.ts/partner-commissions.spec.ts.
test("un compte operator+referrer garde la nav complète", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner");

  await expect(page.getByTestId("partner-nav-link--partner-establishment")).toBeVisible();
  await expect(page.getByTestId("partner-nav-link--partner-reservations")).toBeVisible();
  await expect(page.getByTestId("partner-nav-link--partner-commissions")).toBeVisible();
});

// Refonte responsive mobile (AppNavShell, packages/ui) — même filtrage referrer/operator que les
// deux tests desktop ci-dessus, dans le panneau plein écran mobile (390×844,
// .claude/skills/hifago-ui/SKILL.md). Aucun projet Playwright mobile configuré — viewport posé
// manuellement.
test.describe("filtrage referrer/operator dans le panneau de nav mobile", () => {
  const MOBILE_VIEWPORT = { width: 390, height: 844 };

  test("un référent pur ne voit pas Mi establecimiento/Mis reservas dans le panneau mobile", async ({
    page,
    context,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
    await page.goto("/partner");
    await page.getByTestId("partner-mobile-nav-trigger").click();

    await expect(page.getByTestId("partner-mobile-nav-link--partner")).toBeVisible();
    await expect(page.getByTestId("partner-mobile-nav-link--partner-commissions")).toBeVisible();
    await expect(page.getByTestId("partner-mobile-nav-link--partner-tools")).toBeVisible();
    await expect(page.getByTestId("partner-mobile-nav-link--partner-account")).toBeVisible();
    await expect(page.getByTestId("partner-mobile-nav-link--partner-establishment")).toHaveCount(0);
    await expect(page.getByTestId("partner-mobile-nav-link--partner-reservations")).toHaveCount(0);
  });

  test("un compte operator+referrer garde le panneau mobile complet", async ({ page, context }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
    await page.goto("/partner");
    await page.getByTestId("partner-mobile-nav-trigger").click();

    await expect(page.getByTestId("partner-mobile-nav-link--partner-establishment")).toBeVisible();
    await expect(page.getByTestId("partner-mobile-nav-link--partner-reservations")).toBeVisible();
    await expect(page.getByTestId("partner-mobile-nav-link--partner-commissions")).toBeVisible();
  });
});
