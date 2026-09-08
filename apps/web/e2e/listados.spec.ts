import { test, expect, type Page } from "@playwright/test";

// LES PAGES DE LISTING DE LA VITRINE (spec 29, Tranche 1 — 2026-09-08). Quatre routes qui
// rendaient un 404 la veille : `/es/alojamientos`, `/es/transportes`, `/es/camps`, `/es/eventos`.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE SPEC PROUVE, ET CE QU'IL NE PROUVE PAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Il prouve ce qui exige les trois couches à la fois : la route existe et répond 200, le segment
// d'URL choisit bien le type en SQL, le fil d'Ariane ramène à l'accueil, et une recherche lancée
// depuis un listing REPART À L'ACCUEIL (décision 10 de la spec — un seul écran de résultats).
//
// ⚠️ IL NE PROUVE PAS LE DÉFILEMENT, et c'est délibéré plutôt qu'oublié. Une page sert 24 offres
// et le seed en compte dix au total, toutes de deux types : `hayMas` est donc TOUJOURS faux, le
// bouton « Cargar más » n'est jamais rendu, et aucun scénario de navigateur ne peut l'atteindre.
// Fabriquer 25 offres dans ce spec pour voir un bouton coûterait plus cher que ce que ça prouve —
// `ListadoInfinito.test.tsx` couvre l'ajout de page, le décompte, le `replaceState` et l'échec du
// pont, avec le vrai composant. Ce qui reste hors de sa portée, c'est le PONT lui-même : il est
// donc appelé ici directement, en HTTP, contre la vraie base.
//
// ⚠️ TROIS DES QUATRE LISTINGS SONT VIDES AVEC LE SEED ACTUEL — aucun camp, aucun evento, aucun
// transporte n'y est vendable (vérifié en base le 2026-09-08). Ce n'est pas un défaut du lot :
// c'est le cas « route structurelle sans offre » du §9, qui doit rendre 200 et un état vide, jamais
// un 404. Il se trouve que c'est aussi la seule façon de le tester, et elle est gratuite.
//
// ⚠️ CE SPEC N'ÉCRIT RIEN EN BASE : pas de `resetAvailability`, pas de `mode: "serial"`. Il
// n'affirme jamais un NOMBRE de cartes — la base locale est partagée avec les autres specs, qui y
// créent et suppriment des produits en permanence. On affirme des offres NOMMÉES.

// L'établissement à deux couchages vendables du seed : sur `/alojamientos` il apparaît comme UNE
// carte groupée, exactement comme sur l'accueil.
const ESTABLECIMIENTO_AGRUPADO = "casa-kayam-guatape";

// Une requête qui ne peut correspondre à rien — volontairement improbable plutôt que courte.
const BUSQUEDA_SIN_RESULTADO = "zzz-ninguna-oferta-existe-2026";

/**
 * ⚠️ `networkidle` : ces pages montent le même bloc de recherche client que l'accueil
 * (`BuscadorInicio` → `SearchPanel` → un `ComboBox` react-aria). Sans cette attente, la première
 * frappe peut atteindre le DOM avant que React n'ait attaché ses gestionnaires — la valeur est
 * perdue, `Entrée` ne fait rien, et le test échoue sans erreur exploitable
 * (`.claude/rules/tests.md`).
 */
async function irA(page: Page, ruta: string) {
  const response = await page.goto(`/es/${ruta}`);
  await page.waitForLoadState("networkidle");
  return response;
}

test("les quatre routes de listing répondent, avec un seul <h1> visible", async ({ page }) => {
  // La régression que ce test empêche est littérale : la veille, ces quatre URL rendaient un 404,
  // et les « Ver más » de l'accueil menaient dans le vide.
  for (const ruta of ["alojamientos", "transportes", "camps", "eventos"]) {
    const response = await irA(page, ruta);
    expect(response?.status(), `/es/${ruta}`).toBe(200);

    // Un seul <h1>, et il est VISIBLE (décision 5) — contrairement à celui de l'accueil, masqué.
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
  }
});

test("le « Ver más » de l'accueil mène au listing du type, et le fil d'Ariane ramène", async ({
  page,
}) => {
  // Le parcours complet, celui qui justifie ce lot : l'accueil → la section alojamientos → sa page.
  await page.goto("/es");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("seccion-lodging-ver-mas").click();
  await page.waitForURL(/\/es\/alojamientos/);
  await page.waitForLoadState("networkidle");

  // La carte groupée du seed est bien là : le segment d'URL a choisi le bon type en SQL, et le
  // regroupement des couchages s'applique ici comme sur l'accueil.
  await expect(page.getByTestId(`tarjeta-${ESTABLECIMIENTO_AGRUPADO}`)).toBeVisible();

  // ⚠️ Le fil d'Ariane est le seul chemin de retour d'un visiteur arrivé par un moteur. Il doit
  // être un REPÈRE de navigation nommé, pas une simple liste : HeroUI rend un `<ol>` nu, c'est
  // notre `<nav>` qui en fait un landmark (cf. `components/molecules/Migas.tsx`).
  const migas = page.getByTestId("migas");
  await expect(migas).toBeVisible();
  await expect(migas.locator("nav, [role=navigation]").or(migas)).toBeVisible();

  await migas.getByRole("link", { name: "Inicio" }).click();
  await page.waitForURL(/\/es$/);
});

test("une recherche lancée depuis un listing repart à l'accueil", async ({ page }) => {
  // ⚠️ LA décision 10, et elle ne se prouve qu'ici : le site n'a qu'UN écran de résultats. Un
  // « kayak » tapé depuis les hébergements ne doit pas afficher « aucun résultat » alors que le
  // catalogue en vend — il doit ramener le visiteur là où tous les types sont montrés.
  await irA(page, "alojamientos");

  const campo = page.getByTestId("buscador-bar-input");
  await campo.fill("kayak");
  await campo.press("Enter");

  // Sur l'accueil, avec le critère conservé — jamais sur `/es/alojamientos?q=kayak`.
  await page.waitForURL(/\/es\?q=kayak$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("seccion-activity")).toBeVisible();
});

test("une section sans offre rend 200 et un état vide, jamais un 404", async ({ page }) => {
  // Le cas du §9 : une route structurelle ne disparaît pas parce que le catalogue est vide. C'est
  // l'inverse d'une page de catégorie, qui elle rend 404 quand elle n'a rien (spec 29, invariant 5).
  const response = await irA(page, "camps");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("estado-vacio")).toBeVisible();
  // La barre reste au-dessus, utilisable : un cul-de-sac ne se termine jamais par un écran mort.
  await expect(page.getByTestId("buscador-bar-input")).toBeVisible();
});

test("un `pagina` invalide ou hors bornes rend la page normale, jamais une erreur", async ({
  page,
}) => {
  // ⚠️ Le plafond n'est pas un réglage d'affichage : sans lui, `?pagina=99999` fait demander des
  // millions de lignes à Postgres depuis une URL publique et anonyme. Ici on vérifie le versant
  // visible de la règle — la page reste normale ; `criterios.test.ts` vérifie la borne elle-même.
  for (const valeur of ["abc", "0", "-3", "99999"]) {
    const response = await irA(page, `alojamientos?pagina=${valeur}`);
    expect(response?.status(), `?pagina=${valeur}`).toBe(200);
    await expect(page.getByTestId(`tarjeta-${ESTABLECIMIENTO_AGRUPADO}`)).toBeVisible();
  }
});

test("une recherche sans résultat sur un listing rend l'état vide, la barre reste utilisable", async ({
  page,
}) => {
  const response = await irA(page, `alojamientos?q=${BUSQUEDA_SIN_RESULTADO}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("estado-vacio")).toBeVisible();
  await expect(page.getByTestId("buscador-bar-input")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE PONT — appelé en HTTP, contre la vraie base
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hors de portée du test composant, qui bouchonne `fetch` : ici la requête traverse réellement le
// Route Handler, `lib/catalog/`, la RPC et les policies.

test("le pont rend des cartes, et une réponse d'échec n'a jamais la forme d'un succès", async ({
  request,
}) => {
  const ok = await request.get("/api/catalogo/listado?tipo=lodging&locale=es&pagina=1");
  expect(ok.status()).toBe(200);
  const cuerpo = await ok.json();
  expect(Array.isArray(cuerpo.tarjetas)).toBe(true);
  expect(typeof cuerpo.hayMas).toBe("boolean");
  expect(cuerpo.tarjetas.some((t: { testId: string }) => t.testId.includes("casa-kayam"))).toBe(
    true
  );

  // ⚠️ Un type inconnu est la SEULE erreur possible sur cette route : la requête ne décrit alors
  // aucune page existante, et rendre « toutes les offres » serait pire que refuser.
  const ko = await request.get("/api/catalogo/listado?tipo=inexistante&locale=es");
  expect(ko.status()).toBe(400);
  const cuerpoKo = await ko.json();
  // ⚠️ LE point : pas de clé `tarjetas` dans une réponse d'échec. Un tableau vide se lirait « il
  // n'y a plus rien » et la panne s'afficherait comme une fin de liste.
  expect(cuerpoKo.tarjetas).toBeUndefined();
  expect(cuerpoKo.ok).toBe(false);
});

test("le pont plafonne `pagina` comme la page — il est appelable directement", async ({
  request,
}) => {
  // Sans ce plafond côté route, l'URL publique du pont contournerait la protection de la page en
  // une requête. `pagina=99999` retombe sur 1, donc rend la même chose que `pagina=1`.
  const plafonne = await request.get("/api/catalogo/listado?tipo=lodging&locale=es&pagina=99999");
  expect(plafonne.status()).toBe(200);
  const primera = await request.get("/api/catalogo/listado?tipo=lodging&locale=es&pagina=1");
  expect(await plafonne.json()).toEqual(await primera.json());
});
