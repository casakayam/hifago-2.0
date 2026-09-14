import type { Page } from "@playwright/test";

// Spec 28 Tranche 3 (2026-09-13) : un ajout au panier réussi redirige IMMÉDIATEMENT vers l'accueil
// (cahier §2b.5, décision Jérôme). Les testid `added-to-cart`/`go-to-checkout-link` qu'une dizaine
// de specs utilisaient comme simple étape de mise en place — jamais l'objet de leur test — ont
// disparu avec le lien manuel qu'ils ciblaient : la fiche produit a déjà navigué au moment où
// Playwright les chercherait.
//
// Le panier vit en base (spec 32) : peu importe PAR QUELLE page l'ajout a eu lieu, `/pago` (ou la
// fiche produit elle-même, ré-ouverte) voit le même panier après un `page.goto()` direct.

/** Attend le retour automatique à l'accueil qui suit tout ajout au panier réussi. */
export async function esperarRetornoTrasAgregar(page: Page): Promise<void> {
  await page.waitForURL(/\/(es|en)\/?(\?.*)?$/);
}

/**
 * Le cas le plus courant parmi les specs qui n'ajoutent qu'une ligne pour atteindre `/pago` :
 * attend le retour, puis y navigue directement plutôt que de rejouer un clic sur un lien qui n'a
 * plus de raison d'exister sur l'accueil.
 */
export async function irAPagoTrasAgregar(page: Page): Promise<void> {
  await esperarRetornoTrasAgregar(page);
  await page.goto("/es/pago");
}
