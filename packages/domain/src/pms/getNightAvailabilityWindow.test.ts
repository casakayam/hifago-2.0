import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getNightAvailabilityWindow, nightsOfMonth } from "./getNightAvailabilityWindow";

const CATEGORY_ID = 9631;

// Sert des réponses différentes selon start_date — permet de simuler, DANS UN MÊME appel de
// getNightAvailabilityWindow, un mélange de nuits disponibles/pleines/en erreur/absentes de la
// réponse, exactement le scénario que le fail-closed par omission doit couvrir.
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/v2/available-rooms") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found in fixture server" }));
      return;
    }
    const startDate = url.searchParams.get("start_date");

    if (startDate === "2028-09-05") {
      // 500 réseau/serveur isolé — ne doit jamais abattre les autres nuits.
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "internal error" }));
      return;
    }
    if (startDate === "2028-09-06") {
      // Catégorie absente de la réponse — forme inattendue, doit être omise elle aussi.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ date: startDate, categories: [{ category_id: 2523, available_rooms: 9 }] }));
      return;
    }
    if (startDate === "2028-09-07") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ date: startDate, categories: [{ category_id: CATEGORY_ID, available_rooms: 0 }] }));
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

describe("getNightAvailabilityWindow (vrai fetch contre un serveur de fixtures local)", () => {
  it("résout chaque nuit disponible, sur plus d'un lot de 6 (chunking)", async () => {
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
    const rows = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, nights);
    expect(rows).toHaveLength(nights.length);
    expect(rows.every((row) => row.capacity === 2 && row.booked === 0)).toBe(true);
  });

  it("nuit pleine (available_rooms=0) → row présente avec capacity=0, pas omise", async () => {
    const rows = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, ["2028-09-07"]);
    expect(rows).toEqual([{ date: "2028-09-07", capacity: 0, booked: 0 }]);
  });

  it("nuit en 500 → omise du résultat, jamais une exception qui abat les autres", async () => {
    const rows = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, [
      "2028-09-01",
      "2028-09-05",
      "2028-09-02",
    ]);
    expect(rows.map((r) => r.date).sort()).toEqual(["2028-09-01", "2028-09-02"]);
  });

  it("catégorie absente de la réponse → omise du résultat", async () => {
    const rows = await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, ["2028-09-06"]);
    expect(rows).toEqual([]);
  });

  it("liste de nuits vide → tableau vide, zéro appel réseau", async () => {
    expect(await getNightAvailabilityWindow(baseUrl, "fake-token", CATEGORY_ID, [])).toEqual([]);
  });
});

describe("nightsOfMonth", () => {
  it("génère toutes les nuits ISO d'un mois à 30 jours", () => {
    const nights = nightsOfMonth("2028-09");
    expect(nights).toHaveLength(30);
    expect(nights[0]).toBe("2028-09-01");
    expect(nights.at(-1)).toBe("2028-09-30");
  });

  it("génère toutes les nuits ISO d'un mois à 31 jours", () => {
    expect(nightsOfMonth("2028-01")).toHaveLength(31);
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
