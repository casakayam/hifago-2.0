import { test, expect } from "@playwright/test";
import { withDb, mockMercadoPagoCheckout, isoDate, deleteOrdersByHolderName } from "@hifago/e2e-support";

// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — alojamiento (maison
// entière) réservé par plage de nuits, branche create_order end_date. La logique de create_order
// elle-même (arithmétique de capacité, re-résolution de prix, tout-ou-rien) est déjà entièrement
// couverte par pgTAP (supabase/tests/database/date_range_booking.test.sql) — pas re-prouvée ici,
// seul le parcours écran (plage → panier → checkout → confirmation) l'est.
const TIMESTAMP = Date.now();
const PRODUCT_ID = "88950000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002"; // établissement seedé existant
const SLUG = `e2e-reserve-lodging-range-${TIMESTAMP}`;

test("un client réserve un alojamiento par plage de nuits, depuis la fiche produit jusqu'à la confirmation", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      ESTABLISHMENT_ID,
    ]);
    return rows[0].partner_id as string;
  });

  await withDb(async (client) => {
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, sellable, slug, price_cop, min_qty, max_qty)
       values ($1, $2, $3, 'lodging', $4, true, $5, 200000, 1, 4)`,
      [PRODUCT_ID, partnerId, ESTABLISHMENT_ID, JSON.stringify({ es: "E2E Alojamiento Reserve" }), SLUG]
    );
    await client.query(
      `insert into product_availability (product_id, date, capacity, booked)
       select $1, $2::date + n, 1, 0 from generate_series(0, 6) as n`,
      [PRODUCT_ID, isoDate(1)]
    );
    await client.query(
      `insert into product_calendar (product_id, date, open)
       select $1, $2::date + n, true from generate_series(0, 6) as n`,
      [PRODUCT_ID, isoDate(1)]
    );
  });

  await page.goto(`/es/products/${SLUG}`);
  await page.waitForLoadState("networkidle");

  const checkIn = isoDate(2);
  const checkOut = isoDate(4); // 2 nuits
  await page.locator(`[data-date="${checkIn}"]`).click();
  await page.locator(`[data-date="${checkOut}"]`).click();

  await expect(page.getByTestId("lodging-estimated-price")).toContainText("400.000"); // 2 nuits × 200000 × qty 1

  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
  await page.getByTestId("go-to-checkout-link").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("cart-total")).toContainText("400.000");

  await page.getByLabel("Nombre completo").fill("Cliente E2E Alojamiento");
  await page.getByRole("textbox", { name: "WhatsApp" }).fill("+573009998877");
  await page.getByLabel("Correo electrónico").fill(`cliente.e2e.alojamiento.${TIMESTAMP}@test.local`);
  // Spec 19 §0 Tranche 1 : create_order réussi enchaîne désormais automatiquement le paiement
  // Mercado Pago (redirection réelle, seul l'appel SDK externe est mocké). order-success n'est
  // qu'un état transitoire — la redirection peut déjà l'avoir remplacé avant que Playwright ne
  // l'observe (race constatée en testant) : attendre l'URL finale est le seul checkpoint fiable.
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  await page.waitForURL(redirectUrl, { timeout: 10000 });

  // Confirmation en base, au-delà de l'écran : ligne correcte + capacité réellement décrémentée
  // sur les nuits de la plage, checkout exclu.
  const state = await withDb(async (client) => {
    const { rows: lines } = await client.query(
      `select to_char(ol.date, 'YYYY-MM-DD') as date, to_char(ol.end_date, 'YYYY-MM-DD') as end_date,
              ol.qty, ol.total_cop
         from order_lines ol join orders o on o.id = ol.order_id
        where o.holder_name = 'Cliente E2E Alojamiento'`
    );
    const { rows: avail } = await client.query(
      `select to_char(date, 'YYYY-MM-DD') as date, booked from product_availability
        where product_id = $1 order by date`,
      [PRODUCT_ID]
    );
    return { lines, avail };
  });

  expect(state.lines).toHaveLength(1);
  expect(state.lines[0].date).toBe(checkIn);
  expect(state.lines[0].end_date).toBe(checkOut);
  expect(state.lines[0].qty).toBe(1);
  expect(String(state.lines[0].total_cop)).toBe("400000");
  const checkInRow = state.avail.find((r: { date: string }) => r.date === checkIn);
  const checkOutRow = state.avail.find((r: { date: string }) => r.date === checkOut);
  expect(checkInRow.booked).toBe(1);
  expect(checkOutRow.booked).toBe(0); // checkout exclusif, jamais consommé

  // Nettoyage — fixture dédiée, jamais partagée.
  await withDb(async (client) => {
    await client.query(
      "delete from order_lines where order_id in (select id from orders where holder_name = 'Cliente E2E Alojamiento')"
    );
  });
  // create_payment_intent n'est jamais mocké (seul l'appel SDK Mercado Pago externe l'est) — un
  // payments réel référence cette commande, purgé avant les orders eux-mêmes (FK
  // payments_order_id_fkey), même helper partagé que resetAvailability.
  await deleteOrdersByHolderName("Cliente E2E Alojamiento");
  await withDb(async (client) => {
    await client.query("delete from product_availability where product_id = $1", [PRODUCT_ID]);
    await client.query("delete from product_calendar where product_id = $1", [PRODUCT_ID]);
    await client.query("delete from products where id = $1", [PRODUCT_ID]);
  });
});
