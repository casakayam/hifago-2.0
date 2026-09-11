import type { Page } from "@playwright/test";

// Spec 19 §0 Tranche 1 — une commande réussie (`create_order`) est suivie d'un paiement Mercado
// Pago réel. Aucun test e2e ne doit en dépendre (lent, hors de notre contrôle, coûte une vraie
// préférence sandbox à chaque run) : on intercepte UNIQUEMENT l'appel réseau vers
// `/api/payments/create` et on renvoie un `init_point` fictif mais navigable — `create_order` ET
// `create_payment_intent` restent de VRAIS appels RPC (réservation et ledger réellement écrits),
// seul l'appel externe au SDK est simulé.
//
// ⚠️ CORRIGÉ PAR LA SPEC 33 (2026-09-10) — C'ÉTAIT L'ANGLE MORT QUI A LAISSÉ UNE PAGE BLANCHE
// SURVIVRE EN PRODUCTION.
//
// Ce helper renvoyait `${origin}/es?mp_mock_redirect=1` — L'ACCUEIL. Onze specs traversaient le
// checkout, et AUCUNE n'atterrissait là où un vrai client atterrit. Quand la spec 32 a fait vider
// `cart_items` par `create_order` dans sa propre transaction, les `back_urls` (alors pointées sur
// `/es/pago`) ont commencé à ramener le client sur un écran vide : ni numéro, ni confirmation, ni
// message d'échec. Rien n'a viré au rouge, parce que rien ne regardait là.
//
// DEUX CHANGEMENTS, ET LE PREMIER EST LE PLUS IMPORTANT :
//
// 1. `redirectUrl` n'est plus une URL fabriquée, c'est le MOTIF du vrai point d'atterrissage :
//    `**/reserva/**`. Depuis la spec 33, une commande acceptée quitte le tunnel pour son adresse
//    propre AVANT tout paiement — les onze `await page.waitForURL(redirectUrl)` existants attendent
//    donc désormais l'écran de résultat réel, sans qu'aucun d'eux n'ait à changer, et un test qui
//    passe prouve quelque chose qu'aucun ne prouvait avant.
// 2. L'interception ne sert plus qu'au clic « Pagar »/« Reintentar pago » depuis cet écran-là. Elle
//    renvoie un `init_point` qui ramène sur l'URL COURANTE (donc `/reserva/<jeton>`) : c'est très
//    exactement ce que fait Mercado Pago au retour, `back_urls` pointant sur cette même adresse.
//
// ⚠️ Ce helper ne peut PAS prouver que la `back_url` envoyée à Mercado Pago est la bonne — elle
// part dans la préférence, jamais dans l'`init_point`. C'est le test unitaire du Route Handler
// (`app/api/payments/create/route.test.ts`) qui le vérifie, et c'est là qu'il faut regarder si un
// jour ce contrat change.
//
// À appeler APRÈS avoir navigué sur une page de l'origine cible, typiquement juste avant de
// remplir/soumettre le formulaire de checkout.
export async function mockMercadoPagoCheckout(page: Page): Promise<{ redirectUrl: string }> {
  await page.route("**/api/payments/create", async (route) => {
    // L'URL courante est celle de l'écran de résultat (`/[locale]/reserva/<jeton>`), puisque c'est
    // le seul écran d'où un paiement peut désormais partir. Le paramètre rend la navigation
    // effective ; la page ne lit aucun `searchParams`, il n'a donc aucun effet sur le rendu.
    const retour = new URL(page.url());
    retour.searchParams.set("mp_mock_redirect", "1");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, init_point: retour.toString() }),
    });
  });

  // Un glob, pas une URL : le jeton n'est pas connu avant que la commande n'existe.
  // `page.waitForURL` accepte les trois formes (string, glob, regex).
  return { redirectUrl: "**/reserva/**" };
}
