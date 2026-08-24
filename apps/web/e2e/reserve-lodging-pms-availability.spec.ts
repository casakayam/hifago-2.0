import { test, expect } from "@playwright/test";
import { withDb, createPmsBackedEstablishmentFixture, mockPmsNightAvailability, isoDate } from "@hifago/e2e-support";

// Spec 21 §13 (gap comblé) — GET /api/pms/night-availability alimente le calendrier d'un logement
// PMS-backed (Casa Kayam). Établissement DÉDIÉ créé dans ce test (jamais "Casa Kayam Guatapé" du
// seed, partagé par d'autres specs — AGENTS-PARALLELES.md point 5), via
// createPmsBackedEstablishmentFixture (packages/e2e-support/src/pms.ts). Mock au niveau
// page.route() (jamais le vrai LobbyPMS, même discipline que mockPmsReserveNights et
// admin-establishment-pms-connector.spec.ts — spec 21 §10 point 1 : aucun test automatisé de ce
// projet ne doit jamais toucher le vrai LobbyPMS). Un seul test, chemin heureux + dégradation
// (hifago/CLAUDE.md §6.5, proportionnalité) : la logique de calcul (fullDates, fail-closed par
// omission) est déjà couverte en Vitest par getNightAvailabilityWindow.test.ts, ce test-ci prouve
// uniquement le branchement écran réel. Chaque scénario recharge la page (état frais) plutôt que
// d'enchaîner plusieurs sélections de plage sur la même instance — le comportement de
// réinitialisation de react-day-picker après une plage déjà complète n'est pas celui qu'on
// pourrait supposer, confirmé en testant manuellement.
const TIMESTAMP = Date.now();
const SLUG = `e2e-reserve-lodging-pms-availability-${TIMESTAMP}`;
const LOBBY_CATEGORY_ID = 555000;

test("le calendrier d'un logement PMS-backed reflète la disponibilité Lobby, et se dégrade proprement si Lobby est injoignable", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      "b0000000-0000-4000-8000-000000000002",
    ]);
    return rows[0].partner_id as string;
  });

  const { establishmentId, productId } = await withDb((client) =>
    createPmsBackedEstablishmentFixture(client, {
      partnerId,
      establishmentName: `E2E PMS Availability ${TIMESTAMP}`,
      productName: "E2E Alojamiento PMS",
      slug: SLUG,
      priceCop: 200000,
      lobbyCategoryId: LOBBY_CATEGORY_ID,
    })
  );

  const fullNightDate = isoDate(3);

  await mockPmsNightAvailability(page, {
    ok: true,
    nights: [
      { date: isoDate(2), capacity: 2, booked: 0 },
      { date: fullNightDate, capacity: 0, booked: 0 },
      { date: isoDate(4), capacity: 2, booked: 0 },
      { date: isoDate(5), capacity: 2, booked: 0 },
      { date: isoDate(6), capacity: 2, booked: 0 },
      { date: isoDate(7), capacity: 2, booked: 0 },
    ],
  });

  await page.goto(`/es/products/${SLUG}`);
  await page.waitForLoadState("networkidle");

  // Nuit pleine chez Lobby → visuellement barrée (modifier "full" appliqué à la cellule <td>, cf.
  // packages/ui/src/components/legacy-calendar.tsx — pas au <button> lui-même).
  await expect(page.locator(`td:has([data-date="${fullNightDate}"])`)).toHaveClass(/line-through/);

  // Plage incluant la nuit pleine → bloquée, jamais une fausse dispo.
  await page.locator(`[data-date="${isoDate(2)}"]`).click();
  await page.locator(`[data-date="${isoDate(4)}"]`).click();
  await expect(page.getByTestId("range-unavailable-warning")).toBeVisible();
  await expect(page.getByTestId("add-to-cart-button")).toBeDisabled();

  // Plage entièrement disponible (page rechargée = état frais) → ajout au panier fonctionne.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator(`[data-date="${isoDate(5)}"]`).click();
  await page.locator(`[data-date="${isoDate(7)}"]`).click();
  await expect(page.getByTestId("range-unavailable-warning")).not.toBeVisible();
  await expect(page.getByTestId("lodging-estimated-price")).toBeVisible();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  // Lobby injoignable (échec réseau/502) → bandeau dégradé affiché, page reste utilisable, jamais
  // un crash — et par fail-closed (aucune nuit résolue), toute plage reste bloquée à l'ajout.
  await page.unroute("**/api/pms/night-availability**");
  await mockPmsNightAvailability(page, { ok: false, reason: "lobby_unreachable" });
  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("pms-availability-error")).toBeVisible();
  await page.locator(`[data-date="${isoDate(5)}"]`).click();
  await page.locator(`[data-date="${isoDate(7)}"]`).click();
  await expect(page.getByTestId("range-unavailable-warning")).toBeVisible();
  await expect(page.getByTestId("add-to-cart-button")).toBeDisabled();

  // Nettoyage — fixture dédiée, jamais partagée. Panier: la ligne ajoutée en phase 2 n'a jamais été
  // commandée (aucun checkout dans ce test), rien à purger côté order_lines.
  await withDb(async (client) => {
    await client.query("delete from products where id = $1", [productId]);
    await client.query("delete from establishments where id = $1", [establishmentId]);
  });
});
