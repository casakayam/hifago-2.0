import { describe, expect, it } from "vitest";
import { normalizeLobbyRoomKind, parseLobbyPageMeta, parseLobbyRooms } from "./parseLobbyRooms";

// Forme documentée dans docs/3-integrations/lobby_pms_api.md (racine du dépôt), section Rooms.
// À REVÉRIFIER contre une réponse réelle du compte Casa Kayam dès que LOBBY_RELAY_SECRET est
// disponible : la doc de Lobby s'est déjà révélée fausse une fois (POST /bookings).
const DOCUMENTED_PAGE = {
  data: [
    {
      category_id: 123456,
      name: "Double",
      type: "privada",
      capacity: 2,
      quantity: 5,
      descriptions: [{ description: "Double room with Queen Size bed.", lang: "en" }],
      photos: [{ photo_id: 5150, url: "https://app.lobbypms.com/permanent/uploads/file.jpg" }],
      rooms: [{ id: 469666, name: "101", type: "privada" }],
    },
  ],
  meta: { total_records: 3, current_page: 1, records_per_page: 100, total_pages: 1 },
};

describe("parseLobbyRooms", () => {
  it("parse la forme documentée intégralement", () => {
    expect(parseLobbyRooms(DOCUMENTED_PAGE)).toEqual([
      {
        categoryId: 123456,
        name: "Double",
        kind: "private",
        rawType: "privada",
        capacity: 2,
        quantity: 5,
        descriptions: { en: "Double room with Queen Size bed." },
        unsupportedLangs: [],
        photos: ["https://app.lobbypms.com/permanent/uploads/file.jpg"],
        roomLabels: ["101"],
      },
    ]);
  });

  it("une catégorie réduite à {category_id, name} reste exploitable — tout le reste est facultatif", () => {
    const parsed = parseLobbyRooms({ data: [{ category_id: 9631, name: "VIDPOVO" }] });
    expect(parsed).toEqual([
      {
        categoryId: 9631,
        name: "VIDPOVO",
        kind: null,
        rawType: null,
        capacity: null,
        quantity: null,
        descriptions: {},
        unsupportedLangs: [],
        photos: [],
        roomLabels: [],
      },
    ]);
  });

  it("ignore une entrée sans category_id ou sans nom, jamais une ligne à moitié vide", () => {
    const parsed = parseLobbyRooms({
      data: [
        { name: "Sans id" },
        { category_id: 9631 },
        { category_id: "pas un nombre", name: "Nope" },
        { category_id: 0, name: "Zéro" },
        { category_id: 9629, name: "AUDO" },
      ],
    });
    expect(parsed.map((c) => c.categoryId)).toEqual([9629]);
  });

  it("ne devine jamais le kind d'un type inconnu, mais conserve rawType pour l'écran", () => {
    const parsed = parseLobbyRooms({ data: [{ category_id: 1, name: "X", type: "cabaña" }] });
    expect(parsed[0].kind).toBeNull();
    expect(parsed[0].rawType).toBe("cabaña");
  });

  it("range une description non taguée en espagnol, sans jamais écraser une valeur explicite", () => {
    const parsed = parseLobbyRooms({
      data: [
        {
          category_id: 1,
          name: "X",
          descriptions: [
            { description: "Explicitement espagnol", lang: "es" },
            { description: "Sans langue" },
          ],
        },
      ],
    });
    expect(parsed[0].descriptions).toEqual({ es: "Explicitement espagnol" });
  });

  it("une langue non éditable dans hifago est signalée, jamais écrite", () => {
    const parsed = parseLobbyRooms({
      data: [
        {
          category_id: 1,
          name: "X",
          descriptions: [
            { description: "Português", lang: "pt-BR" },
            { description: "Français", lang: "FR" },
            { description: "Español", lang: "es-CO" },
          ],
        },
      ],
    });
    expect(parsed[0].descriptions).toEqual({ es: "Español" });
    expect(parsed[0].unsupportedLangs).toEqual(["fr", "pt"]);
  });

  it("ignore une photo sans url et une chambre physique sans nom", () => {
    const parsed = parseLobbyRooms({
      data: [
        {
          category_id: 1,
          name: "X",
          photos: [{ photo_id: 1 }, { url: "   " }, { url: "https://app.lobbypms.com/a.jpg" }],
          rooms: [{ id: 1 }, { id: 2, name: "102" }],
        },
      ],
    });
    expect(parsed[0].photos).toEqual(["https://app.lobbypms.com/a.jpg"]);
    expect(parsed[0].roomLabels).toEqual(["102"]);
  });

  it.each([null, undefined, "", 42, [], {}, { data: null }, { data: "oops" }, { data: [null, 7] }])(
    "forme inattendue %j → [], jamais une exception",
    (body) => {
      expect(parseLobbyRooms(body)).toEqual([]);
    }
  );
});

describe("normalizeLobbyRoomKind", () => {
  it.each([
    ["privada", "private"],
    ["Privada", "private"],
    ["private", "private"],
    ["dormitorio", "dorm"],
    ["DORM", "dorm"],
    ["compartida", "dorm"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeLobbyRoomKind(raw)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", 42, "cabaña"])("%j → null (jamais deviné)", (raw) => {
    expect(normalizeLobbyRoomKind(raw)).toBeNull();
  });
});

describe("parseLobbyPageMeta", () => {
  it("lit la pagination documentée", () => {
    expect(parseLobbyPageMeta(DOCUMENTED_PAGE)).toEqual({ totalPages: 1 });
  });

  it.each([null, {}, { meta: null }, { meta: "oops" }, { meta: {} }])(
    "meta absent ou illisible %j → nulls (l'appelant retombe sur son plafond de sécurité)",
    (body) => {
      expect(parseLobbyPageMeta(body)).toEqual({ totalPages: null });
    }
  );
});
