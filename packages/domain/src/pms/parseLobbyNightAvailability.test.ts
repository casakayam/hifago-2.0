import { describe, expect, it } from "vitest";
import { parseLobbyNightAvailability } from "./parseLobbyNightAvailability";

describe("parseLobbyNightAvailability", () => {
  it("parse la forme RÉELLE observée en production (racine = body)", () => {
    const body = {
      date: "2028-09-01",
      categories: [
        { category_id: 9631, name: "VIDPOVO", available_rooms: 3, plans: [] },
        { category_id: 2523, name: "King", available_rooms: 0, plans: [] },
      ],
    };
    expect(parseLobbyNightAvailability(body, 9631)).toEqual({ available: 3 });
  });

  it("tolère la forme data[0] par précaution", () => {
    const body = { data: [{ categories: [{ category_id: 9631, available_rooms: 5 }] }] };
    expect(parseLobbyNightAvailability(body, 9631)).toEqual({ available: 5 });
  });

  it("category_id absent de la réponse → null (jamais une valeur inventée)", () => {
    const body = { categories: [{ category_id: 2523, available_rooms: 4 }] };
    expect(parseLobbyNightAvailability(body, 9631)).toBeNull();
  });

  it("available_rooms négatif ou non numérique → clampé à 0, jamais négatif", () => {
    expect(
      parseLobbyNightAvailability({ categories: [{ category_id: 9631, available_rooms: -2 }] }, 9631)
    ).toEqual({ available: 0 });
    expect(
      parseLobbyNightAvailability({ categories: [{ category_id: 9631, available_rooms: "n/a" }] }, 9631)
    ).toEqual({ available: 0 });
  });

  it.each([null, undefined, "", 42, [], {}, { categories: null }, { categories: "oops" }])(
    "forme inattendue %j → null, jamais une exception",
    (body) => {
      expect(parseLobbyNightAvailability(body, 9631)).toBeNull();
    }
  );
});
