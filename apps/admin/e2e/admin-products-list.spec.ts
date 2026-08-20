import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

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

  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile — ServerFilters est
  // un <form method="GET"> à soumission native, chaque "server-filters-submit" recharge la page et
  // referme le panneau : réouvrir avant chaque interaction suivante.
  await page.getByTestId("filters-toggle").click();
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
  await page.getByTestId("filters-toggle").click();
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
  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile.
  await page.getByTestId("filters-toggle").click();
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

test("catalogo: filtre par etiqueta retrouve uniquement les productos taggés", async ({
  page,
}) => {
  // Revue admin étiquettes (Jérôme, 2026-08-20) — filtre neuf, utilisable directement sur
  // /admin/products (pas seulement via "Ver" depuis /admin/tags, cf. admin-tags-catalog.spec.ts).
  // Produit/tag dédiés (jamais un tag partagé par d'autres specs, cf. admin-product-tags.spec.ts) :
  // deux produits, un seul taggé, pour prouver que le filtre exclut bien l'autre.
  const suffix = Date.now();
  const slug = `tags-filter-${suffix}`;
  const tagLabel = `Etiqueta Filtro ${suffix}`;
  const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
  const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: taggedProduct, error: taggedError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Con Etiqueta ${suffix}` },
      price_cop: 50000,
      sellable: true,
      slug,
    })
    .select("id")
    .single();
  if (taggedError || !taggedProduct) {
    throw new Error(`e2e setup: création du produit taggé a échoué : ${taggedError?.message}`);
  }

  const { data: untaggedProduct, error: untaggedError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Sin Etiqueta ${suffix}` },
      price_cop: 50000,
      sellable: true,
      slug: `${slug}-sin-tag`,
    })
    .select("id")
    .single();
  if (untaggedError || !untaggedProduct) {
    throw new Error(`e2e setup: création du produit non taggé a échoué : ${untaggedError?.message}`);
  }

  const { data: tag, error: tagError } = await adminClient
    .from("catalog_tags")
    .insert({ label: { es: tagLabel }, slug: `${slug}-tag` })
    .select("id")
    .single();
  if (tagError || !tag) {
    throw new Error(`e2e setup: création du tag a échoué : ${tagError?.message}`);
  }

  const { error: assignError } = await adminClient
    .from("product_tag_assignments")
    .insert({ product_id: taggedProduct.id, tag_id: tag.id });
  if (assignError) {
    throw new Error(`e2e setup: assignation du tag a échoué : ${assignError.message}`);
  }

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  // Scopé par q (même précaution que pour établissement) : cherche large sur "suffix" plutôt que
  // de dépendre de la position des 2 produits dans une page 1 partagée par d'autres sessions.
  await page.goto(`/admin/products?q=${suffix}`);
  await expect(page.getByTestId(`product-row-${taggedProduct.id}`)).toBeVisible();
  await expect(page.getByTestId(`product-row-${untaggedProduct.id}`)).toBeVisible();

  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile.
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-tag_id").click();
  await page.getByRole("option", { name: tagLabel }).click();
  await page.getByTestId("server-filters-submit").click();

  await expect(page.getByTestId(`product-row-${taggedProduct.id}`)).toBeVisible();
  await expect(page.getByTestId(`product-row-${untaggedProduct.id}`)).toHaveCount(0);
});
