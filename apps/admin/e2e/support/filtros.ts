import type { Page } from "@playwright/test";

/**
 * Ouvre le panneau de filtres d'un écran `ServerFilters`, en attendant que la page soit HYDRATÉE.
 *
 * ⚠️ POURQUOI CE HELPER EXISTE (2026-09-08). `ServerFilters` est un `<form method="GET">` à
 * soumission NATIVE : chaque « server-filters-submit » recharge entièrement la page et referme le
 * panneau. Le clic suivant sur « filters-toggle » atteignait donc un bouton déjà présent dans le
 * HTML servi, mais dont React n'avait pas encore attaché le gestionnaire — visuellement
 * actionnable, sans effet, aucune erreur. Le test échouait 30 secondes plus tard sur le champ de
 * filtre resté INVISIBLE, ce qui pointe vers le mauvais coupable.
 *
 * Le premier clic passait toujours (la page était chargée depuis longtemps), le second jamais :
 * c'est ce décalage qui rendait le défaut si difficile à lire. Cinq specs échouaient ainsi
 * (`admin-products-list`, `admin-orders-list`, `admin-home-navigation`, `admin-partner-registry`,
 * `partner-commissions`).
 *
 * C'est le piège nommé dans `.claude/rules/tests.md` — « écran client-heavy après une navigation » —
 * appliqué à un rechargement complet. Le helper existe pour qu'on ne le réapprenne pas écran par
 * écran : `abrirFiltros(page)` remplace `page.getByTestId("filters-toggle").click()`.
 */
export async function abrirFiltros(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.getByTestId("filters-toggle").click();
}
