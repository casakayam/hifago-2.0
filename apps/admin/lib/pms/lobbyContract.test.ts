// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LOBBY_ROOMS_OBSERVED_2026_08_26,
  LOBBY_SERVICES_OBSERVED_2026_08_26,
  setPmsFixtureScenario,
  startPmsFixtureServer,
} from "@hifago/e2e-support";
import {
  getLobbyProducts,
  getLobbyRooms,
  parseLobbyRooms,
  parseLobbyServices,
  type LobbyRoomCategory,
  type LobbyService,
} from "@hifago/domain";
import { collectLobbyPages } from "./lobbyEstablishment";

// Ce fichier existe pour une raison précise : les constantes « forme observée » de
// pmsFixtureServer.ts n'étaient consommées par AUCUN test. Le /simplify du 2026-08-26 l'a relevé —
// elles se présentaient comme le contrat de référence LobbyPMS tout en n'étant opposables à rien,
// et le commentaire du module affirmait le contraire. Elles sont désormais load-bearing : la chaîne
// complète est exercée sur du VRAI HTTP, fixture → lobbyClient → parseur → pagination.
//
// Ce que ça verrouille, et qui casserait en silence sinon : la sémantique du couple
// capacity × quantity (opposée entre une privée et un dortoir), le rejet des langues non éditables,
// et le fait qu'une catégorie sans contenu éditorial reste une catégorie valide.

const PORT = 45311;
let fixtureUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  fixtureUrl = server.url;
  close = server.close;
  setPmsFixtureScenario({
    rooms: LOBBY_ROOMS_OBSERVED_2026_08_26,
    services: LOBBY_SERVICES_OBSERVED_2026_08_26,
  });
});

afterAll(async () => {
  await close();
});

describe("Contrat LobbyPMS observé — GET /rooms de bout en bout", () => {
  async function collectRooms() {
    const collected = await collectLobbyPages<LobbyRoomCategory>(
      (page) => getLobbyRooms(fixtureUrl, "jeton-de-fixture", page),
      parseLobbyRooms,
      (category) => category.categoryId,
    );
    if (!collected.ok) throw new Error(`la fixture a répondu ${collected.status}`);
    return collected.items;
  }

  it("traverse HTTP et ressort les 3 catégories, sans doublon", async () => {
    const categories = await collectRooms();
    expect(categories.map((c) => c.categoryId)).toEqual([29376, 9631, 49823]);
  });

  // LE piège du couple : une privée est capacity:2 × quantity:3 (trois chambres de deux personnes),
  // un dortoir capacity:1 × quantity:8 (huit lits d'une personne). Les intervertir inverserait
  // l'information publiée au client.
  it("ne confond jamais capacity (occupants d'UNE unité) et quantity (nombre d'unités)", async () => {
    const categories = await collectRooms();
    const glamping = categories.find((c) => c.categoryId === 29376)!;
    const vidpovo = categories.find((c) => c.categoryId === 9631)!;

    expect(glamping.kind).toBe("private");
    expect([glamping.capacity, glamping.quantity]).toEqual([2, 3]);

    expect(vidpovo.kind).toBe("dorm");
    expect([vidpovo.capacity, vidpovo.quantity]).toEqual([1, 8]);
  });

  it("normalise le vocabulaire espagnol de Lobby (privada / compartida)", async () => {
    const categories = await collectRooms();
    expect(categories.map((c) => [c.rawType, c.kind])).toEqual([
      ["privada", "private"],
      ["compartida", "dorm"],
      ["privada", "private"],
    ]);
  });

  // Les langues que l'éditeur hifago ne sait pas afficher sont SIGNALÉES, jamais écrites : les
  // écrire produirait une valeur publiée par repli mais invisible et non supprimable dans l'éditeur.
  it("n'importe jamais une langue non éditable, et la signale", async () => {
    const glamping = (await collectRooms()).find((c) => c.categoryId === 29376)!;
    expect(Object.keys(glamping.descriptions).sort()).toEqual(["en", "es"]);
    expect(glamping.unsupportedLangs).toEqual(["fr", "pt"]);
  });

  // Cas réel : 2 des 6 catégories du compte n'ont ni description ni photo. C'est nominal, pas une
  // anomalie — la carte de prévisualisation doit rester lisible dessus.
  it("accepte une catégorie sans aucun contenu éditorial", async () => {
    const camper = (await collectRooms()).find((c) => c.categoryId === 49823)!;
    expect(camper.descriptions).toEqual({});
    expect(camper.photos).toEqual([]);
    expect(camper.capacity).toBe(4);
    expect(camper.roomLabels).toEqual(["Habitación 1", "Habitación 2"]);
  });

  it("expose les photos comme de simples URLs", async () => {
    const glamping = (await collectRooms()).find((c) => c.categoryId === 29376)!;
    expect(glamping.photos).toHaveLength(2);
    expect(glamping.photos[0]).toMatch(/^https:\/\/app\.lobbypms\.com\//);
  });
});

describe("Contrat LobbyPMS observé — GET /products de bout en bout", () => {
  it("ne renvoie qu'identifiant, nom, prix et stock — jamais de photo ni de capacité", async () => {
    const collected = await collectLobbyPages<LobbyService>(
      (page) => getLobbyProducts(fixtureUrl, "jeton-de-fixture", page),
      parseLobbyServices,
      (service) => service.serviceId,
    );
    if (!collected.ok) throw new Error(`la fixture a répondu ${collected.status}`);

    expect(collected.items).toHaveLength(3);
    const yoga = collected.items.find((s) => s.serviceId === 494426)!;
    expect(yoga.name).toBe("YOGA session");
    expect(yoga.valueCop).toBe(22000);
    expect(yoga.infiniteInventory).toBe(true);
    expect(yoga.stock).toBeNull();
    // La raison pour laquelle lier une ACTIVITÉ à un service ne peut rien rapatrier d'autre : ces
    // champs n'existent pas sur cette ressource, aucun compte n'en fournira (spec 24 §11.3).
    expect(Object.keys(yoga).sort()).toEqual([
      "infiniteInventory",
      "name",
      "serviceId",
      "stock",
      "valueCop",
    ]);
  });
});
