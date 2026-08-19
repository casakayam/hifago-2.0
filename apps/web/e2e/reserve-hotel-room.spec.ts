import { test, expect } from "@playwright/test";
import {
  withDb,
  mockMercadoPagoCheckout,
  isoDate,
  deleteOrdersByHolderName,
  createHotelRoomFixture,
} from "@hifago/e2e-support";

// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — chambre d'hôtel
// réservée par plage de nuits. La logique de create_order elle-même (arithmétique de capacité,
// re-résolution de prix, tout-ou-rien) est déjà entièrement couverte par pgTAP
// (supabase/tests/database/room_type_and_date_range_booking.test.sql) et par un test de
// concurrence dédié (tests/concurrency/create_order_room_range.concurrency.mjs) — pas re-prouvée
// ici, seul le parcours écran (sélecteur de chambre → plage → panier → checkout → confirmation)
// l'est, même patron que reserve.spec.ts.
const TIMESTAMP = Date.now();
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002"; // établissement seedé existant
const SLUG = `e2e-reserve-hotel-room-${TIMESTAMP}`;

test("un client réserve une chambre d'hôtel par plage de nuits, depuis la fiche produit jusqu'à la confirmation", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      ESTABLISHMENT_ID,
    ]);
    return rows[0].partner_id as string;
  });

  const { productId: PRODUCT_ID, roomId: ROOM_ID } = await withDb((client) =>
    createHotelRoomFixture(client, {
      partnerId,
      establishmentId: ESTABLISHMENT_ID,
      slug: SLUG,
      productName: "E2E Hotel Reserve",
      roomName: "Dormitorio E2E",
      kind: "dorm",
      roomCapacity: 6,
      quantity: 2,
      priceCop: 30000,
      minQty: 1,
      maxQty: 6,
      availabilityCapacity: 4,
      availabilityStartDate: isoDate(1),
      days: 7,
    })
  );

  await page.goto(`/es/products/${SLUG}`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId(`room-type-option-${ROOM_ID}`)).toBeVisible();
  await page.getByTestId(`room-type-option-${ROOM_ID}`).click();

  const checkIn = isoDate(2);
  const checkOut = isoDate(4); // 2 nuits
  await page.locator(`[data-date="${checkIn}"]`).click();
  await page.locator(`[data-date="${checkOut}"]`).click();

  await expect(page.getByTestId("hotel-estimated-price")).toContainText("60.000"); // 2 nuits × 30000 × qty 1

  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
  await page.getByTestId("go-to-checkout-link").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("cart-total")).toContainText("60.000");

  await page.getByLabel("Nombre completo").fill("Cliente E2E Hotel");
  await page.getByRole("textbox", { name: "WhatsApp" }).fill("+573009998877");
  await page.getByLabel("Correo electrónico").fill(`cliente.e2e.hotel.${TIMESTAMP}@test.local`);
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
      `select ol.date, ol.end_date, ol.room_type_id, ol.qty, ol.total_cop
         from order_lines ol join orders o on o.id = ol.order_id
        where o.holder_name = 'Cliente E2E Hotel'`
    );
    const { rows: avail } = await client.query(
      `select to_char(date, 'YYYY-MM-DD') as date, booked from room_type_availability
        where room_type_id = $1 order by date`,
      [ROOM_ID]
    );
    return { lines, avail };
  });

  expect(state.lines).toHaveLength(1);
  expect(state.lines[0].room_type_id).toBe(ROOM_ID);
  expect(String(state.lines[0].total_cop)).toBe("60000");
  const checkInRow = state.avail.find((r: { date: string }) => r.date === checkIn);
  const checkOutRow = state.avail.find((r: { date: string }) => r.date === checkOut);
  expect(checkInRow.booked).toBe(1);
  expect(checkOutRow.booked).toBe(0); // checkout exclusif, jamais consommé

  // Nettoyage — fixture dédiée, jamais partagée.
  await withDb(async (client) => {
    await client.query("delete from order_lines where room_type_id = $1", [ROOM_ID]);
  });
  // create_payment_intent n'est jamais mocké (seul l'appel SDK Mercado Pago externe l'est) — un
  // payments réel référence cette commande, purgé avant les orders eux-mêmes (FK
  // payments_order_id_fkey), même helper partagé que resetAvailability.
  await deleteOrdersByHolderName("Cliente E2E Hotel");
  await withDb(async (client) => {
    await client.query("delete from room_type_availability where room_type_id = $1", [ROOM_ID]);
    await client.query("delete from product_room_types where id = $1", [ROOM_ID]);
    await client.query("delete from products where id = $1", [PRODUCT_ID]);
  });
});
