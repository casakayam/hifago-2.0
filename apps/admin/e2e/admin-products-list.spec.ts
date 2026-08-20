import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 2, 2e écran pilote) — /admin/products
// sur DataList, 1er vrai passage du `Table` compound HeroUI. Produit seedé stable
// (supabase/seed.sql, "Tour en lancha por el Embalse de Guatapé", activity) ciblé par son nom via
// le filtre `q`, jamais par une position de page — robuste au volume croissant du catalogue.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001";

test("admin ouvre /admin/products, filtre par nom et par tipo, voit Ver/Editar (pas Eliminar en liste)", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/products");
  await expect(page.locator('[data-testid^="product-row-"]').first()).toBeVisible();

  await page.getByTestId("filter-q").fill("Tour en lancha");
  await page.getByTestId("server-filters-submit").click();

  const row = page.getByTestId(`product-row-${PRODUCT_ID}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Tour en lancha por el Embalse de Guatapé");

  // Ver/Editar — liens vers la bonne fiche, sans naviguer. Pas d'Eliminar sur la liste (décision
  // Jérôme : action destructive réservée à la fiche détail, /admin/products/[id]).
  await expect(page.getByTestId(`product-detail-link-${PRODUCT_ID}`)).toHaveAttribute(
    "href",
    `/admin/products/${PRODUCT_ID}`
  );
  await expect(page.getByTestId(`product-edit-link-${PRODUCT_ID}`)).toHaveAttribute(
    "href",
    `/admin/products/${PRODUCT_ID}/edit`
  );
  await expect(page.getByTestId(`delete-product-button-${PRODUCT_ID}`)).toHaveCount(0);

  // Le filtre "Tipo" préserve le filtre texte déjà actif (form GET unique, ServerFilters).
  await page.getByTestId("filter-type").click();
  await page.getByRole("option", { name: "activity" }).click();
  await page.getByTestId("server-filters-submit").click();
  await expect(row).toBeVisible();
  await expect(page.getByTestId("filter-q")).toHaveValue("Tour en lancha");

  // Revue admin catalogo (Jérôme, 2026-08-19) — état en tag coloré (pas de texte brut) : ce
  // produit est sellable=true dans le seed.
  await expect(page.getByTestId(`product-sellable-${PRODUCT_ID}`)).toContainText("Publicado");
});

test("catalogo: filtre par establecimiento retrouve le produit rattaché", async ({ page }) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/products");

  // "Tour en lancha por el Embalse de Guatapé" appartient à "Casa Kayam Guatapé" (seed.sql) —
  // filtre nouveau (jamais présent avant ce lot), jamais un filtre texte sur le nom d'établissement
  // : establishment_id est une vraie colonne FK sur products, filtrée par un simple .eq() côté
  // page.tsx, pas de RPC ni de contournement PostgREST nécessaire ici.
  await page.getByTestId("filter-establishment_id").click();
  await page.getByRole("option", { name: "Casa Kayam Guatapé" }).click();
  await page.getByTestId("server-filters-submit").click();

  await expect(page.getByTestId(`product-row-${PRODUCT_ID}`)).toBeVisible();
});

test("catalogo: le champ texte establecimiento retrouve un établissement absent du dropdown plafonné à 10", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Navigation directe par URL (pas d'interaction dropdown) : preuve indépendante de la requête
  // .ilike() côté serveur, sans dépendre de si "Casa Kayam Guatapé" figure ou non parmi les 10
  // établissements affichés dans le dropdown au moment du run (liste dynamique, en croissance
  // continue sur cette instance locale — cf. aléa déjà consigné suite 12).
  await page.goto("/admin/products?establishment_q=Casa+Kayam");

  await expect(page.getByTestId(`product-row-${PRODUCT_ID}`)).toBeVisible();
  await expect(page.getByTestId("filter-establishment_q")).toHaveValue("Casa Kayam");
});
