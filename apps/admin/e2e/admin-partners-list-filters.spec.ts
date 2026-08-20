import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Revue admin partenaires (Jérôme, 2026-08-19) — filtres classiques (nom/état) de la liste
// refondue sur list_partners_admin. Jamais un test qui touche "Buscar ubicación" : convention déjà
// établie du projet (admin-partner-create.spec.ts) de ne jamais exercer le vrai widget/géocodage
// Google en e2e (no-op en local sans clé API) — la recherche géographique réelle n'est couverte
// que par pgTAP (list_partners_admin_rpc.test.sql, coordonnées fixturées directement).
// partners.status retiré le 2026-08-20 (migration 20260820050000_partners_drop_status.sql, aucun
// besoin métier au niveau du partenaire entier) : le tag "Estado" et son filtre ont disparu avec,
// le test "catalogo partenaires: filtre par estado" a été retiré entièrement (plus rien à tester).
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003"; // "Prestador Propuestas Org" (seed.sql)

test("admin ouvre /admin/partners, filtre par nom, voit la ligne attendue", async ({ page }) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/partners");
  await expect(page.locator('[data-testid^="partner-row-"]').first()).toBeVisible();

  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile — ouvrir avant d'y
  // interagir, sinon les champs sont `hidden` (Disclosure, packages/ui/data-list.tsx).
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-q").fill("Prestador Propuestas");
  await page.getByTestId("server-filters-submit").click();

  const row = page.getByTestId(`partner-row-${PARTNER_ID}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Prestador Propuestas Org");
});

test("fiche partenaire: la localisation saisie manuellement persiste après rechargement", async ({ page }) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/partners/${PARTNER_ID}`);

  // Champs texte directs, jamais le widget Google (même précédent que admin-establishment.spec.ts
  // pour l'adresse d'établissement) : set_partner_location n'a besoin que des 3 valeurs, le
  // widget n'est qu'un raccourci de saisie côté UI, pas une dépendance de la RPC elle-même.
  const marker = `QAPARTDETAIL ${Date.now()}`;
  await page.getByTestId("partner-address-input").fill(`Calle Falsa 123, ${marker}`);
  await page.getByTestId("partner-lat-input").fill("6.25184");
  await page.getByTestId("partner-lon-input").fill("-75.56359");
  await page.getByTestId("save-partner-location-button").click();

  // HeroUI rend chaque toast avec role="alertdialog" (même précédent que
  // admin-establishment-edit.spec.ts) — attendre le toast avant de recharger, sinon la sauvegarde
  // (async) peut ne pas être terminée quand reload() part.
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Ubicación actualizada." }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("partner-address-input")).toHaveValue(`Calle Falsa 123, ${marker}`);
  await expect(page.getByTestId("partner-lat-input")).toHaveValue("6.25184");
  await expect(page.getByTestId("partner-lon-input")).toHaveValue("-75.56359");
});
