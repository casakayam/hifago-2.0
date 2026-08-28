import { describe, expect, it } from "vitest";
import { parseLobbyAvailabilityContract } from "./parseLobbyAvailabilityContract";

// ⚠️ Cette forme vient de la DOCUMENTATION de LobbyPMS, PAS d'une observation — contrairement aux
// constantes LOBBY_ROOMS_OBSERVED_2026_08_26 de pmsFixtureServer, qui viennent du compte réel. La
// distinction est load-bearing : la doc de Lobby s'est déjà révélée fausse une fois (la réponse de
// POST /bookings). Ce parseur est donc écrit pour ne rien supposer, et ces tests prouvent sa
// TOLÉRANCE, jamais que Lobby renvoie bien ceci. C'est précisément ce que la sonde du job nocturne
// va remplacer — quand la forme réelle sera connue, elle prendra la place de celle-ci.
const DOCUMENTED = {
  date: "2026-09-26",
  categories: [
    {
      category_id: 9631,
      available_rooms: 5,
      restrictions: { min_stay: 2, max_stay: null, lead_days: 1 },
      plans: [{ plan_id: 1, prices: [{ date: "2026-09-26", price: 60000 }] }],
    },
    {
      category_id: 29376,
      available_rooms: 0,
      plans: [],
    },
  ],
};

describe("parseLobbyAvailabilityContract", () => {
  it("énumère les catégories que Lobby accepte de coter", () => {
    expect(parseLobbyAvailabilityContract(DOCUMENTED).categoryIds).toEqual([9631, 29376]);
  });

  // C5 : on ne sait pas encore ce que Lobby met dans `restrictions`. Le conserver TEL QUEL est
  // délibéré — typer maintenant reviendrait à décider avant d'avoir vu.
  it("conserve `restrictions` sans l'interpréter", () => {
    const [dorm] = parseLobbyAvailabilityContract(DOCUMENTED).categories;
    expect(dorm.restrictions).toEqual({ min_stay: 2, max_stay: null, lead_days: 1 });
  });

  it("distingue « restrictions absent » de « restrictions vide »", () => {
    const contract = parseLobbyAvailabilityContract(DOCUMENTED);
    expect(contract.categories[1].restrictions).toBeNull();
    expect(parseLobbyAvailabilityContract({ categories: [{ category_id: 1, restrictions: {} }] })
      .categories[0].restrictions).toEqual({});
  });

  // Les clés brutes sont le matériau de C1 : si deux familles de catégories existent, elles se
  // voient ici comme deux signatures distinctes.
  it("expose les clés brutes de chaque entrée, triées", () => {
    const [dorm, glamping] = parseLobbyAvailabilityContract(DOCUMENTED).categories;
    expect(dorm.keys).toEqual(["available_rooms", "category_id", "plans", "restrictions"]);
    expect(glamping.keys).toEqual(["available_rooms", "category_id", "plans"]);
  });

  it("compte les plans et les prix sans jamais les lire", () => {
    const [dorm] = parseLobbyAvailabilityContract(DOCUMENTED).categories;
    expect([dorm.planCount, dorm.priceCount]).toEqual([1, 1]);
  });

  it("distingue une disponibilité à zéro d'une disponibilité absente", () => {
    const contract = parseLobbyAvailabilityContract(DOCUMENTED);
    expect(contract.categories[1].availableRooms).toBe(0);
    expect(parseLobbyAvailabilityContract({ categories: [{ category_id: 1 }] })
      .categories[0].availableRooms).toBeNull();
  });

  // Racine tolérée sous data[0], comme parseLobbyNightCatalog — forme jamais confirmée
  // observée, gardée par précaution et non par mimétisme.
  it("tolère une racine enveloppée dans data[0]", () => {
    expect(parseLobbyAvailabilityContract({ data: [DOCUMENTED] }).categoryIds).toEqual([9631, 29376]);
  });

  it("ne lève jamais et signale un corps inexploitable", () => {
    for (const body of [null, undefined, 42, "texte", {}, { categories: "pas un tableau" }]) {
      expect(parseLobbyAvailabilityContract(body).ok).toBe(false);
    }
  });

  it("ignore une entrée sans category_id exploitable", () => {
    const contract = parseLobbyAvailabilityContract({
      categories: [{ available_rooms: 3 }, { category_id: "abc" }, { category_id: 7 }],
    });
    expect(contract.categoryIds).toEqual([7]);
    expect(contract.ok).toBe(true);
  });
});
