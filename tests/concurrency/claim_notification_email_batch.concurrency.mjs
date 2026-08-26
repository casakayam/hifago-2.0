// Spec 23 Tranche 1 §9 — preuve concurrente que claim_notification_email_batch (SKIP LOCKED)
// n'attribue jamais la même ligne à deux invocations concurrentes du cron. pgTAP ne peut PAS
// prouver ceci (une seule transaction/session active par fichier, cf. hifago/CLAUDE.md §6.3) —
// squelette barrière de synchronisation copié de docs/05-reference-technique.md §2 (driver `pg`
// direct, pas Playwright/HTTP).
//
// Calibrage volontairement plus léger que la barre "5 runs propres" réservée aux RPC anti-survente
// (docs/05-reference-technique.md §2) — même raisonnement déjà appliqué à moderate_product_proposal
// (cf. son commentaire de tête, 20260813240500_moderate_product_proposal_rpc.sql) : une collision
// ici cause un envoi en double/différé, pas une survente financière. 1 exécution propre suffit
// pour ce premier périmètre (spec 23 §9).
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N = 5; // connexions concurrentes
const ROWS_PER_CLAIM = 10; // 5 * 10 = 50 potentiel vs 25 lignes réelles → chevauchement forcé
const TOTAL_ROWS = 25;

async function main() {
  const setupClient = new Client({ connectionString: CONNECTION_STRING });
  await setupClient.connect();

  let exitCode = 0;
  const clients = [];

  try {
    await setupClient.query("delete from notification_emails where recipient_email like 'concurrency-claim-%@test.local'");
    const values = [];
    const params = [];
    for (let i = 0; i < TOTAL_ROWS; i++) {
      values.push(`('partner_invitation', $${i + 1}, 'Concurrency test', '<p>c</p>')`);
      params.push(`concurrency-claim-${i}@test.local`);
    }
    await setupClient.query(
      `insert into notification_emails (event_type, recipient_email, subject, body_html) values ${values.join(",")}`,
      params
    );

    for (let i = 0; i < N; i++) {
      const client = new Client({ connectionString: CONNECTION_STRING });
      await client.connect();
      clients.push(client);
    }

    // Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun — maximise le
    // chevauchement réel des requêtes FOR UPDATE SKIP LOCKED (docs/05-reference-technique.md §2).
    let readyCount = 0;
    let resolveGo;
    const go = new Promise((resolve) => { resolveGo = resolve; });
    function markReady() { if (++readyCount === N) resolveGo(); }

    const results = await Promise.all(
      clients.map(async (client) => {
        markReady();
        await go;
        const res = await client.query("select id from claim_notification_email_batch($1)", [ROWS_PER_CLAIM]);
        return res.rows.map((r) => r.id);
      })
    );

    const allIds = results.flat();
    const uniqueIds = new Set(allIds);

    const checks = [
      [allIds.length === uniqueIds.size, `aucun id réclamé deux fois (obtenu : ${allIds.length} claims, ${uniqueIds.size} ids uniques)`],
      [allIds.length === TOTAL_ROWS, `les ${TOTAL_ROWS} lignes seedées sont toutes réclamées exactement une fois (obtenu : ${allIds.length})`],
    ];

    let failed = false;
    for (const [ok, label] of checks) {
      console.log(`${ok ? "OK " : "FAIL"} — ${label}`);
      if (!ok) failed = true;
    }

    if (failed) {
      exitCode = 1;
    } else {
      console.log("claim_notification_email_batch : SKIP LOCKED vérifié sous concurrence réelle.");
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await setupClient
      .query("delete from notification_emails where recipient_email like 'concurrency-claim-%@test.local'")
      .catch((err) => console.error("Nettoyage final a échoué :", err));
    await setupClient.end();
    for (const client of clients) await client.end();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
