import type { Page } from "@playwright/test";

// Spec 19 §0 Tranche 1 — depuis le branchement de CheckoutForm.tsx, une commande réussie
// (create_order) enchaîne automatiquement create_payment_intent (RPC réelle) PUIS
// POST /api/payments/create (appel SDK Mercado Pago réel) PUIS une redirection réelle du
// navigateur vers Checkout Pro. Aucun test e2e ne doit dépendre d'un vrai paiement Mercado Pago
// (lent, hors de notre contrôle, coûte une vraie préférence sandbox à chaque run) : on intercepte
// UNIQUEMENT l'appel réseau vers /api/payments/create et on renvoie un init_point fictif mais
// navigable (même origine que la page courante) — create_order ET create_payment_intent restent
// de VRAIS appels RPC (la réservation/le ledger sont réellement écrits), seul l'appel externe au
// SDK Mercado Pago est simulé. La redirection réelle du navigateur (window.location.href) reste
// testée : un test qui veut la prouver peut `await page.waitForURL(redirectUrl)`.
//
// À appeler APRÈS avoir navigué sur une page de l'origine cible (dérive l'origine de page.url()),
// typiquement juste avant de remplir/soumettre le formulaire de checkout.
export async function mockMercadoPagoCheckout(page: Page): Promise<{ redirectUrl: string }> {
  const origin = new URL(page.url()).origin;
  const redirectUrl = `${origin}/es?mp_mock_redirect=1`;

  await page.route("**/api/payments/create", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, init_point: redirectUrl }),
    });
  });

  return { redirectUrl };
}
