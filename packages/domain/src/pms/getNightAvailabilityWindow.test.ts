import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getNightAvailabilityRange,
  getNightAvailabilityWindow,
  nightsOfMonth,
  pickCategoryNights,
} from "./getNightAvailabilityWindow";

const CATEGORY_ID = 9631; // VIDPOVO, dortoir
const SIBLING_IDS = [9629, 18013, 29376, 36572, 49823]; // les 5 autres catégories de Casa Kayam
const ALL_IDS = [CATEGORY_ID, ...SIBLING_IDS];

// Sert des réponses différentes selon la nuit — permet de simuler, DANS UNE MÊME fenêtre, un
// mélange de nuits disponibles / pleines / en erreur / en quota, exactement les cas que la fenêtre
// doit distinguer depuis le 2026-08-28. `calls` compte les requêtes réellement émises : c'est ce
// qui prouve l'arrêt au premier échec ET la réduction R1, invisibles autrement.
//
// ⚠️ CE SERVEUR HONORE `end_date`, et ce n'est pas un détail de confort. Un serveur qui l'ignore
// rend VERT un test « un seul appel couvre 30 nuits » alors que le code ne lit qu'une nuit — le
// mode d'échec le plus dangereux du dossier. `rangeBehaviour` permet de rejouer explicitement ce
// monde-là et de prouver qu'on le détecte.
let server: Server;
let baseUrl: string;
let calls = 0;
// `honours` = ce que LobbyPMS fait RÉELLEMENT, mesuré le 2026-08-28 : la plage est honorée et
// `end_date` est INCLUSIF. Les deux autres valeurs rejouent des mondes réfutés, gardés parce que
// c'est en y échouant bruyamment que le code prouve qu'il ne peut pas se tromper en silence.
let rangeBehaviour: "honours" | "ignores_end_date" | "exclusive" = "honours";

function enumerateNights(startDate: string, endDate: string, inclusive: boolean): string[] {
  const nights: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(`${endDate}T00:00:00Z`);
  for (let guard = 0; guard < 400; guard += 1) {
    if (inclusive ? cursor > last : cursor >= last) break;
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

// Le catalogue d'une nuit : TOUTES les catégories, jamais une seule. C'est la forme observée le
// 2026-08-27 sur le compte Casa Kayam quand on n'envoie pas `category_id`.
function catalogFor(night: string): { category_id: number; available_rooms: number }[] {
  if (night === "2028-09-06") {
    // 200 parfaitement valide, mais notre catégorie n'y figure pas — cas distinct d'un
    // available_rooms:0, et distinct aussi d'une panne de fenêtre depuis R1.
    return SIBLING_IDS.map((id) => ({ category_id: id, available_rooms: 9 }));
  }
  const mine = night === "2028-09-07" ? 0 : 2;
  return [
    { category_id: CATEGORY_ID, available_rooms: mine },
    ...SIBLING_IDS.map((id) => ({ category_id: id, available_rooms: 9 })),
  ];
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/v2/available-rooms") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found in fixture server" }));
      return;
    }
    calls += 1;

    // R1 EST VÉRIFIÉ ICI, PAS SEULEMENT COMPTÉ. Depuis le 2026-08-28 le chemin de réservation ne
    // filtre plus par catégorie : si quelqu'un le réintroduit, le coût redevient 6 appels par nuit
    // pour Casa Kayam, en silence. Ce garde-fou transforme ce silence en test rouge.
    if (url.searchParams.has("category_id")) {
      res.writeHead(418, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "R1 : le chemin de réservation ne doit plus filtrer par category_id" }));
      return;
    }

    const startDate = url.searchParams.get("start_date") ?? "";
    const endDate = url.searchParams.get("end_date") ?? "";
    const nights =
      rangeBehaviour === "ignores_end_date"
        ? [startDate]
        : enumerateNights(startDate, endDate, rangeBehaviour !== "exclusive");

    // Le piège porte sur la nuit DEMANDÉE (start_date), pas sur une nuit quelconque de la plage
    // rendue. Sans cette précision, `end_date` étant inclusif, demander le 04 ferait échouer l'appel
    // parce que la réponse engloberait le 05 — un artefact de fixture, jamais un comportement de
    // Lobby, qui échoue par APPEL et non par nuit.
    const failing = [startDate].find((night) => night === "2028-09-05" || night === "2028-09-20");
    if (failing === "2028-09-05") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "internal error" }));
      return;
    }
    if (failing === "2028-09-20") {
      // Le mode d'échec réellement mesuré en préprod, et que rien ne testait : le plafond de débit.
      // Laravel répond 429 avec ces trois en-têtes — c'est Lobby qui dit sa propre limite.
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "37",
        "X-RateLimit-Limit": "60",
        "X-RateLimit-Remaining": "0",
      });
      res.end(JSON.stringify({ message: "Too Many Attempts." }));
      return;
    }

    const records = nights.map((night) => ({ date: night, categories: catalogFor(night) }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(records.length === 1 ? records[0] : { data: records }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  calls = 0;
  rangeBehaviour = "honours";
});

describe("getNightAvailabilityWindow (vrai fetch contre un serveur de fixtures local)", () => {
  it("rend la fenêtre complète quand toutes les nuits répondent, sur plus d'un lot de 6", async () => {
    const nights = [
      "2028-09-01",
      "2028-09-02",
      "2028-09-03",
      "2028-09-04",
      "2028-09-08",
      "2028-09-09",
      "2028-09-10",
      "2028-09-11",
    ];
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nights).toHaveLength(nights.length);
    expect(result.nights.map((row) => row.date)).toEqual(nights);

    const picked = pickCategoryNights(result.nights, CATEGORY_ID);
    expect(picked.missingDates).toEqual([]);
    expect(picked.nights.every((row) => row.capacity === 2 && row.booked === 0)).toBe(true);
  });

  it("une nuit pleine est une RÉPONSE, pas un échec : capacity 0, fenêtre complète", async () => {
    // La distinction qui porte tout : `available_rooms: 0` veut dire « complet » et se réserve
    // donc légitimement… pas. Un échec, lui, veut dire « je ne sais pas ».
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", ["2028-09-07"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pickCategoryNights(result.nights, CATEGORY_ID)).toEqual({
      nights: [{ date: "2028-09-07", capacity: 0, booked: 0 }],
      missingDates: [],
    });
  });

  it("une seule nuit en 500 fait échouer la FENÊTRE — jamais un résultat partiel muet", async () => {
    // Avant le 2026-08-28, ces deux nuits valides étaient rendues comme un succès et la troisième
    // disparaissait en silence : l'écran affichait un calendrier d'apparence normale.
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", [
      "2028-09-01",
      "2028-09-05",
      "2028-09-02",
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: "rejected", status: 500 });
    expect(result.requested).toBe(3);
  });

  it("« catégorie non cotée » n'est plus une panne de fenêtre : le catalogue est valide, c'est CE produit qui échoue", async () => {
    // Changement de responsabilité apporté par R1, et c'est délibéré. Le catalogue du 2028-09-06
    // est une réponse parfaite pour les 5 autres produits de l'établissement ; le mémoriser est
    // correct. Seule l'extraction de NOTRE catégorie échoue — et elle ne se tait pas.
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", ["2028-09-06"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pickCategoryNights(result.nights, CATEGORY_ID)).toEqual({
      nights: [],
      missingDates: ["2028-09-06"],
    });
    // …et les voisines, elles, sont servies normalement par la MÊME lecture.
    expect(pickCategoryNights(result.nights, SIBLING_IDS[0]).missingDates).toEqual([]);
  });

  it("nomme le quota et rapporte ce que Lobby dit de sa propre limite", async () => {
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", ["2028-09-20"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "rate_limited",
      status: 429,
      retryAfterSeconds: 37,
      limit: 60,
    });
  });

  it("s'arrête au premier lot en échec au lieu de creuser le quota", async () => {
    // 12 nuits = 2 lots. La 3e échoue : le second lot ne doit jamais partir, sinon un mur de quota
    // coûterait 6 appels de plus, tous certains d'échouer.
    const nights = [
      "2028-09-01",
      "2028-09-02",
      "2028-09-20",
      "2028-09-03",
      "2028-09-04",
      "2028-09-08",
      "2028-09-09",
      "2028-09-10",
      "2028-09-11",
      "2028-09-12",
      "2028-09-13",
      "2028-09-14",
    ];
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(false);
    expect(calls).toBe(6);
  });

  it("liste de nuits vide → fenêtre complète vide, zéro appel réseau", async () => {
    expect(await getNightAvailabilityWindow(baseUrl, "fake-token", [])).toEqual({ ok: true, nights: [] });
    expect(calls).toBe(0);
  });

  it("hôte injoignable → unreachable, jamais une exception qui remonte à l'appelant", async () => {
    const result = await getNightAvailabilityWindow("http://127.0.0.1:1", "fake-token", ["2028-09-01"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unreachable");
  });
});

describe("R1 — la suppression du filtre category_id, mesurée", () => {
  it("un mois de 30 nuits coûte 30 appels pour SIX produits, contre 180 avant", async () => {
    // Novembre plutôt que septembre : les nuits piégées de ce serveur (500, 429) sont toutes en
    // septembre, et une mesure de coût doit porter sur un mois qui répond normalement.
    const nights = nightsOfMonth("2028-11");
    expect(nights).toHaveLength(30);

    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // LA MESURE. Une seule lecture, et les six produits de l'établissement sont servis par elle.
    expect(calls).toBe(30);
    for (const categoryId of ALL_IDS) {
      const picked = pickCategoryNights(result.nights, categoryId);
      expect(picked.missingDates).toEqual([]);
      expect(picked.nights).toHaveLength(30);
    }

    // MESURE DE RÉFÉRENCE — le coût de l'ancien chemin, un appel par (nuit, catégorie). ⚠️ Ce
    // n'est pas un témoin : ces 180 requêtes sont émises à la main et n'exercent aucun code de
    // production. Elles établissent le dénominateur sur le MÊME serveur, au lieu de citer un
    // chiffre extrapolé.
    calls = 0;
    for (const categoryId of ALL_IDS) {
      for (const night of nights) {
        const url = new URL("/api/v2/available-rooms", baseUrl);
        url.searchParams.set("api_token", "fake-token");
        url.searchParams.set("category_id", String(categoryId));
        url.searchParams.set("start_date", night);
        url.searchParams.set("end_date", new Date(new Date(`${night}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10));
        await fetch(url.toString());
      }
    }
    expect(calls).toBe(180);
    // 180 → 30 : trois fois le plafond mesuré de 60 appels par fenêtre, ramené à la moitié.
  });
});

describe("getNightAvailabilityRange — un seul appel, pas encore branché sur la production", () => {
  it("couvre 31 nuits en UN appel, et chaque ligne porte la date rendue par Lobby", async () => {
    const nights = nightsOfMonth("2028-10"); // 31 nuits, aucune piégée
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(1);
    expect(result.nights.map((row) => row.date)).toEqual(nights);
    // `end_date` étant INCLUSIF (mesuré) et la production envoyant `dernière nuit + 1`, Lobby rend
    // 32 enregistrements pour 31 nuits demandées. La 32e est écartée PAR SA DATE, et la fenêtre
    // rendue fait exactement la taille demandée — c'est la seule chose qui compte.
    expect(result.nights).toHaveLength(31);
    expect(pickCategoryNights(result.nights, CATEGORY_ID).missingDates).toEqual([]);
  });

  it("⚠️ TÉMOIN — contre un Lobby qui IGNORE end_date, la plage ÉCHOUE au lieu d'être vraie qu'un jour sur 31", async () => {
    // C'est le monde qui rend un test de plage faussement vert : le serveur ne rend qu'une nuit,
    // le code étiquette 31 lignes, et personne ne voit rien. La couverture est vérifiée, donc ce
    // monde-là produit un échec bruyant et non un calendrier plausible.
    rangeBehaviour = "ignores_end_date";
    const nights = nightsOfMonth("2028-10");
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: "unparseable" });
    expect("bodyExcerpt" in result.failure && result.failure.bodyExcerpt).toContain("incomplete_coverage");
    expect(calls).toBe(1);
  });

  it("⚠️ TÉMOIN — même contre un Lobby dont end_date serait EXCLUSIF, la plage reste exacte", async () => {
    // L'inclusivité est mesurée (2026-08-28), donc c'est le cas nominal ci-dessus. Ce témoin joue
    // le monde inverse : si Lobby basculait un jour en exclusif, la grille ne se décalerait pas
    // davantage — parce qu'aucune ligne n'est jamais étiquetée par son rang.
    rangeBehaviour = "exclusive";
    const nights = nightsOfMonth("2028-10");
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nights.map((row) => row.date)).toEqual(nights);
    expect(calls).toBe(1);
  });

  it("plage vide → aucun appel", async () => {
    expect(await getNightAvailabilityRange(baseUrl, "fake-token", [])).toEqual({ ok: true, nights: [] });
    expect(calls).toBe(0);
  });
});

describe("nightsOfMonth", () => {
  it("génère toutes les nuits ISO d'un mois à 30 jours", () => {
    const nights = nightsOfMonth("2028-09");
    expect(nights).toHaveLength(30);
    expect(nights[0]).toBe("2028-09-01");
    expect(nights.at(-1)).toBe("2028-09-30");
  });

  it("génère toutes les nuits ISO d'un mois à 31 jours, dernière comprise", () => {
    // La dernière nuit d'un mois à 31 jours est la seule dont l'appel porte une date du mois
    // suivant (end_date = +1) : elle mérite une assertion à elle, pas seulement un compte.
    const nights = nightsOfMonth("2028-10");
    expect(nights).toHaveLength(31);
    expect(nights.at(-1)).toBe("2028-10-31");
  });

  it("gère février bissextile", () => {
    expect(nightsOfMonth("2028-02")).toHaveLength(29);
  });

  it("exclut les nuits strictement avant notBeforeIso (jamais interroger Lobby sur le passé)", () => {
    const nights = nightsOfMonth("2028-09", "2028-09-15");
    expect(nights[0]).toBe("2028-09-15");
    expect(nights).toHaveLength(16);
  });
});
