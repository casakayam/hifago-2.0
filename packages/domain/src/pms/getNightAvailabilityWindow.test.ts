import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getNightAvailabilityWindow, nightsOfMonth } from "./getNightAvailabilityWindow";

const CATEGORY_ID = 9631;

// Sert des réponses différentes selon start_date — permet de simuler, DANS UN MÊME appel, un
// mélange de nuits disponibles / pleines / en erreur / en quota, exactement les cas que la fenêtre
// doit distinguer depuis le 2026-08-28. `calls` compte les requêtes réellement émises : c'est ce
// qui prouve l'arrêt au premier échec, invisible autrement.
let server: Server;
let baseUrl: string;
let calls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/v2/available-rooms") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found in fixture server" }));
      return;
    }
    calls += 1;
    const startDate = url.searchParams.get("start_date");

    if (startDate === "2028-09-05") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "internal error" }));
      return;
    }
    if (startDate === "2028-09-06") {
      // 200 mais la catégorie demandée n'est pas cotée — distinct d'un available_rooms:0.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ date: startDate, categories: [{ category_id: 2523, available_rooms: 9 }] }));
      return;
    }
    if (startDate === "2028-09-07") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ date: startDate, categories: [{ category_id: CATEGORY_ID, available_rooms: 0 }] }));
      return;
    }
    if (startDate === "2028-09-20") {
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

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ date: startDate, categories: [{ category_id: CATEGORY_ID, available_rooms: 2 }] }));
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
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nights).toHaveLength(nights.length);
    expect(result.nights.every((row) => row.capacity === 2 && row.booked === 0)).toBe(true);
  });

  it("une nuit pleine est une RÉPONSE, pas un échec : capacity 0, fenêtre complète", async () => {
    // La distinction qui porte tout : `available_rooms: 0` veut dire « complet » et se réserve
    // donc légitimement… pas. Un échec, lui, veut dire « je ne sais pas ».
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, ["2028-09-07"]);
    expect(result).toEqual({ ok: true, nights: [{ date: "2028-09-07", capacity: 0, booked: 0 }] });
  });

  it("une seule nuit en 500 fait échouer la FENÊTRE — jamais un résultat partiel muet", async () => {
    // Avant le 2026-08-28, ces deux nuits valides étaient rendues comme un succès et la troisième
    // disparaissait en silence : l'écran affichait un calendrier d'apparence normale.
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, [
      "2028-09-01",
      "2028-09-05",
      "2028-09-02",
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: "rejected", status: 500 });
    expect(result.requested).toBe(3);
  });

  it("distingue « catégorie non cotée » d'un rejet HTTP", async () => {
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, ["2028-09-06"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unparseable");
  });

  it("nomme le quota et rapporte ce que Lobby dit de sa propre limite", async () => {
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, ["2028-09-20"]);
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
    const result = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, nights);
    expect(result.ok).toBe(false);
    expect(calls).toBe(6);
  });

  it("liste de nuits vide → fenêtre complète vide, zéro appel réseau", async () => {
    expect(await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, [])).toEqual({
      ok: true,
      nights: [],
    });
    expect(calls).toBe(0);
  });

  it("hôte injoignable → unreachable, jamais une exception qui remonte à l'appelant", async () => {
    const result = await getNightAvailabilityWindow("http://127.0.0.1:1", "fake-token", CATEGORY_ID, [
      "2028-09-01",
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unreachable");
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
