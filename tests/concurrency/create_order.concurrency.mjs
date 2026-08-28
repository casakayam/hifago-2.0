// Feature 6 (Client : composer un panier à plusieurs lignes sur une même commande,
// multi-établissement) — test de concurrence réelle de create_order, qui remplace
// reserve_order_line (20260813243000_create_order_rpc.sql). Même squelette que
// reserve_order_line.concurrency.mjs / spike_camp_resource.concurrency.mjs : driver `pg` direct,
// barrière de synchronisation, jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser
// (cf. hifago/CLAUDE.md §6).
//
// Deux scénarios dans le même fichier :
//   1. Régression (reprend reserve_order_line) : panier à 1 ligne, N=20 commandes concurrentes sur
//      une ressource à capacité 1 — exactement 1 succès, 19 échecs propres ('full'), pas de
//      survente en base.
//   2. Anti-deadlock (spécifique feature 6) : dérisque le verrouillage multi-ressources en ordre
//      stable (product_id, date) posé en phase 2 de la RPC. Paires de commandes à 2 lignes visant
//      les deux mêmes ressources A/B en ordre inverse (panier [A,B] vs [B,A]), lancées en masse et
//      en concurrence — capacité large pour isoler la question du deadlock de celle du plafond.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
// Environnement partagé avec d'autres agents : une erreur transitoire isolée (connexion, relation
// manquante) doit être re-testée après un `supabase db reset` frais avant de conclure à un bug.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres, par scénario

// Préfixe UUID dédié à ce fichier (60000000-…) — ne collisionne ni avec seed.sql (a0000000-…/
// b0000000-…), ni avec les autres tests de concurrence (10000000-…/20000000-…/99990000-…).
const PARTNER_ID = "60000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "60000000-0000-4000-8000-000000000002";
const ACCOUNT_ID = "60000000-0000-4000-8000-000000000003";

async function connectAuthenticated(count) {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const client = new Client({ connectionString: CONNECTION_STRING });
      await client.connect();
      await client.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: ACCOUNT_ID, role: "authenticated" }),
      ]);
      return client;
    })
  );
}

// Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun. Le signal ne se
// déclenche que lorsque TOUS les workers sont prêts, pour maximiser le chevauchement réel des
// requêtes FOR UPDATE dans la RPC.
function makeBarrier(count) {
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => {
    resolveGo = resolve;
  });
  function markReady() {
    if (++readyCount === count) resolveGo();
  }
  return { go, markReady };
}

async function endAll(clients) {
  await Promise.all(clients.map((client) => client.end()));
}

async function resetAll(seedClient) {
  // Nettoyage complet, dans l'ordre imposé par les FK (enfants avant parents). Portée large
  // (tous les produits de ESTABLISHMENT_ID, pas seulement ceux du scénario en cours) exprès : sans
  // ça, un run de scénario 2 juste après scénario 1 laisserait les produits du scénario 1 accrochés
  // à establishments/products par FK au moment de recréer l'identité, et réciproquement — un
  // filtrage par scénario avait initialement provoqué exactement cette violation de contrainte.
  await seedClient.query(
    `delete from order_lines
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from orders where account_id = $1", [ACCOUNT_ID]);
  await seedClient.query(
    `delete from product_availability
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from products where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from partner_accounts where id = $1", [ACCOUNT_ID]);
  await seedClient.query("delete from partners where id = $1", [PARTNER_ID]);
  await seedClient.query("delete from auth.users where id = $1", [ACCOUNT_ID]);

  await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
    ACCOUNT_ID,
    "create-order-concurrency@test.local",
  ]);
  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Create Order Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Concurrency Establishment" }),
  ]);
}

// --- Scénario 1 : régression — N paniers à 1 ligne sur une ressource à capacité 1 --------------
const SCENARIO_1_N = 20; // tentatives concurrentes visant la même ressource à capacité 1
const SCENARIO_1_PRODUCT_ID = "60000000-0000-4000-8000-000000000010";
const SCENARIO_1_DATE = "2028-06-01";

async function seedScenario1(seedClient) {
  // Suppression déjà faite par resetAll (portée large sur ESTABLISHMENT_ID) — cette fonction ne
  // fait que semer les données propres au scénario 1.
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Create order concurrency slot'), 50000, true, $4)`,
    [SCENARIO_1_PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "create-order-concurrency-slot"]
  );
  await seedClient.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 1, 0)",
    [SCENARIO_1_PRODUCT_ID, SCENARIO_1_DATE]
  );
}

async function runScenario1Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario1(seedClient);

  const clients = await connectAuthenticated(SCENARIO_1_N);
  const { go, markReady } = makeBarrier(SCENARIO_1_N);

  const lines = JSON.stringify([{ product_id: SCENARIO_1_PRODUCT_ID, date: SCENARIO_1_DATE, qty: 1 }]);

  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query(
        "select create_order($1::jsonb, $2, $3, $4, $5) as result",
        [lines, "Concurrency Buyer", "concurrency-buyer@hifago.test", null, false]
      );
      return res.rows[0].result;
    })
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "full");

  const { rows: state } = await seedClient.query(
    "select capacity, booked from product_availability where product_id = $1 and date = $2",
    [SCENARIO_1_PRODUCT_ID, SCENARIO_1_DATE]
  );
  const bookedMatchesCapacity = state.length === 1 && state[0].booked === state[0].capacity;

  console.log(
    `  [scénario 1] run ${run}: succès ${successes.length} / ${SCENARIO_1_N} (doit être exactement 1), ` +
      `échecs ${failures.length} (raison attendue: 'full'), rejets réseau/driver ${rejected.length}, ` +
      `booked=${state[0]?.booked} capacity=${state[0]?.capacity}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error(`    rejet inattendu (connexion/deadlock ?) : ${r.reason?.message ?? r.reason}`);
    }
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(
      `    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`
    );
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === 1 &&
    unexpectedFailureReasons.length === 0 &&
    bookedMatchesCapacity
  );
}

// --- Scénario 2 : anti-deadlock — paires de paniers à 2 lignes visant A/B en ordre inverse -----
// A et B : deux (product_id, date) distincts, capacité large (aucune commande ne doit échouer pour
// une raison de capacité — le but est de prouver l'ABSENCE de deadlock, pas de tester les
// plafonds). Chaque paire lance simultanément une commande X = panier [A, B] et une commande
// Y = panier [B, A] ; plusieurs paires concurrentes ciblent les 2 MÊMES ressources A/B pour
// maximiser la contention réelle sur le verrouillage.
const SCENARIO_2_PAIRS = 10; // 10 paires => 20 commandes concurrentes, comme le scénario 1
const SCENARIO_2_PRODUCT_A_ID = "60000000-0000-4000-8000-000000000020";
const SCENARIO_2_PRODUCT_B_ID = "60000000-0000-4000-8000-000000000021";
const SCENARIO_2_DATE_A = "2028-07-01";
const SCENARIO_2_DATE_B = "2028-07-15";
const SCENARIO_2_CAPACITY = 10000; // large : isole le deadlock du plafond

async function seedScenario2(seedClient) {
  // Suppression déjà faite par resetAll (portée large sur ESTABLISHMENT_ID) — cette fonction ne
  // fait que semer les données propres au scénario 2.
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values
       ($1, $3, $4, 'activity', jsonb_build_object('es', 'Anti-deadlock resource A'), 50000, true, $5),
       ($2, $3, $4, 'activity', jsonb_build_object('es', 'Anti-deadlock resource B'), 50000, true, $6)`,
    [
      SCENARIO_2_PRODUCT_A_ID,
      SCENARIO_2_PRODUCT_B_ID,
      PARTNER_ID,
      ESTABLISHMENT_ID,
      "anti-deadlock-resource-a",
      "anti-deadlock-resource-b",
    ]
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked) values
       ($1, $2, $5, 0),
       ($3, $4, $5, 0)`,
    [
      SCENARIO_2_PRODUCT_A_ID,
      SCENARIO_2_DATE_A,
      SCENARIO_2_PRODUCT_B_ID,
      SCENARIO_2_DATE_B,
      SCENARIO_2_CAPACITY,
    ]
  );
}

async function runScenario2Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario2(seedClient);

  const totalOrders = SCENARIO_2_PAIRS * 2;
  const clients = await connectAuthenticated(totalOrders);
  const { go, markReady } = makeBarrier(totalOrders);

  const cartXAB = JSON.stringify([
    { product_id: SCENARIO_2_PRODUCT_A_ID, date: SCENARIO_2_DATE_A, qty: 1 },
    { product_id: SCENARIO_2_PRODUCT_B_ID, date: SCENARIO_2_DATE_B, qty: 1 },
  ]);
  const cartYBA = JSON.stringify([
    { product_id: SCENARIO_2_PRODUCT_B_ID, date: SCENARIO_2_DATE_B, qty: 1 },
    { product_id: SCENARIO_2_PRODUCT_A_ID, date: SCENARIO_2_DATE_A, qty: 1 },
  ]);

  // Timeout de garde : un vrai interblocage non résolu par le tri stable ferait pendre les
  // requêtes bien au-delà du deadlock_timeout de Postgres (1s par défaut, qui lève normalement une
  // erreur "deadlock detected" côté driver) — même filet que spike_camp_resource scénario 3.
  const timeoutMs = 15000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} : timeout après ${timeoutMs}ms (interblocage suspecté)`)),
          timeoutMs
        )
      ),
    ]);

  const orders = clients.map((client, i) => ({
    client,
    // Alterne strictement X/Y au sein de chaque paire, pour que la moitié des commandes verrouille
    // dans l'ordre soumis [A, B] et l'autre moitié dans l'ordre inverse [B, A] — c'est le tri
    // stable (product_id, date) interne à la RPC qui doit ramener les deux à un seul ordre réel de
    // verrouillage.
    cart: i % 2 === 0 ? cartXAB : cartYBA,
    label: i % 2 === 0 ? "X[A,B]" : "Y[B,A]",
  }));

  const settled = await withTimeout(
    Promise.allSettled(
      orders.map(async ({ client, cart }) => {
        markReady();
        await go;
        const res = await client.query(
          "select create_order($1::jsonb, $2, $3, $4, $5) as result",
          [cart, "Concurrency Buyer", "concurrency-buyer@hifago.test", null, false]
        );
        return res.rows[0].result;
      })
    ),
    `scénario 2 run ${run}`
  );

  const rejected = settled
    .map((s, i) => ({ ...s, label: orders[i].label }))
    .filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);

  const deadlockOrTimeoutRejections = rejected.filter((r) => {
    const msg = (r.reason?.message ?? String(r.reason)).toLowerCase();
    return msg.includes("deadlock") || msg.includes("timeout") || msg.includes("interblocage");
  });

  const { rows: state } = await seedClient.query(
    `select product_id, date, capacity, booked from product_availability
      where product_id in ($1, $2) order by product_id, date`,
    [SCENARIO_2_PRODUCT_A_ID, SCENARIO_2_PRODUCT_B_ID]
  );
  // Chaque ressource reçoit exactement 1 unité par commande réussie (toutes les commandes
  // touchent A ET B) — la capacité étant large, tout succès doit se refléter fidèlement en base.
  const expectedBooked = successes.length;
  const bookedConsistent = state.every((row) => row.booked === expectedBooked);

  console.log(
    `  [scénario 2] run ${run}: succès ${successes.length} / ${totalOrders} (doit être ${totalOrders}, capacité large), ` +
      `échecs ${failures.length}, rejets ${rejected.length} (dont deadlock/timeout: ${deadlockOrTimeoutRejections.length}), ` +
      `booked A=${state[0]?.booked}/${state[0]?.capacity} B=${state[1]?.booked}/${state[1]?.capacity}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error(`    rejet [${r.label}] : ${r.reason?.message ?? r.reason}`);
    }
  }
  if (failures.length > 0) {
    console.error(`    échecs applicatifs inattendus : ${JSON.stringify(failures)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    deadlockOrTimeoutRejections.length === 0 &&
    rejected.length === 0 &&
    failures.length === 0 &&
    successes.length === totalOrders &&
    bookedConsistent
  );
}

async function runScenario(name, runOnce) {
  console.log(`\n=== ${name} — ${RUNS} runs consécutifs requis ===`);
  for (let run = 1; run <= RUNS; run++) {
    let clean;
    try {
      clean = await runOnce(run);
    } catch (err) {
      console.error(`  [${name}] run ${run} a levé une erreur : ${err.message}`);
      clean = false;
    }
    if (!clean) {
      console.error(`\nÉCHEC — ${name}, run ${run}/${RUNS}. Zéro tolérance à un échec isolé.`);
      return false;
    }
  }
  console.log(`  ${RUNS} runs consécutifs propres pour "${name}".`);
  return true;
}

async function main() {
  const scenario1Ok = await runScenario(
    "Scénario 1 — régression (panier à 1 ligne, N=20 sur une ressource à capacité 1)",
    runScenario1Once
  );
  if (!scenario1Ok) process.exit(1);

  const scenario2Ok = await runScenario(
    "Scénario 2 — anti-deadlock (paires de paniers [A,B] vs [B,A], verrouillage en ordre stable)",
    runScenario2Once
  );
  if (!scenario2Ok) process.exit(1);

  console.log(
    "\nTous les scénarios ont tenu leurs 5 runs consécutifs propres — create_order (panier multi-lignes) validé sous concurrence réelle."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
