import { test, expect } from "@playwright/test";
import { resetAvailability, esperarRetornoTrasAgregar, seedDate } from "@hifago/e2e-support";

// Spec 28 Tranche 3 (cahier §2b.5) : après un ajout au panier réussi, le client revient à
// l'accueil, ses critères de recherche conservés, les sections réordonnées selon ce qu'il a déjà
// au panier — les types ABSENTS passent devant (ordre habituel), les types DÉJÀ PRÉSENTS tombent
// à la fin (ordre habituel).
//
// `ordenarTipos` (lib/catalog/ordenSecciones.ts) est déjà couverte en Vitest sans base — ce
// n'est pas la RÈGLE qu'un e2e doit reprouver ici. Ce qu'un e2e seul peut prouver : que
// `useAddToCart` (redirection immédiate), `BuscadorInicio`/`ultimosCriterios.ts` (mémorisation
// des critères), `page.tsx` (lecture du flag `desdeCarrito` + du panier réel) et `buscarSecciones`
// parlent bien tous de la MÊME chose, bout en bout.
//
// `?personas=1` plutôt qu'une recherche texte : un critère qui NE FILTRE AUCUNE section (toute
// offre accepte au moins une personne), donc les cinq sections restent visibles avant ET après le
// retour — condition nécessaire pour observer un réordonnancement, qu'une recherche texte
// discriminante aurait rendu invisible en ne laissant plus qu'une seule section à comparer.
//
// ⚠️ CE SPEC ÉCRIT AU PANIER (identité anonyme, spec 31/32) : contrairement à `home.spec.ts`, une
// exécution parallèle avec un autre spec touchant le MÊME produit/date pourrait se disputer sa
// disponibilité — `mode: "serial"` avec les autres specs de panier réel, même discipline que
// `cart-multi-establishment.spec.ts`.
test.describe.configure({ mode: "serial" });

const TOUR_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape — type "activity"
const TOUR_SLUG = "tour-lancha-guatape";
const TOUR_DATE = seedDate(7);

test("après un ajout au panier, l'accueil revient réordonnée et garde les critères de recherche", async ({
  page,
}) => {
  await resetAvailability(TOUR_ID, TOUR_DATE, { capacity: 3, booked: 0 });

  await page.goto("/es?personas=1");
  await page.waitForLoadState("networkidle");

  // Avant l'ajout : l'ordre habituel du cahier §2a, activités d'abord. On vérifie la POSITION des
  // sections, pas la présence d'une carte précise : la base locale est partagée (fixtures d'autres
  // specs), et `tour-lancha-guatape` peut tomber hors du plafond de 8 par section selon ce que
  // d'autres tests y ont créé récemment (`created_at desc`) — ce n'est pas ce que ce test prouve.
  const idsAvant = await page
    .locator("main section[data-testid]")
    .evaluateAll((nodos) => nodos.map((n) => n.getAttribute("data-testid")));
  expect(idsAvant[0]).toBe("seccion-activity");
  expect(idsAvant).toContain("seccion-lodging");

  // Navigation DIRECTE vers la fiche, plutôt qu'un clic sur sa carte (même raison que ci-dessus —
  // et même précédent que `reserve-lodging-range.spec.ts`/`reserve-lodging-pms-availability.spec.ts`,
  // qui font pareil pour ne pas dépendre du classement de l'accueil).
  await page.goto(`/es/productos/${TOUR_SLUG}`);
  // La fiche produit ne porte JAMAIS les critères dans son URL (spec 28 §4) — c'est précisément ce
  // que ce test vérifie : qu'ils reviennent quand même à l'accueil.
  await expect(page).not.toHaveURL(/personas=/);

  await page.locator(`[data-date="${TOUR_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();

  // Le retour est AUTOMATIQUE ET IMMÉDIAT (cahier §2b.5, décision Jérôme) — jamais un clic à faire.
  await esperarRetornoTrasAgregar(page);
  await expect(page).toHaveURL(/[?&]personas=1(&|$)/);
  await expect(page).toHaveURL(/[?&]desdeCarrito=1(&|$)/);

  // Le succès est enfin visible — `SiteToaster` n'était monté nulle part dans `apps/web` avant ce
  // lot (`toast.danger` de `useAddToCart` était donc lui aussi invisible jusqu'ici).
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Añadido a Mi viaje." })
  ).toBeVisible();

  await page.waitForLoadState("networkidle");

  // « Activity » — déjà au panier — est tombée à la fin ; « lodging » (absent) passe devant, dans
  // son ordre habituel (cahier §2b.5 : « absents devant, dans leur ordre habituel »).
  const idsApres = await page
    .locator("main section[data-testid]")
    .evaluateAll((nodos) => nodos.map((n) => n.getAttribute("data-testid")));
  expect(idsApres[idsApres.length - 1]).toBe("seccion-activity");
  expect(idsApres.indexOf("seccion-lodging")).toBeLessThan(idsApres.indexOf("seccion-activity"));
});
