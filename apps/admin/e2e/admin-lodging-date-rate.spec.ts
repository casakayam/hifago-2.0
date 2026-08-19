import { test, expect } from "@playwright/test";
import { withDb, isoDate } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — extension du
// calendrier day-by-day partagé (availability-calendar.tsx, mode="product") au precio especial
// (product_date_rates via set_date_rate('product', ...)). La logique de la RPC elle-même est déjà
// couverte par pgTAP (supabase/tests/database/set_date_rate_product.test.sql) — pas re-prouvée
// ici, seul le parcours écran (ouvrir le jour, fixer un precio especial, le voir apparaître sur la
// cellule, persistance après rechargement) l'est, même patron que admin-room-availability-grid.spec.ts
// (RoomDateEditor) adapté au calendrier FullCalendar day-by-day plutôt qu'à la grille chambres×dates.
const TIMESTAMP = Date.now();
const PRODUCT_ID = "88960000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002";
const SLUG = `e2e-lodging-date-rate-${TIMESTAMP}`;

test("admin fixe un precio especial pour una fecha de un alojamiento depuis el calendario, se ve en la celda y persiste tras recargar", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      ESTABLISHMENT_ID,
    ]);
    return rows[0].partner_id as string;
  });

  // Toujours demain : garanti dans le mois actuellement affiché par FullCalendar (vue par défaut,
  // aucune navigation "mois suivant" nécessaire) et jamais dans le passé (cf. partner-availability.spec.ts).
  const targetDate = isoDate(1);

  await withDb(async (client) => {
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
       values ($1, $2, $3, 'lodging', $4, 300000, true, $5)`,
      [PRODUCT_ID, partnerId, ESTABLISHMENT_ID, JSON.stringify({ es: "E2E Alojamiento Date Rate" }), SLUG]
    );
    await client.query(
      `insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 2, 0)`,
      [PRODUCT_ID, targetDate]
    );
    await client.query(
      `insert into product_calendar (product_id, date, open) values ($1, $2, true)`,
      [PRODUCT_ID, targetDate]
    );
  });

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${PRODUCT_ID}/availability`);
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(".fc");

  const dayCell = page.locator(`.fc-daygrid-day[data-date="${targetDate}"]`);
  await expect(dayCell).toContainText("0/2");

  await dayCell.click();
  await page.waitForSelector('[role="dialog"]');

  await expect(page.locator('input[name="capacity"]')).toHaveValue("2");
  await expect(page.getByLabel(/Precio especial/)).toHaveValue("");

  await page.getByLabel(/Precio especial/).fill("85000");
  await page.getByTestId("save-date-rate-button").click();
  await page.waitForSelector('[role="dialog"]', { state: "hidden" });

  await expect(dayCell).toContainText("85.000");
  // La capacité/estado n'a pas bougé — la sauvegarde du precio especial n'interfère pas avec elle.
  await expect(dayCell).toContainText("0/2");

  await page.reload();
  await page.waitForLoadState("networkidle");
  const dayCellAfterReload = page.locator(`.fc-daygrid-day[data-date="${targetDate}"]`);
  await expect(dayCellAfterReload).toContainText("0/2");
  await expect(dayCellAfterReload).toContainText("85.000");

  await dayCellAfterReload.click();
  await page.waitForSelector('[role="dialog"]');
  await expect(page.getByLabel(/Precio especial/)).toHaveValue("85000");

  await withDb(async (client) => {
    await client.query("delete from product_date_rates where product_id = $1", [PRODUCT_ID]);
    await client.query("delete from product_calendar where product_id = $1", [PRODUCT_ID]);
    await client.query("delete from product_availability where product_id = $1", [PRODUCT_ID]);
    await client.query("delete from products where id = $1", [PRODUCT_ID]);
  });
});
