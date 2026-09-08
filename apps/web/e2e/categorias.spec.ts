import { test, expect, type Page } from "@playwright/test";

// L'INDEX DE CATÉGORIES ET LES PAGES DE CATÉGORIE (spec 29, Tranche 2 — 2026-09-08).
// `/es/actividades`, `/es/actividades/[tag]` et `/es/actividades/otras`.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'IL PROUVE, ET POURQUOI ÇA NE PEUT PAS SE PROUVER PLUS BAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Deux règles du cahier §2a ne vivent NI dans un composant NI dans une seule requête :
//
//   • « seuls les tags portant au moins une offre publiée y figurent — un tag vide produirait une
//     page vide que Google indexerait ». Elle se joue en SQL (`search_catalog_tags`), et son
//     versant visible est qu'une catégorie absente de l'index rend AUSSI 404 sur sa page. Les deux
//     moitiés doivent s'accorder, et seul un e2e le voit.
//   • « la page des activités est un index de sous-catégories, sans produit ; on y clique pour
//     atteindre la liste des offres d'un tag ». C'est un parcours à deux écrans.
//
// Le reste — l'aplat sans image, le bloc absent sans texte, l'ordre alphabétique — est couvert par
// les tests de composant et par `buscar.test.ts`. Rien n'est re-prouvé ici.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES DONNÉES DU SEED, ET CE QUE CHACUNE EXERCE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//   `deportes-nauticos`  2 offres (kayak + lancha)      → une tuile qui compte plusieurs offres
//   `naturaleza`         1 offre  (caminata)            → une tuile ordinaire
//   `cultura`            1 offre NON VENDABLE           → ABSENTE : le prédicat `sellable` s'applique
//   `gastronomia`        aucune offre                   → ABSENTE : la règle du cahier §2a
//   « Otras »            1 activité sans aucun tag      → la tuile de rattrapage (décision 1)
//
// ⚠️ CE SPEC N'ÉCRIT RIEN EN BASE, et n'affirme jamais un NOMBRE de tuiles : la base locale est
// partagée avec les autres specs, qui y créent et suppriment des produits en permanence. On
// affirme des catégories NOMMÉES, présentes ou absentes.

const CAT_NAUTICOS = "deportes-nauticos";
const CAT_NATURALEZA = "naturaleza";
const CAT_SIN_OFERTA = "gastronomia";
const CAT_SOLO_NO_VENDIBLE = "cultura";
const ACTIVIDAD_KAYAK = "kayak-embalse-guatape";
const ACTIVIDAD_SIN_TAG = "taller-ceramica-zocalos";

/** ⚠️ `networkidle` : ces pages montent le bloc de recherche client (cf. `listados.spec.ts`). */
async function irA(page: Page, ruta: string) {
  const response = await page.goto(`/es/${ruta}`);
  await page.waitForLoadState("networkidle");
  return response;
}

test("l'index montre les catégories qui ont une offre, et SEULEMENT celles-là", async ({ page }) => {
  const response = await irA(page, "actividades");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId(`categoria-${CAT_NAUTICOS}`)).toBeVisible();
  await expect(page.getByTestId(`categoria-${CAT_NATURALEZA}`)).toBeVisible();

  // ⚠️ LES DEUX ABSENCES, et ce sont elles qui comptent. `gastronomia` n'a aucune offre ;
  // `cultura` n'en a qu'une NON VENDABLE. Le cahier §2a interdit les deux : « un tag vide
  // produirait une page vide que Google indexerait ».
  await expect(page.getByTestId(`categoria-${CAT_SIN_OFERTA}`)).toHaveCount(0);
  await expect(page.getByTestId(`categoria-${CAT_SOLO_NO_VENDIBLE}`)).toHaveCount(0);

  // ⚠️ L'index ne liste AUCUNE offre — c'est ce qui le distingue des cinq autres routes.
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toHaveCount(0);

  // Un seul <h1>, et VISIBLE (décision 5).
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toBeVisible();
});

test("la tuile « Otras actividades » rattrape ce qu'aucune catégorie ne classe", async ({ page }) => {
  // La décision 1 : une offre publiée ne doit jamais devenir invisible depuis la navigation par
  // catégorie sous prétexte que personne ne l'a rangée.
  await irA(page, "actividades");
  await expect(page.getByTestId("categoria-otras")).toBeVisible();

  await page.getByTestId("categoria-otras-link").click();
  await page.waitForURL(/\/es\/actividades\/otras/);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_SIN_TAG}`)).toBeVisible();
  // …et elle ne montre QUE des offres non classées : le kayak est dans une catégorie.
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toHaveCount(0);
});

test("cliquer une catégorie mène à ses offres, et le fil d'Ariane remonte à l'index", async ({
  page,
}) => {
  await irA(page, "actividades");
  await page.getByTestId(`categoria-${CAT_NAUTICOS}`).getByRole("link").first().click();
  await page.waitForURL(new RegExp(`/es/actividades/${CAT_NAUTICOS}`));
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
  // Le texte éditorial de la catégorie : le SEUL contenu rédactionnel indexable de cette page
  // (décision 7). Sans lui elle n'aurait que des cartes, comme des milliers d'autres.
  await expect(page.getByTestId("categoria-descripcion")).toBeVisible();

  // ⚠️ Trois niveaux ici, contre deux sur un listing, et le dernier n'est pas NAVIGABLE.
  //
  // ⚠️ On compte `a[href]`, PAS `getByRole("link")`, et la différence est un constat réel du
  // design system : HeroUI rend la page courante en `<span role="link" aria-disabled="true"
  // aria-current="page">`. Elle porte donc le rôle « lien » sans en être un — un lecteur d'écran
  // annonce « lien désactivé », ce que le motif WAI-ARIA du fil d'Ariane déconseille. Le
  // `aria-current` est correct et c'est lui qui compte ; le reste est le comportement du socle, on
  // le documente sans le contourner (porté au backlog).
  const migas = page.getByTestId("migas");
  await expect(migas.locator("a[href]")).toHaveCount(2);
  await expect(migas.locator('[aria-current="page"]')).toHaveCount(1);
  await migas.getByRole("link", { name: "Actividades" }).click();
  await page.waitForURL(/\/es\/actividades$/);
});

test("le « Ver más » des activités mène à l'index, pas à une liste d'offres", async ({ page }) => {
  // ⚠️ Le libellé de ce lien DIFFÈRE des quatre autres (`verMasTags`) précisément parce que sa
  // destination diffère : il promettrait sinon une liste et donnerait un index.
  await page.goto("/es");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("seccion-activity-ver-mas").click();
  await page.waitForURL(/\/es\/actividades/);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId(`categoria-${CAT_NAUTICOS}`)).toBeVisible();
});

test("une catégorie sans offre publiée rend 404, jamais une page vide indexable", async ({
  page,
}) => {
  // ⚠️ LE pendant de l'absence dans l'index, et les deux doivent s'accorder : une catégorie qu'on
  // ne montre pas ne doit pas rester atteignable par son URL. C'est exactement ce que le cahier
  // §2a veut éviter — une page vide que Google indexerait.
  const sansOffre = await page.goto(`/es/actividades/${CAT_SIN_OFERTA}`);
  expect(sansOffre?.status(), "catégorie existante mais sans offre publiée").toBe(404);

  const nonVendable = await page.goto(`/es/actividades/${CAT_SOLO_NO_VENDIBLE}`);
  expect(nonVendable?.status(), "catégorie dont la seule offre n'est pas vendable").toBe(404);

  const inconnue = await page.goto("/es/actividades/zzz-categoria-inexistente");
  expect(inconnue?.status(), "slug inconnu").toBe(404);
});

test("les critères de recherche filtrent les tuiles — une tuile ne mène jamais à une page vide", async ({
  page,
}) => {
  // ⚠️ LA décision 3. `naturaleza` ne porte qu'une caminata, qui ne répond pas à « kayak » : sa
  // tuile doit disparaître, sinon le visiteur cliquerait pour arriver sur « aucun résultat ».
  const response = await irA(page, "actividades?q=kayak");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId(`categoria-${CAT_NAUTICOS}`)).toBeVisible();
  await expect(page.getByTestId(`categoria-${CAT_NATURALEZA}`)).toHaveCount(0);

  // Et les critères suivent la tuile vers sa liste (cahier §2a : « les critères se conservent »).
  await page.getByTestId(`categoria-${CAT_NAUTICOS}`).getByRole("link").first().click();
  await page.waitForURL(/q=kayak/);
});

test("une recherche sans résultat dans une catégorie VIVANTE rend 200, pas 404", async ({
  page,
}) => {
  // ⚠️ La distinction que la page doit tenir, et qui n'est évidente qu'écrite : une catégorie qui
  // n'existe plus rend 404 ; une catégorie bien vivante dont le filtre ne laisse rien rend 200 avec
  // un état vide. Sans elle, un lien partagé portant des dates deviendrait mort.
  const response = await irA(
    page,
    `actividades/${CAT_NAUTICOS}?q=zzz-ninguna-oferta-existe-2026`
  );
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("estado-vacio")).toBeVisible();
  await expect(page.getByTestId("buscador-bar-input")).toBeVisible();
});
