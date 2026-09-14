import { test, expect, type Page } from "@playwright/test";

// L'INDEX DE CATÉGORIES ET LES PAGES DE CATÉGORIE (spec 29, généralisée 2026-09-14 — chantier
// "catégories partout"). `/es/actividades`, `/es/actividades/[categoria]` et `/es/actividades/otras`.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUI A CHANGÉ DEPUIS LA VERSION PRÉCÉDENTE DE CE FICHIER
// ─────────────────────────────────────────────────────────────────────────────────────────────
// L'index ne montre plus des TUILES vides (image + nom, aucune offre) qu'on cliquait pour
// atteindre la liste : chaque catégorie est maintenant une SECTION « comme l'accueil »
// (`SeccionOfertas`) — un titre, un aperçu de ses offres, un « Ver más » qui ne se rend QUE si la
// catégorie en a plus que ce qu'elle montre (`mostrarVerMas`). Conséquences directes sur ce spec :
//   • une carte d'offre EST maintenant visible sur l'index (l'inverse de l'ancien comportement) ;
//   • une catégorie n'est plus cliquable comme un tout — seules ses cartes et son éventuel
//     « Ver más » le sont ; aucune fixture actuelle du seed ne dépasse le plafond par catégorie
//     (6), donc rien ici ne clique un « Ver más » — cette navigation est prouvée par
//     `SeccionOfertas.test.tsx` (le lien ne se rend que si `mostrarVerMas`) et par les tests de
//     la page de catégorie ci-dessous, atteints par URL directe comme le fait déjà le test 404.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'IL PROUVE, ET POURQUOI ÇA NE PEUT PAS SE PROUVER PLUS BAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Deux règles du cahier §2a ne vivent NI dans un composant NI dans une seule requête :
//
//   • « seuls les tags portant au moins une offre publiée y figurent — un tag vide produirait une
//     page vide que Google indexerait ». Elle se joue en SQL (`search_catalog_categorias`), et son
//     versant visible est qu'une catégorie absente de l'index rend AUSSI 404 sur sa page. Les deux
//     moitiés doivent s'accorder, et seul un e2e le voit.
//   • Le fil d'Ariane et le texte éditorial d'une page de catégorie ne se prouvent qu'en y arrivant
//     réellement rendue.
//
// Le reste — l'aplat sans image, le bloc absent sans texte, l'ordre alphabétique, le « Ver más »
// conditionnel — est couvert par les tests de composant et par `buscar.test.ts`. Rien n'est
// re-prouvé ici.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES DONNÉES DU SEED, ET CE QUE CHACUNE EXERCE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//   `deportes-nauticos`  2 offres (kayak + lancha)      → une catégorie ordinaire, sous le plafond
//   `naturaleza`         1 offre  (caminata)             → une catégorie ordinaire
//   `cultura`            1 offre NON VENDABLE            → ABSENTE : le prédicat `sellable` s'applique
//   `gastronomia`        aucune offre                    → ABSENTE : la règle du cahier §2a
//   « Otras »            1 activité sans aucun tag       → la catégorie de rattrapage (décision 1)
//
// ⚠️ CE SPEC N'ÉCRIT RIEN EN BASE, et n'affirme jamais un NOMBRE de catégories : la base locale est
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

test("l'index montre les catégories qui ont une offre — avec un aperçu de leurs offres — et SEULEMENT celles-là", async ({
  page,
}) => {
  const response = await irA(page, "actividades");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId(`categoria-${CAT_NAUTICOS}`)).toBeVisible();
  await expect(page.getByTestId(`categoria-${CAT_NATURALEZA}`)).toBeVisible();

  // ⚠️ LES DEUX ABSENCES, et ce sont elles qui comptent. `gastronomia` n'a aucune offre ;
  // `cultura` n'en a qu'une NON VENDABLE. Le cahier §2a interdit les deux : « un tag vide
  // produirait une page vide que Google indexerait ».
  await expect(page.getByTestId(`categoria-${CAT_SIN_OFERTA}`)).toHaveCount(0);
  await expect(page.getByTestId(`categoria-${CAT_SOLO_NO_VENDIBLE}`)).toHaveCount(0);

  // ⚠️ L'index montre maintenant un APERÇU DES OFFRES de chaque catégorie — comme l'accueil,
  // section par section — ce qui distingue ce lot de la version précédente (tuiles vides).
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();

  // Un seul <h1>, et VISIBLE (décision 5).
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toBeVisible();
});

test("la catégorie « Otras actividades » rattrape ce qu'aucune catégorie ne classe", async ({ page }) => {
  // La décision 1 : une offre publiée ne doit jamais devenir invisible depuis la navigation par
  // catégorie sous prétexte que personne ne l'a rangée. Sous le plafond par catégorie, elle
  // apparaît directement dans sa section de l'index — pas besoin de cliquer pour la voir.
  await irA(page, "actividades");
  await expect(page.getByTestId("categoria-otras")).toBeVisible();
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_SIN_TAG}`)).toBeVisible();

  // Sa section ne montre QUE des offres non classées : le kayak est dans une catégorie, donc
  // absent de la section « Otras ».
  const seccionOtras = page.getByTestId("categoria-otras");
  await expect(seccionOtras.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toHaveCount(0);
});

test("la page dédiée d'une catégorie montre ses offres, et le fil d'Ariane remonte à l'index", async ({
  page,
}) => {
  // ⚠️ Atteinte par URL directe, pas par clic : aucune fixture du seed ne dépasse le plafond par
  // catégorie (6 offres), donc son « Ver más » ne se rend jamais sur CET écran (comportement
  // voulu, prouvé par `SeccionOfertas.test.tsx`). C'est la même route qu'un « Ver más » ouvrirait.
  const response = await page.goto(`/es/actividades/${CAT_NAUTICOS}`);
  await page.waitForLoadState("networkidle");
  expect(response?.status()).toBe(200);

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

test("les critères de recherche filtrent les sections — une catégorie absente n'y figure plus", async ({
  page,
}) => {
  // ⚠️ LA décision 3. `naturaleza` ne porte qu'une caminata, qui ne répond pas à « kayak » : sa
  // section doit disparaître, sinon le visiteur verrait une catégorie dont l'unique offre ne
  // correspond pas à sa recherche.
  const response = await irA(page, "actividades?q=kayak");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId(`categoria-${CAT_NAUTICOS}`)).toBeVisible();
  await expect(page.getByTestId(`categoria-${CAT_NATURALEZA}`)).toHaveCount(0);

  // Et les critères suivent vers la page dédiée (cahier §2a : « les critères se conservent »),
  // atteinte ici par URL directe — cf. note du test précédent sur l'absence de « Ver más ».
  const dansLaCategorie = await page.goto(`/es/actividades/${CAT_NAUTICOS}?q=kayak`);
  await page.waitForLoadState("networkidle");
  expect(dansLaCategorie?.status()).toBe(200);
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
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
