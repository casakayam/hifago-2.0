import { test, expect } from "@playwright/test";
import { withDb, isoDate, createHotelRoomFixture } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — grille chambres×dates
// admin. La logique des RPC sous-jacentes (set_room_type_availability, set_date_rate) est déjà
// entièrement couverte par pgTAP (room_type_and_date_range_booking.test.sql) — pas re-prouvée ici,
// seul le parcours écran (ouvrir une cellule, modifier cupo/prix, persistance après rechargement)
// l'est, même patron que admin-order-status.spec.ts.
const TIMESTAMP = Date.now();
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002";
const SLUG = `e2e-room-grid-${TIMESTAMP}`;

test("admin modifie le cupo et le precio especial d'une chambre depuis la grille, les deux persistent après rechargement", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      ESTABLISHMENT_ID,
    ]);
    return rows[0].partner_id as string;
  });

  const targetDate = isoDate(1);

  const { productId: PRODUCT_ID, roomId: ROOM_ID } = await withDb((client) =>
    createHotelRoomFixture(client, {
      partnerId,
      establishmentId: ESTABLISHMENT_ID,
      slug: SLUG,
      productName: "E2E Hotel Grid",
      roomName: "Privada E2E Grid",
      kind: "private",
      roomCapacity: 2,
      quantity: 4,
      priceCop: 90000,
      minQty: 1,
      maxQty: 1,
      availabilityCapacity: 2,
      availabilityStartDate: targetDate,
      days: 1,
    })
  );

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${PRODUCT_ID}/room-availability`);
  await page.waitForLoadState("networkidle");

  const cell = page.getByTestId(`room-cell-${ROOM_ID}-${targetDate}`);
  await expect(cell).toContainText("0/2");
  await cell.click();

  await expect(page.getByLabel("Cupo del día")).toHaveValue("2");
  await page.getByLabel("Cupo del día").fill("3");
  await page.getByTestId("save-room-capacity-button").click();
  await expect(page.getByTestId("save-room-capacity-button")).toHaveCount(0, { timeout: 5000 });
  await expect(cell).toContainText("0/3");

  await cell.click();
  await page.getByLabel(/Precio especial/).fill("75000");
  await page.getByTestId("save-room-price-button").click();
  await expect(page.getByTestId("save-room-price-button")).toHaveCount(0, { timeout: 5000 });
  await expect(cell).toContainText("75.000");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId(`room-cell-${ROOM_ID}-${targetDate}`)).toContainText("0/3");
  await expect(page.getByTestId(`room-cell-${ROOM_ID}-${targetDate}`)).toContainText("75.000");

  await withDb(async (client) => {
    await client.query("delete from room_type_date_rates where room_type_id = $1", [ROOM_ID]);
    await client.query("delete from room_type_availability where room_type_id = $1", [ROOM_ID]);
    await client.query("delete from product_room_types where id = $1", [ROOM_ID]);
    await client.query("delete from products where id = $1", [PRODUCT_ID]);
  });
});
