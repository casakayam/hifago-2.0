// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — test de concurrence
// réelle de create_order sur des plages de nuits (chambre d'hôtel, room_type_id + end_date), barre
// d'acceptation élevée par rapport au patron camp (cf. §0 Tranche 2 "Tests") : le camp traite le
// chevauchement comme un cas rare en plus des tests de régression, ici les plages qui se
// chevauchent partiellement sur la même chambre sont le cas quotidien dominant. Même squelette que
// create_order_camp.concurrency.mjs : driver `pg` direct, barrière de synchronisation, jamais
// pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser (cf. hifago/CLAUDE.md §6).
//
// 3 scénarios :
//   1. Régression — plages IDENTIQUES : N réservations de la même chambre/même plage à capacité 1
//      → exactement 1 succès.
//   2. Chevauchement partiel/imbriqué avec qty multiples — plusieurs plages différentes (certaines
//      imbriquées, certaines qty>1) contestant une fenêtre de nuits à capacité serrée → jamais
//      booked > capacity sur AUCUNE nuit, quel que soit le nombre de succès.
//   3. Plages ADJACENTES (aucune nuit commune) — preuve que le verrouillage par nuit ne crée aucune
//      contention artificielle entre deux plages qui ne se touchent pas : les deux groupes doivent
//      pouvoir remplir leur propre capacité en parallèle, sans se bloquer l'un l'autre.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;

// Préfixe UUID dédié (80000000-…) — distinct des préfixes déjà utilisés par les autres fichiers de
// concurrence (00000000-/20000000-/60000000-/70000000-/99990000-) et de seed.sql (a0000000-/
// b0000000-).
const PARTNER_ID = "80000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "80000000-0000-4000-8000-000000000002";
const ACCOUNT_ID = "80000000-0000-4000-8000-000000000003";
const HOTEL_PRODUCT_ID = "80000000-0000-4000-8000-000000000004";

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
  await seedClient.query(
    `delete from order_lines
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from orders where account_id = $1", [ACCOUNT_ID]);
  await seedClient.query(
    `delete from room_type_availability
      where room_type_id in (
        select id from product_room_types where product_id in (
          select id from products where establishment_id = $1
        )
      )`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query(
    `delete from product_room_types
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
    "create-order-room-range-concurrency@test.local",
  ]);
  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Create Order Room Range Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Room Range Concurrency Establishment" }),
  ]);
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, sellable, slug)
     values ($1, $2, $3, 'hotel', $4, true, $5)`,
    [
      HOTEL_PRODUCT_ID,
      PARTNER_ID,
      ESTABLISHMENT_ID,
      JSON.stringify({ es: "Hotel Room Range Concurrency" }),
      "room-range-concurrency-hotel",
    ]
  );
}

// --- Scénario 1 : régression — N réservations de la MÊME chambre/MÊME plage, capacité 1 ---------
const SCENARIO_1_N = 20;
const ROOM_1_ID = "80000000-0000-4000-8000-000000000010";
const SCENARIO_1_START = "2029-03-01";
const SCENARIO_1_END = "2029-03-04"; // 3 nuits

async function seedScenario1(seedClient) {
  await seedClient.query(
    `insert into product_room_types (id, product_id, kind, name, capacity, quantity, price_cop, min_qty, max_qty)
     values ($1, $2, 'private', $3, 2, 1, 100000, 1, 1)`,
    [ROOM_1_ID, HOTEL_PRODUCT_ID, JSON.stringify({ es: "Room Range Concurrency Regression" })]
  );
  await seedClient.query(
    `insert into room_type_availability (room_type_id, date, capacity, booked)
     select $1, $2::date + n, 1, 0 from generate_series(0, 2) as n`,
    [ROOM_1_ID, SCENARIO_1_START]
  );
}

async function runScenario1Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario1(seedClient);

  const clients = await connectAuthenticated(SCENARIO_1_N);
  const { go, markReady } = makeBarrier(SCENARIO_1_N);

  const lines = JSON.stringify([
    { product_id: HOTEL_PRODUCT_ID, room_type_id: ROOM_1_ID, date: SCENARIO_1_START, end_date: SCENARIO_1_END, qty: 1 },
  ]);

  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query(
        "select create_order($1::jsonb, $2, $3, $4, $5) as result",
        [lines, "Concurrency Room Range Buyer", "concurrency-room-range-buyer@hifago.test", null, false]
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
    "select date, capacity, booked from room_type_availability where room_type_id = $1 order by date",
    [ROOM_1_ID]
  );
  const bookedMatchesCapacity = state.every((row) => row.booked === row.capacity);
  const noOversell = state.every((row) => row.booked <= row.capacity);

  console.log(
    `  [scénario 1] run ${run}: succès ${successes.length} / ${SCENARIO_1_N} (doit être exactement 1), ` +
      `échecs ${failures.length} (raison attendue: 'full'), rejets ${rejected.length}, ` +
      `booked/capacity par nuit=${state.map((r) => `${r.booked}/${r.capacity}`).join(",")}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === 1 &&
    unexpectedFailureReasons.length === 0 &&
    bookedMatchesCapacity &&
    noOversell
  );
}

// --- Scénario 2 : plages imbriquées/chevauchantes + qty multiples, fenêtre à capacité serrée ----
// Chambre DORM, capacité 4 lits/nuit sur une fenêtre de 5 nuits. 15 tentatives concurrentes, qty
// variable (1 à 3), plages qui se chevauchent partiellement et s'imbriquent (pas seulement des
// doublons identiques comme le scénario 1) — le cas quotidien dominant pour une chambre d'hôtel.
const ROOM_2_ID = "80000000-0000-4000-8000-000000000020";
const SCENARIO_2_BASE = "2029-04-01"; // fenêtre 2029-04-01..06 (5 nuits)
const SCENARIO_2_CAPACITY = 4;

// Chaque tentative réserve une sous-plage de [01,06[ avec une qty donnée — construites pour que la
// somme totale demandée (bien au-delà de 4×5=20 lits-nuits) dépasse largement la capacité si tout
// était accepté naïvement, tout en variant démarrage/durée/qty pour produire un vrai mélange
// imbriqué/chevauchant plutôt que des doublons.
function scenario2Attempts() {
  const shapes = [
    { offset: 0, nights: 2, qty: 2 }, // 01-03
    { offset: 0, nights: 4, qty: 1 }, // 01-05 (imbrique la précédente)
    { offset: 1, nights: 2, qty: 3 }, // 02-04
    { offset: 2, nights: 3, qty: 2 }, // 03-06
    { offset: 3, nights: 2, qty: 2 }, // 04-06
  ];
  const attempts = [];
  for (let i = 0; i < 15; i++) attempts.push(shapes[i % shapes.length]);
  return attempts;
}

async function seedScenario2(seedClient) {
  await seedClient.query(
    `insert into product_room_types (id, product_id, kind, name, capacity, quantity, price_cop, min_qty, max_qty)
     values ($1, $2, 'dorm', $3, 4, 1, 20000, 1, 4)`,
    [ROOM_2_ID, HOTEL_PRODUCT_ID, JSON.stringify({ es: "Room Range Concurrency Overlap" })]
  );
  await seedClient.query(
    `insert into room_type_availability (room_type_id, date, capacity, booked)
     select $1, $2::date + n, $3, 0 from generate_series(0, 4) as n`,
    [ROOM_2_ID, SCENARIO_2_BASE, SCENARIO_2_CAPACITY]
  );
}

async function runScenario2Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario2(seedClient);

  const attempts = scenario2Attempts();
  const clients = await connectAuthenticated(attempts.length);
  const { go, markReady } = makeBarrier(attempts.length);

  const timeoutMs = 15000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} : timeout après ${timeoutMs}ms (interblocage suspecté)`)), timeoutMs)
      ),
    ]);

  const settled = await withTimeout(
    Promise.allSettled(
      clients.map(async (client, i) => {
        const { offset, nights, qty } = attempts[i];
        const lines = JSON.stringify([
          {
            product_id: HOTEL_PRODUCT_ID,
            room_type_id: ROOM_2_ID,
            date: `2029-04-${String(1 + offset).padStart(2, "0")}`,
            end_date: `2029-04-${String(1 + offset + nights).padStart(2, "0")}`,
            qty,
          },
        ]);
        markReady();
        await go;
        const res = await client.query(
          "select create_order($1::jsonb, $2, $3, $4, $5) as result",
          [lines, `Concurrency Room Overlap Buyer ${i}`, `concurrency-room-overlap-${i}@hifago.test`, null, false]
        );
        return res.rows[0].result;
      })
    ),
    `scénario 2 run ${run}`
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "full");

  const { rows: state } = await seedClient.query(
    "select date, capacity, booked from room_type_availability where room_type_id = $1 order by date",
    [ROOM_2_ID]
  );
  const noOversell = state.every((row) => row.booked <= row.capacity);

  // Recompte indépendant : la somme des qty des lignes RÉELLEMENT écrites en base, par nuit,
  // doit correspondre exactement à `booked` — preuve que le compteur n'a pas dérivé du contenu
  // réel des lignes acceptées (pas seulement une confiance dans le nombre de `ok:true` rapportés).
  const { rows: reconciled } = await seedClient.query(
    `select gs::date as night, coalesce(sum(ol.qty), 0)::int as sum_qty
       from generate_series($1::date, $1::date + 4, interval '1 day') as gs
       left join order_lines ol
         on ol.room_type_id = $2 and gs::date >= ol.date and gs::date < ol.end_date
      group by gs order by gs`,
    [SCENARIO_2_BASE, ROOM_2_ID]
  );
  const reconciliationMatches = state.every((row) => {
    const match = reconciled.find((r) => r.night.toISOString().slice(0, 10) === row.date.toISOString().slice(0, 10));
    return match && match.sum_qty === row.booked;
  });

  console.log(
    `  [scénario 2] run ${run}: succès ${successes.length} / ${attempts.length}, échecs ${failures.length} ` +
      `(raison attendue: 'full'), rejets ${rejected.length}, ` +
      `booked/capacity par nuit=${state.map((r) => `${r.booked}/${r.capacity}`).join(",")}` +
      (noOversell ? "" : " — SURVENTE DÉTECTÉE") +
      (reconciliationMatches ? "" : " — RÉCONCILIATION INCOHÉRENTE")
  );
  if (rejected.length > 0) {
    for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    unexpectedFailureReasons.length === 0 &&
    noOversell &&
    reconciliationMatches &&
    successes.length > 0 // la fenêtre a assez de capacité pour qu'au moins une tentative réussisse
  );
}

// --- Scénario 3 : plages ADJACENTES (aucune nuit commune) — pas de contention artificielle ------
// Deux groupes de tentatives concurrentes sur la MÊME chambre mais des plages totalement disjointes
// (A = nuits 1-2, B = nuits 3-4) : verrouillées séparément (clés (room_type_id, date) distinctes),
// donc les deux groupes doivent pouvoir consommer leur propre capacité (2 chacun) en parallèle,
// sans qu'aucun succès de A ne bloque ou fasse échouer un succès de B à tort.
const ROOM_3_ID = "80000000-0000-4000-8000-000000000030";
const SCENARIO_3_GROUP_N = 8;
const SCENARIO_3_CAPACITY = 2;
const SCENARIO_3_A_START = "2029-05-01"; // nuits 1-2 (01,02)
const SCENARIO_3_A_END = "2029-05-03";
const SCENARIO_3_B_START = "2029-05-03"; // nuits 3-4 (03,04) — adjacente à A, jamais la même nuit
const SCENARIO_3_B_END = "2029-05-05";

async function seedScenario3(seedClient) {
  await seedClient.query(
    `insert into product_room_types (id, product_id, kind, name, capacity, quantity, price_cop, min_qty, max_qty)
     values ($1, $2, 'private', $3, 1, 2, 100000, 1, 1)`,
    [ROOM_3_ID, HOTEL_PRODUCT_ID, JSON.stringify({ es: "Room Range Concurrency Adjacent" })]
  );
  await seedClient.query(
    `insert into room_type_availability (room_type_id, date, capacity, booked)
     select $1, $2::date + n, $3, 0 from generate_series(0, 3) as n`,
    [ROOM_3_ID, SCENARIO_3_A_START, SCENARIO_3_CAPACITY]
  );
}

async function runScenario3Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario3(seedClient);

  const groupAClients = await connectAuthenticated(SCENARIO_3_GROUP_N);
  const groupBClients = await connectAuthenticated(SCENARIO_3_GROUP_N);
  const { go, markReady } = makeBarrier(SCENARIO_3_GROUP_N * 2);

  const linesA = JSON.stringify([
    { product_id: HOTEL_PRODUCT_ID, room_type_id: ROOM_3_ID, date: SCENARIO_3_A_START, end_date: SCENARIO_3_A_END, qty: 1 },
  ]);
  const linesB = JSON.stringify([
    { product_id: HOTEL_PRODUCT_ID, room_type_id: ROOM_3_ID, date: SCENARIO_3_B_START, end_date: SCENARIO_3_B_END, qty: 1 },
  ]);

  const timeoutMs = 15000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} : timeout après ${timeoutMs}ms (interblocage suspecté)`)), timeoutMs)
      ),
    ]);

  const [resultsA, resultsB] = await withTimeout(
    Promise.all([
      Promise.allSettled(
        groupAClients.map(async (client) => {
          markReady();
          await go;
          const res = await client.query(
            "select create_order($1::jsonb, $2, $3, $4, $5) as result",
            [linesA, "Concurrency Room Adjacent A", "concurrency-room-adjacent-a@hifago.test", null, false]
          );
          return res.rows[0].result;
        })
      ),
      Promise.allSettled(
        groupBClients.map(async (client) => {
          markReady();
          await go;
          const res = await client.query(
            "select create_order($1::jsonb, $2, $3, $4, $5) as result",
            [linesB, "Concurrency Room Adjacent B", "concurrency-room-adjacent-b@hifago.test", null, false]
          );
          return res.rows[0].result;
        })
      ),
    ]),
    `scénario 3 run ${run}`
  );

  const allSettled = [...resultsA, ...resultsB];
  const rejected = allSettled.filter((s) => s.status === "rejected");
  const successesA = resultsA.filter((s) => s.status === "fulfilled" && s.value.ok).length;
  const successesB = resultsB.filter((s) => s.status === "fulfilled" && s.value.ok).length;
  const results = allSettled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "full");

  const { rows: state } = await seedClient.query(
    "select date, capacity, booked from room_type_availability where room_type_id = $1 order by date",
    [ROOM_3_ID]
  );
  const noOversell = state.every((row) => row.booked <= row.capacity);

  console.log(
    `  [scénario 3] run ${run}: succès A=${successesA}/${SCENARIO_3_GROUP_N} (capacité ${SCENARIO_3_CAPACITY}), ` +
      `succès B=${successesB}/${SCENARIO_3_GROUP_N} (capacité ${SCENARIO_3_CAPACITY}) — les deux DOIVENT atteindre leur capacité, ` +
      `rejets ${rejected.length}` + (noOversell ? "" : " — SURVENTE DÉTECTÉE")
  );
  if (rejected.length > 0) {
    for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }

  await endAll(groupAClients);
  await endAll(groupBClients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    unexpectedFailureReasons.length === 0 &&
    noOversell &&
    successesA === SCENARIO_3_CAPACITY &&
    successesB === SCENARIO_3_CAPACITY
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
  const s1 = await runScenario(
    "Scénario 1 — régression (N réservations de la même plage/chambre, capacité 1)",
    runScenario1Once
  );
  if (!s1) process.exit(1);

  const s2 = await runScenario(
    "Scénario 2 — plages imbriquées/chevauchantes + qty multiples, fenêtre à capacité serrée",
    runScenario2Once
  );
  if (!s2) process.exit(1);

  const s3 = await runScenario(
    "Scénario 3 — plages adjacentes (aucune nuit commune, pas de contention artificielle)",
    runScenario3Once
  );
  if (!s3) process.exit(1);

  console.log(
    "\nTous les scénarios ont tenu leurs 5 runs consécutifs propres — create_order (chambre par plage) validé sous concurrence réelle."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
