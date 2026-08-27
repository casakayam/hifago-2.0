import { describe, expect, it } from "vitest";
import { mergeLobbyRoom, type LobbyImportableFields } from "./lobbyRoomImport";
import type { LobbyRoomOption } from "@/lib/pms/lobbyOptions";

// Forme réellement observée le 2026-08-26 sur le compte Casa Kayam (spec 24 §11.1) — GLAMPING.
function lobbyRoom(overrides: Partial<LobbyRoomOption> = {}): LobbyRoomOption {
  return {
    id: 29376,
    name: "GLAMPING",
    kind: "private",
    rawType: "privada",
    capacity: 2,
    quantity: 3,
    descriptions: { es: "Ubicadas en la cima de la colina", en: "Located at the top of the hill" },
    unsupportedLangs: ["fr", "pt"],
    photoUrls: [],
    roomLabels: ["EMBERA", "KUNA", "ZENU"],
    ...overrides,
  };
}

const EMPTY: LobbyImportableFields = { name: {}, description: {}, capacity: "", unitCount: "" };

describe("mergeLobbyRoom — ce que Lobby a le droit d'écraser", () => {
  it("remplit tout sur une fiche vierge", () => {
    const next = mergeLobbyRoom(EMPTY, lobbyRoom());
    expect(next.name.es).toBe("GLAMPING");
    expect(next.description.es).toBe("Ubicadas en la cima de la colina");
    expect(next.description.en).toBe("Located at the top of the hill");
    expect(next.capacity).toBe("2");
    expect(next.unitCount).toBe("3");
  });

  // LA règle la plus coûteuse à violer : le nom porte le slug de la fiche publique. L'écraser
  // derrière l'utilisateur changerait l'URL d'un produit déjà partagé.
  it("n'écrase JAMAIS un nom déjà saisi", () => {
    const current = { ...EMPTY, name: { es: "Cabaña bambú" } };
    expect(mergeLobbyRoom(current, lobbyRoom()).name.es).toBe("Cabaña bambú");
  });

  it("ne considère pas un nom fait d'espaces comme saisi", () => {
    const current = { ...EMPTY, name: { es: "   " } };
    expect(mergeLobbyRoom(current, lobbyRoom()).name.es).toBe("GLAMPING");
  });

  it("ne touche jamais le nom anglais, même vide", () => {
    const next = mergeLobbyRoom({ ...EMPTY, name: { en: "Bamboo hut" } }, lobbyRoom());
    expect(next.name.en).toBe("Bamboo hut");
    expect(next.name.es).toBe("GLAMPING");
  });

  // Règle 1 : un compte Lobby incomplet ne doit pas vider une fiche remplie à la main. Deux des six
  // catégories réelles n'ont NI description NI photo — le cas est nominal, pas théorique.
  it("un champ absent chez Lobby laisse la valeur locale intacte", () => {
    const current: LobbyImportableFields = {
      name: { es: "Cabaña" },
      description: { es: "Texte écrit à la main" },
      capacity: "4",
      unitCount: "9",
    };
    const next = mergeLobbyRoom(
      current,
      lobbyRoom({ capacity: null, quantity: null, descriptions: {} }),
    );
    expect(next.description.es).toBe("Texte écrit à la main");
    expect(next.capacity).toBe("4");
    expect(next.unitCount).toBe("9");
  });

  // Règle 3 : fusion par langue, jamais remplacement en bloc.
  it("fusionne les descriptions langue par langue", () => {
    const current = { ...EMPTY, description: { es: "Local es", en: "Local en" } };
    const next = mergeLobbyRoom(current, lobbyRoom({ descriptions: { es: "Lobby es" } }));
    expect(next.description.es).toBe("Lobby es");
    expect(next.description.en).toBe("Local en");
  });

  // Règle 4 : capacity et quantity ont des sens OPPOSÉS chez Lobby (un dortoir est capacity:1 ×
  // quantity:8, huit lits d'une personne). Les intervertir inverserait l'information publiée.
  it("ne confond pas capacité et nombre d'unités sur un dortoir", () => {
    const next = mergeLobbyRoom(EMPTY, lobbyRoom({ kind: "dorm", capacity: 1, quantity: 8 }));
    expect(next.capacity).toBe("1");
    expect(next.unitCount).toBe("8");
  });

  it("écrase capacité et nombre d'unités quand Lobby les fournit", () => {
    const current = { ...EMPTY, capacity: "99", unitCount: "99" };
    const next = mergeLobbyRoom(current, lobbyRoom());
    expect(next.capacity).toBe("2");
    expect(next.unitCount).toBe("3");
  });

  // Détail d'implémentation VOLONTAIRE, et testé pour qu'il le reste : le composant applique les
  // setters sans condition. Si une valeur inchangée revenait dans un nouvel objet, chaque import
  // provoquerait un re-rendu des champs que Lobby ne renseigne pas.
  it("renvoie les valeurs inchangées par référence", () => {
    const current: LobbyImportableFields = {
      name: { es: "Cabaña" },
      description: { es: "Texte" },
      capacity: "4",
      unitCount: "9",
    };
    const next = mergeLobbyRoom(
      current,
      lobbyRoom({ capacity: null, quantity: null, descriptions: {} }),
    );
    expect(next.name).toBe(current.name);
    expect(next.description).toBe(current.description);
  });

  it("ignore les langues que l'éditeur hifago ne sait pas afficher", () => {
    // parseLobbyRooms les range déjà dans unsupportedLangs sans les écrire ; cette garde vérifie
    // qu'aucune ne se glisse par une autre porte.
    const next = mergeLobbyRoom(EMPTY, lobbyRoom({ descriptions: {} }));
    expect(Object.keys(next.description)).toEqual([]);
  });
});
