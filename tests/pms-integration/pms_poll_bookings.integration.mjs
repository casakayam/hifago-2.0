// Spec 21 — connecteur LobbyPMS. Test d'intégration RÉEL de l'Edge Function pms-poll-bookings
// contre la stack Supabase locale — invoque directement l'URL HTTP de la fonction (jamais en
// attendant un tick pg_cron ; vérifier `select * from cron.job` une fois manuellement suffit pour
// le déclenchement lui-même, cf. hifago/CLAUDE.md §6.5 — proportionnalité du test).
//
// PRÉREQUIS avant de lancer ce script (voir supabase/scripts/seed_pms_vault_secrets.example.sql et
// le commentaire d'en-tête de supabase/functions/pms-poll-bookings/index.ts) :
//   1. npx supabase start actif.
//   2. supabase/functions/.env (gitignoré) contient LOBBY_API_BASE_URL=http://host.docker.internal:4545
//      — SANS ce réglage, la fonction pointerait vers le VRAI LobbyPMS, jamais souhaitable en test.
// Même squelette que tests/concurrency/*.mjs (driver `pg` direct, process.exit) mais sans barrière
// de concurrence — ce n'est pas un test anti-survente, une preuve d'intégration bout en bout.
import pg from "pg";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const { Client } = pg;
const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FUNCTIONS_URL = "http://127.0.0.1:54321/functions/v1/pms-poll-bookings";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const FIXTURE_PORT = 4545;

const PARTNER_ID = "77770000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "77770000-0000-4000-8000-000000000011";
const PRODUCT_ID = "77770000-0000-4000-8000-000000000021";
const ACCOUNT_ID = "77770000-0000-4000-8000-000000000031";
const ORDER_ID = "77770000-0000-4000-8000-000000000041";
const CANCELLED_BOOKING_ID = 91000001; // 404 côté fixture → cancelled_by_provider attendu
const FULFILLED_BOOKING_ID = 91000002; // checkout_realizado=1 côté fixture → fulfilled attendu

const scenario = {
  [FULFILLED_BOOKING_ID]: {
    status: 200,
    body: {
      data: {
        checkin_realizado: 1,
        checkout_realizado: 1,
        total_alojamiento: "100000.00",
        descuentos: [],
      },
    },
  },
  // CANCELLED_BOOKING_ID volontairement absent → 404 par défaut ci-dessous.
};

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/v1\/bookings\/(\d+)$/);
    if (req.method === "GET" && match) {
      const entry = scenario[Number(match[1])];
      if (!entry) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "No query results for model [App\\Models\\Booking]." }));
        return;
      }
      res.writeHead(entry.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entry.body));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unhandled by fixture server" }));
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

async function purgeFixtures(client) {
  await client.query(
    "delete from pms_reconciliation_entries where order_line_id in (select id from order_lines where order_id = $1)",
    [ORDER_ID]
  );
  await client.query("delete from order_lines where order_id = $1", [ORDER_ID]);
  await client.query("delete from orders where id = $1", [ORDER_ID]);
  await client.query("delete from products where id = $1", [PRODUCT_ID]);
  await client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from partners where id = $1", [PARTNER_ID]);
  await client.query("delete from auth.users where id = $1", [ACCOUNT_ID]);
}

async function resetFixtures(client) {
  await purgeFixtures(client);

  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    ACCOUNT_ID,
    "pms-integration@test.local",
  ]);
  await client.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "PMS Integration Test Partner",
  ]);
  await client.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, $3, true, 'integration-fake-token')`,
    [ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "PMS Integration Test Establishment" })]
  );
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
     values ($1, $2, $3, 'lodging', $4, 100000, true, $5, 9631)`,
    [
      PRODUCT_ID,
      PARTNER_ID,
      ESTABLISHMENT_ID,
      JSON.stringify({ es: "PMS Integration Lodging" }),
      `pms-integration-${randomUUID()}`,
    ]
  );
  await client.query(
    "insert into orders (id, account_id, holder_name, holder_email) values ($1, $2, $3, $4)",
    [ORDER_ID, ACCOUNT_ID, "PMS Integration Holder", "pms-integration@test.local"]
  );

  const commonCols = `
    order_id, account_id, product_id, date, qty, status, holder_name, pms_booking_id,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  `;
  await client.query(
    `insert into order_lines (${commonCols})
     values
       ($1, $2, $3, '2029-01-01', 1, 'reserved', 'PMS Integration Holder', $4, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0),
       ($1, $2, $3, '2029-01-02', 1, 'reserved', 'PMS Integration Holder', $5, 100000, 100000, 'direct', 0, 0, 0, 0, 0, 0)`,
    [ORDER_ID, ACCOUNT_ID, PRODUCT_ID, String(CANCELLED_BOOKING_ID), String(FULFILLED_BOOKING_ID)]
  );
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  const fixtureServer = await startFixtureServer();
  // process.exit() à l'intérieur du try tuerait le process AVANT que le nettoyage async du finally
  // n'ait eu le temps de s'exécuter (constaté : la première version de ce script laissait ses
  // fixtures en base à chaque run) — on capture le code de sortie voulu, et on ne quitte qu'APRÈS
  // que try/finally soit entièrement résolu, cleanup compris.
  let exitCode = 0;

  try {
    await resetFixtures(client);

    const response = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error(`pms-poll-bookings a répondu ${response.status} : ${await response.text()}`);
    }
    const summary = await response.json();
    console.log("Réponse pms-poll-bookings :", summary);

    const { rows } = await client.query(
      `select pms_booking_id, status
         from order_lines where order_id = $1 order by date`,
      [ORDER_ID]
    );
    const cancelled = rows.find((r) => r.pms_booking_id === String(CANCELLED_BOOKING_ID));
    const fulfilled = rows.find((r) => r.pms_booking_id === String(FULFILLED_BOOKING_ID));

    const checks = [
      [cancelled?.status === "cancelled_by_provider", `booking 404 → cancelled_by_provider (obtenu: ${cancelled?.status})`],
      [fulfilled?.status === "fulfilled", `checkout_realizado=1 → fulfilled (obtenu: ${fulfilled?.status})`],
    ];

    const { rows: reconciliationRows } = await client.query(
      `select count(*)::int as count from pms_reconciliation_entries pre
         join order_lines ol on ol.id = pre.order_line_id
        where ol.order_id = $1 and ol.pms_booking_id = $2`,
      [ORDER_ID, String(CANCELLED_BOOKING_ID)]
    );
    checks.push([
      reconciliationRows[0].count === 1,
      `booking annulé → 1 entrée pms_reconciliation_entries (obtenu: ${reconciliationRows[0].count})`,
    ]);

    let failed = false;
    for (const [ok, label] of checks) {
      console.log(`${ok ? "OK " : "FAIL"} — ${label}`);
      if (!ok) failed = true;
    }

    if (failed) {
      console.error(
        "Échec — vérifier que supabase/functions/.env pointe bien LOBBY_API_BASE_URL vers " +
          `http://host.docker.internal:${FIXTURE_PORT} et que supabase a été redémarré après ce réglage.`
      );
      exitCode = 1;
    } else {
      console.log("pms-poll-bookings : intégration bout en bout vérifiée.");
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await purgeFixtures(client).catch((err) => console.error("Nettoyage final a échoué :", err));
    await client.end();
    await new Promise((resolve) => fixtureServer.close(resolve));
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
