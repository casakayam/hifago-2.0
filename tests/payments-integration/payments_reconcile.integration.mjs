// Spec 39 — test d'intégration RÉEL de l'Edge Function payments-reconcile contre la stack Supabase
// locale : invoque l'URL HTTP de la fonction (jamais en attendant un tick pg_cron), Mercado Pago
// étant rejoué par un serveur de fixtures node:http. Même squelette que
// tests/pms-integration/pms_poll_bookings.integration.mjs.
//
// PRÉREQUIS (voir l'en-tête de supabase/functions/payments-reconcile/index.ts) :
//   1. npx supabase start actif.
//   2. supabase/functions/.env (gitignoré) contient
//        MERCADOPAGO_API_BASE_URL=http://host.docker.internal:4547
//        MERCADOPAGO_ACCESS_TOKEN=<n'importe quelle valeur non vide>
//      puis `npx supabase stop && npx supabase start` (le runtime Edge lit .env au démarrage).
//      SANS ce réglage, la fonction pointerait vers le VRAI Mercado Pago — jamais souhaitable en test.
//
// Six scénarios, un par commande, tous dans le même run de la fonction :
//   S1 approuvé tardif sans retour client → commande payée ;
//   S2 rien chez MP après 30 min + marge → expirée, place rendue ;
//   S3 PSE en attente > 2 h, MP accepte l'annulation → expirée ;
//   S4 PSE en attente > 2 h, MP REFUSE l'annulation et le re-GET dit approuvé → payée, jamais expirée ;
//   S5 paiement dont le collector_id ≠ /users/me → rien ne bouge, heartbeat ok=false ;
//   S6 paiement annulé d'une commande déjà expirée, MP dit approuvé → refund_required (surveillance) ;
//   S7 remboursement demandé par l'admin → POST /refunds (X-Idempotency-Key) → approuvé, entrée résolue ;
//   S8 remboursement refusé par MP (4xx métier) → rejected, entrée rouverte, corps conservé.
import pg from "pg";
import { createServer } from "node:http";

const { Client } = pg;
const CONNECTION_STRING = process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FUNCTIONS_URL = "http://127.0.0.1:54321/functions/v1/payments-reconcile";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const FIXTURE_PORT = 4547;
const COLLECTOR_ID = 3627131944; // le compte qui encaisse (piège 19)

const P = "77780000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000011`;
const PRODUCT_ID = `${P}000000000021`;
const ACCOUNT_ID = `${P}000000000031`;
const ord = (n) => `${P}0000000000a${n}`;
const line = (n) => `${P}0000000000b${n}`;
const pay = (n) => `${P}0000000000c${n}`;

// Ce que Mercado Pago répond, par external_reference (= payments.id) et par id de paiement MP.
const mpPayment = (id, externalReference, status, amount = 17000) => ({
  id,
  status,
  status_detail: status === "approved" ? "accredited" : status === "pending" ? "pending_waiting_transfer" : status,
  transaction_amount: amount,
  external_reference: externalReference,
  date_created: "2026-09-21T10:00:00.000-04:00",
  date_approved: status === "approved" ? "2026-09-21T10:00:30.000-04:00" : null,
  collector_id: COLLECTOR_ID,
  payment_type_id: status === "pending" ? "bank_transfer" : "credit_card",
});
const searchResults = {
  [pay(1)]: [mpPayment(910001, pay(1), "approved")],
  [pay(2)]: [],
  [pay(3)]: [mpPayment(910003, pay(3), "pending")],
  [pay(4)]: [mpPayment(910004, pay(4), "pending")],
  [pay(5)]: [],
  [pay(6)]: [mpPayment(910006, pay(6), "approved")],
};
// PUT /v1/payments/:id → ce que MP répond, puis ce que le re-GET renvoie.
const cancelBehaviour = {
  910003: { put: 200, after: "cancelled" },
  910004: { put: 400, after: "approved" }, // le virement a abouti entre le search et le PUT
};
// POST /v1/payments/:id/refunds → ce que MP répond (corps à remplacer par des captures réelles
// de préprod dès qu'elles existent, spec 39 §10.5).
const refundBehaviour = {
  910007: { status: 201, body: { id: 55501, payment_id: 910007, amount: 17000, status: "approved", refund_mode: "standard" } },
  910008: { status: 400, body: { message: "Payment-too-old-to-be-refunded", error: "bad_request", status: 400 } },
};
const seen = { me: 0, search: [], put: [], get: [], refunds: [] };

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer TEST-fixture-token") return send(401, { message: "invalid_token" });
    if (req.method === "GET" && url.pathname === "/users/me") {
      seen.me++;
      return send(200, { id: COLLECTOR_ID, nickname: "TESTUSER-fixture" });
    }
    if (req.method === "GET" && url.pathname === "/v1/payments/search") {
      const ref = url.searchParams.get("external_reference");
      seen.search.push(ref);
      const results = searchResults[ref] ?? [];
      return send(200, { paging: { total: results.length, limit: 50, offset: 0 }, results });
    }
    const r = url.pathname.match(/^\/v1\/payments\/(\d+)\/refunds$/);
    if (r && req.method === "POST") {
      const id = Number(r[1]);
      seen.refunds.push({ id, idempotencyKey: req.headers["x-idempotency-key"] ?? null });
      const behaviour = refundBehaviour[id];
      if (!behaviour) return send(404, { message: "Payment not found" });
      return send(behaviour.status, behaviour.body);
    }
    const m = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      const behaviour = cancelBehaviour[id];
      if (req.method === "PUT") {
        seen.put.push(id);
        if (!behaviour) return send(404, { message: "Payment not found" });
        return behaviour.put === 200
          ? send(200, { id, status: "cancelled" })
          : send(400, { message: "Payment cannot be cancelled", error: "bad_request", status: 400 });
      }
      if (req.method === "GET") {
        seen.get.push(id);
        if (!behaviour) return send(404, { message: "Payment not found" });
        const ref = Object.keys(searchResults).find((k) => searchResults[k].some((p) => p.id === id));
        return send(200, mpPayment(id, ref, behaviour.after));
      }
    }
    send(404, { message: "unhandled by fixture server" });
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

async function purge(client) {
  await client.query(`delete from payment_refunds where payment_id::text like '${P}%'`);
  await client.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await client.query(`delete from notification_emails where related_id::text like '${P}%'`);
  await client.query(`delete from payments where order_id::text like '${P}%'`);
  await client.query(`delete from order_lines where order_id::text like '${P}%'`);
  await client.query(`delete from orders where id::text like '${P}%'`);
  await client.query("delete from product_availability where product_id = $1", [PRODUCT_ID]);
  await client.query("delete from products where id = $1", [PRODUCT_ID]);
  await client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from partners where id = $1", [PARTNER_ID]);
  await client.query("delete from partner_accounts where id = $1", [ACCOUNT_ID]);
  await client.query("delete from auth.users where id = $1", [ACCOUNT_ID]);
}

async function makeOrder(client, n, { age, lineStatus = "reserved", paymentStatus = "pending", payment = true, paymentAge = age, collector = null }) {
  await client.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
     values ($1, $2, $3, $4, $5, now() - $6::interval)`,
    [ord(n), ACCOUNT_ID, `Holder S${n}`, `s${n}@hifago.test`, paymentStatus, age]
  );
  await client.query(
    `insert into order_lines (id, order_id, account_id, product_id, date, qty, status, holder_name,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop)
     values ($1, $2, $3, $4, '2028-11-01', 1, $5, 'Holder', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
    [line(n), ord(n), ACCOUNT_ID, PRODUCT_ID, lineStatus]
  );
  if (payment) {
    await client.query(
      `insert into payments (id, order_id, status, amount_cop, created_at, mp_collector_id)
       values ($1, $2, $3, 17000, now() - $4::interval, $5)`,
      [pay(n), ord(n), lineStatus === "expired" ? "cancelled" : "pending", paymentAge, collector]
    );
  }
}

async function seed(client) {
  await purge(client);
  await client.query("insert into partners (id, display_name) values ($1, 'Reconcile Integration Partner')", [PARTNER_ID]);
  await client.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "Establecimiento Reconcile Integration" }),
  ]);
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Actividad reconcile'), 100000, true, 'reconcile-integration')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  // 6 places prises : une par commande S1-S6 (S6 a déjà été expirée par ailleurs : sa place est
  // déjà rendue, on part donc de 5).
  await client.query("insert into product_availability (product_id, date, capacity, booked) values ($1, '2028-11-01', 10, 5)", [PRODUCT_ID]);
  await client.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [ACCOUNT_ID, "reconcile-integration@hifago.test"]);
  await makeOrder(client, 1, { age: "5 minutes" });
  await makeOrder(client, 2, { age: "35 minutes" });
  await makeOrder(client, 3, { age: "2 hours 10 minutes" });
  await makeOrder(client, 4, { age: "2 hours 10 minutes" });
  await makeOrder(client, 5, { age: "40 minutes", collector: "999999" });
  await makeOrder(client, 6, { age: "50 minutes", lineStatus: "expired", paymentStatus: "unpaid" });
  // S7/S8 : deux commandes déjà expirées dont le paiement tardif a produit une entrée refund_required
  // (garde du Lot A), et pour lesquelles un admin a demandé le remboursement.
  for (const [n, mpId] of [[7, "910007"], [8, "910008"]]) {
    await makeOrder(client, n, { age: "3 hours", lineStatus: "expired", paymentStatus: "unpaid" });
    await client.query("update payments set mp_payment_id = $2, mp_last_status = 'approved' where id = $1", [pay(n), mpId]);
    const { rows: [entry] } = await client.query(
      `insert into payment_reconciliation_entries (payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code)
       values ($1, $2, $3, '{"transaction_amount": 17000}'::jsonb, 'paiement approuvé après expiration de la commande', 'refund_required', 'paid_after_expiry')
       returning id`,
      [pay(n), mpId, pay(n)]
    );
    await client.query(
      `insert into payment_refunds (entry_id, payment_id, mp_payment_id, amount_cop, status, note)
       values ($1, $2, $3, 17000, 'pending', 'integration')`,
      [entry.id, pay(n), mpId]
    );
    await client.query("update payment_reconciliation_entries set status = 'retrying' where id = $1", [entry.id]);
  }
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  const fixture = await startFixtureServer();
  let exitCode = 0;
  try {
    await seed(client);

    const response = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ limit: 25 }),
    });
    const summary = await response.json().catch(() => null);
    console.log(`payments-reconcile → ${response.status}`, summary);
    if (response.status !== 200) throw new Error("la fonction n'a pas répondu 200");

    const { rows: orders } = await client.query(
      `select o.id, o.payment_status, ol.status as line_status, p.status as pay_status, p.mp_last_status, p.mp_cancel_attempts
         from orders o join order_lines ol on ol.order_id = o.id left join payments p on p.order_id = o.id
        where o.id::text like '${P}%' order by o.id`
    );
    const byOrder = Object.fromEntries(orders.map((r) => [r.id, r]));
    const { rows: [pa] } = await client.query("select booked from product_availability where product_id = $1", [PRODUCT_ID]);
    const { rows: entries } = await client.query(
      `select mp_payment_id, kind, reason_code from payment_reconciliation_entries where payment_id::text like '${P}%'`
    );
    const { rows: [hb] } = await client.query("select last_ok_at, last_error, stats from job_heartbeats where job_name = 'payments-reconcile'");
    const { rows: refunds } = await client.query(
      `select r.mp_payment_id, r.status, r.mp_refund_id, r.last_error, e.status as entry_status
         from payment_refunds r join payment_reconciliation_entries e on e.id = r.entry_id
        where r.payment_id::text like '${P}%' order by r.mp_payment_id`
    );
    const refundOf = (id) => refunds.find((r) => r.mp_payment_id === id);

    const checks = [
      [seen.me === 1, `GET /users/me appelé une fois (obtenu ${seen.me})`],
      [byOrder[ord(1)]?.payment_status === "paid", `S1 approuvé tardif → paid (obtenu ${byOrder[ord(1)]?.payment_status})`],
      [byOrder[ord(2)]?.line_status === "expired" && byOrder[ord(2)]?.pay_status === "cancelled", `S2 rien chez MP à 35 min → expirée (ligne ${byOrder[ord(2)]?.line_status}, paiement ${byOrder[ord(2)]?.pay_status})`],
      [seen.put.includes(910003) && byOrder[ord(3)]?.line_status === "expired", `S3 PSE > 2 h, annulation acceptée → PUT envoyé, expirée (ligne ${byOrder[ord(3)]?.line_status})`],
      [seen.put.includes(910004) && byOrder[ord(4)]?.payment_status === "paid" && byOrder[ord(4)]?.line_status === "reserved", `S4 PUT refusé, re-GET approuvé → payée, jamais expirée (${byOrder[ord(4)]?.payment_status}/${byOrder[ord(4)]?.line_status})`],
      [byOrder[ord(5)]?.line_status === "reserved" && byOrder[ord(5)]?.payment_status === "pending", `S5 collector_id étranger → rien ne bouge (${byOrder[ord(5)]?.line_status})`],
      [hb?.last_error?.includes("identity_mismatch") === true, `S5 heartbeat ok=false, identity_mismatch (last_error: ${hb?.last_error})`],
      [entries.some((e) => e.mp_payment_id === "910006" && e.reason_code === "paid_after_expiry"), `S6 approuvé après expiration (surveillance) → refund_required (entrées: ${JSON.stringify(entries)})`],
      // S2 et S3 rendent leur place (5 → 3) ; S1/S4 payées et S5 intacte gardent la leur.
      [pa?.booked === 3, `D1-bis places rendues : booked 5 → 3 (obtenu ${pa?.booked})`],
      [Number(hb?.stats?.mp_calls) <= 60, `budget d'appels respecté (${hb?.stats?.mp_calls})`],
      [refundOf("910007")?.status === "approved" && refundOf("910007")?.mp_refund_id === "55501" && refundOf("910007")?.entry_status === "resolved",
        `S7 remboursement approuvé par MP → approved, refund 55501, entrée résolue (${JSON.stringify(refundOf("910007"))})`],
      [seen.refunds.some((x) => x.id === 910007 && typeof x.idempotencyKey === "string" && x.idempotencyKey.length === 36),
        `S7 POST /refunds porte X-Idempotency-Key = payment_refunds.id (${JSON.stringify(seen.refunds)})`],
      [refundOf("910008")?.status === "rejected" && refundOf("910008")?.entry_status === "open" && /too-old/.test(refundOf("910008")?.last_error ?? ""),
        `S8 refus MP 4xx → rejected, entrée rouverte, corps conservé (${JSON.stringify(refundOf("910008"))})`],
    ];
    let failed = false;
    for (const [ok, label] of checks) {
      console.log(`${ok ? "OK " : "FAIL"} — ${label}`);
      if (!ok) failed = true;
    }
    if (failed) {
      console.error(
        `Échec — vérifier que supabase/functions/.env pointe MERCADOPAGO_API_BASE_URL vers http://host.docker.internal:${FIXTURE_PORT} ` +
          "avec MERCADOPAGO_ACCESS_TOKEN=TEST-fixture-token, et que supabase a été redémarré après ce réglage."
      );
      exitCode = 1;
    } else {
      console.log("payments-reconcile : intégration bout en bout vérifiée (8 scénarios).");
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await purge(client).catch((err) => console.error("Nettoyage final a échoué :", err));
    await client.end();
    await new Promise((resolve) => fixture.close(resolve));
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
