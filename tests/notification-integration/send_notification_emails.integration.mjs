// Spec 23 Tranche 1 — test d'intégration RÉEL de l'Edge Function send-notification-emails contre
// la stack Supabase locale, miroir exact de tests/pms-integration/pms_poll_bookings.integration.mjs
// (driver `pg` direct, process.exit, serveur de fixtures node:http — jamais un vrai envoi Resend).
//
// PRÉREQUIS avant de lancer ce script :
//   1. npx supabase start actif (redémarré après tout changement de supabase/functions/.env).
//   2. supabase/functions/.env contient RESEND_API_BASE_URL=http://host.docker.internal:4546 et
//      RESEND_API_KEY=<valeur factice> — SANS ce réglage, la fonction pointerait vers le vrai
//      api.resend.com, jamais souhaitable en test.
import pg from "pg";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const { Client } = pg;
const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FUNCTIONS_URL = "http://127.0.0.1:54321/functions/v1/send-notification-emails";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const FIXTURE_PORT = 4546;

// Deux lignes : une qui doit réussir (succès Resend simulé), une qui doit échouer (statut 422
// simulé) — prouve que send-notification-emails traite chaque ligne isolément (spec 23 §8.2 —
// même discipline d'isolation par destinataire que côté SQL) et ne bloque jamais le lot entier sur
// une seule ligne en échec.
const OK_EMAIL = "notification-integration-ok@test.local";
const FAIL_EMAIL = "notification-integration-fail@test.local";
const receivedIdempotencyKeys = [];

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/emails") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const payload = JSON.parse(raw);
        receivedIdempotencyKeys.push(req.headers["idempotency-key"]);
        if (payload.to === FAIL_EMAIL) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "simulated Resend rejection" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: `fixture-message-${randomUUID()}` }));
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unhandled by fixture server" }));
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

async function purgeFixtures(client) {
  await client.query("delete from notification_emails where recipient_email in ($1, $2)", [OK_EMAIL, FAIL_EMAIL]);
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  const fixtureServer = await startFixtureServer();
  let exitCode = 0;

  try {
    await purgeFixtures(client);

    const { rows: inserted } = await client.query(
      `insert into notification_emails (event_type, recipient_email, subject, body_html)
       values ('partner_invitation', $1, 'Integration OK', '<p>ok</p>'),
              ('partner_invitation', $2, 'Integration FAIL', '<p>fail</p>')
       returning id, recipient_email`,
      [OK_EMAIL, FAIL_EMAIL]
    );
    const okId = inserted.find((r) => r.recipient_email === OK_EMAIL).id;
    const failId = inserted.find((r) => r.recipient_email === FAIL_EMAIL).id;

    const response = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error(`send-notification-emails a répondu ${response.status} : ${await response.text()}`);
    }
    const summary = await response.json();
    console.log("Réponse send-notification-emails :", summary);

    const checks = [
      [
        !("recipient_email" in summary) && !("subject" in summary) && !("body_html" in summary),
        "réponse HTTP strictement agrégée, aucune PII (spec 23 §8.6)",
      ],
    ];

    const { rows } = await client.query(
      "select id, status, provider_message_id, last_error, attempts from notification_emails where id = any($1)",
      [[okId, failId]]
    );
    const ok = rows.find((r) => r.id === okId);
    const fail = rows.find((r) => r.id === failId);

    checks.push(
      [ok?.status === "sent", `ligne OK → status='sent' (obtenu: ${ok?.status})`],
      [!!ok?.provider_message_id, `ligne OK → provider_message_id renseigné (obtenu: ${ok?.provider_message_id})`],
      [fail?.status === "pending" && fail?.attempts === 1, `ligne FAIL → reste 'pending' pour retry après 1 tentative (obtenu: ${fail?.status}/${fail?.attempts})`],
      [!!fail?.last_error, "ligne FAIL → last_error renseigné"],
      [receivedIdempotencyKeys.includes(okId), "en-tête Idempotency-Key transmis à Resend (spec 23 §8.4)"]
    );

    let failed = false;
    for (const [okCheck, label] of checks) {
      console.log(`${okCheck ? "OK " : "FAIL"} — ${label}`);
      if (!okCheck) failed = true;
    }

    if (failed) {
      console.error(
        "Échec — vérifier que supabase/functions/.env pointe bien RESEND_API_BASE_URL vers " +
          `http://host.docker.internal:${FIXTURE_PORT} et que supabase a été redémarré après ce réglage.`
      );
      exitCode = 1;
    } else {
      console.log("send-notification-emails : intégration bout en bout vérifiée.");
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
