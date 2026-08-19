import { test, expect } from "@playwright/test";
import { withDb, createSignedInClient, isoDate, createHotelRoomFixture } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Spec 17 §0 Tranche 2 (suite) — modify_order_line devient polymorphe (migration
// 20260817220400_modify_order_line_range_support.sql). La logique de la RPC elle-même
// (arithmétique de capacité nuit par nuit, delta net sur une nuit commune aux deux intervalles,
// tout-ou-rien) est déjà entièrement couverte par pgTAP (supabase/tests/database/
// modify_order_line.test.sql) — pas re-prouvée ici, seul le parcours écran (bouton → dialogue
// Check-in/Check-out → RPC → mise à jour sans rechargement, persistance après reload) l'est, même
// patron que admin-modify-order-line.spec.ts (ligne à date unique).
const TIMESTAMP = Date.now();
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002"; // établissement seedé existant
const SLUG = `e2e-modify-room-range-${TIMESTAMP}`;

test("admin modifie les nuits et la cantidad d'une réservation de chambre depuis /admin/orders, la ligne d'origine devient superseded, la nouvelle est correcte et persiste", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      ESTABLISHMENT_ID,
    ]);
    return rows[0].partner_id as string;
  });

  const oldCheckIn = isoDate(2);
  const oldCheckOut = isoDate(4); // 2 nuits (jour 2, jour 3)
  const newCheckIn = isoDate(5);
  const newCheckOut = isoDate(7); // 2 nuits (jour 5, jour 6), sans nuit commune avec l'ancien intervalle

  // Fenêtre couvrant l'ancien ET le nouvel intervalle, capacité 2 (assez pour qty 1→2).
  const { productId: PRODUCT_ID, roomId: ROOM_ID } = await withDb((client) =>
    createHotelRoomFixture(client, {
      partnerId,
      establishmentId: ESTABLISHMENT_ID,
      slug: SLUG,
      productName: "E2E Hotel Modify Range",
      roomName: "Privada E2E Modify Range",
      kind: "private",
      roomCapacity: 2,
      quantity: 2,
      priceCop: 90000,
      minQty: 1,
      maxQty: 2,
      availabilityCapacity: 2,
      availabilityStartDate: oldCheckIn,
      days: 7,
    })
  );

  const holderName = `Cliente E2E Modify Room Range ${TIMESTAMP}`;
  const setupClient = await createSignedInClient(SEEDED_ACCOUNTS.operateurActif, SEEDED_PASSWORD);
  const { data: result, error: rpcError } = await setupClient.rpc("create_order", {
    p_lines: [
      {
        product_id: PRODUCT_ID,
        room_type_id: ROOM_ID,
        date: oldCheckIn,
        end_date: oldCheckOut,
        qty: 1,
      },
    ],
    p_holder_name: holderName,
    p_holder_email: `cliente.modify.room.range.${TIMESTAMP}@test.local`,
  });
  const created = result as { ok: boolean; order_id?: string } | null;
  if (rpcError || !created?.ok || !created.order_id) {
    throw new Error(`e2e setup: create_order a échoué : ${rpcError?.message ?? JSON.stringify(result)}`);
  }

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");
  await page.waitForLoadState("networkidle");

  const row = page.locator("tr", { hasText: holderName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Reservada");

  await row.getByTestId(/^modify-button-/).click();
  await page.waitForSelector('[data-testid="modify-date-input"]');
  // Ligne à plage : le dialogue affiche Check-in ET Check-out (pas un seul champ de date).
  await expect(page.getByTestId("modify-end-date-input")).toBeVisible();
  await page.getByTestId("modify-date-input").fill(newCheckIn);
  await page.getByTestId("modify-end-date-input").fill(newCheckOut);
  await page.getByTestId("modify-qty-input").fill("2");
  await page
    .getByTestId("modify-reason-input")
    .fill("El cliente cambió de fechas y amplió la habitación.");
  await page.getByTestId("confirm-modify-button").click();

  // Même patron que admin-modify-order-line.spec.ts : l'ancienne ligne (superseded) ET la nouvelle
  // (reserved, qty=2) portent toutes deux le même titulaire — distinguées par leur statut.
  await expect(page.getByTestId("confirm-modify-button")).toHaveCount(0, { timeout: 5000 });
  const oldRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Sustituida" });
  const newRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Reservada" });
  await expect(oldRow).toBeVisible();
  await expect(newRow).toBeVisible();
  await expect(newRow).toContainText("2");

  await page.reload();
  await page.waitForLoadState("networkidle");
  const reloadedOldRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Sustituida" });
  const reloadedNewRow = page.locator("tr", { hasText: holderName }).filter({ hasText: "Reservada" });
  await expect(reloadedOldRow).toBeVisible();
  await expect(reloadedNewRow).toBeVisible();
  await expect(reloadedNewRow).toContainText("2");

  // Confirmation en base, au-delà de l'écran : nouvelle ligne sur le bon intervalle/chambre/qty,
  // capacité correctement déplacée (ancien intervalle libéré, nouveau consommé).
  const state = await withDb(async (client) => {
    const { rows: lines } = await client.query(
      `select status, to_char(date, 'YYYY-MM-DD') as date, to_char(end_date, 'YYYY-MM-DD') as end_date,
              room_type_id, qty
         from order_lines where room_type_id = $1 order by created_at`,
      [ROOM_ID]
    );
    const { rows: avail } = await client.query(
      `select to_char(date, 'YYYY-MM-DD') as date, booked from room_type_availability
        where room_type_id = $1 order by date`,
      [ROOM_ID]
    );
    return { lines, avail };
  });

  expect(state.lines).toHaveLength(2);
  const supersededLine = state.lines.find((l: { status: string }) => l.status === "superseded");
  const reservedLine = state.lines.find((l: { status: string }) => l.status === "reserved");
  expect(supersededLine.date).toBe(oldCheckIn);
  expect(reservedLine.date).toBe(newCheckIn);
  expect(reservedLine.end_date).toBe(newCheckOut);
  expect(reservedLine.qty).toBe(2);

  const oldNight = state.avail.find((r: { date: string }) => r.date === isoDate(2));
  const newNight = state.avail.find((r: { date: string }) => r.date === isoDate(5));
  expect(oldNight.booked).toBe(0); // ancien intervalle libéré
  expect(newNight.booked).toBe(2); // nouvel intervalle consommé (qty=2)

  // Nettoyage — fixture dédiée, jamais partagée.
  await withDb(async (client) => {
    await client.query("delete from order_lines where room_type_id = $1", [ROOM_ID]);
    await client.query("delete from orders where holder_name = $1", [holderName]);
    await client.query("delete from room_type_availability where room_type_id = $1", [ROOM_ID]);
    await client.query("delete from product_room_types where id = $1", [ROOM_ID]);
    await client.query("delete from products where id = $1", [PRODUCT_ID]);
  });
});
