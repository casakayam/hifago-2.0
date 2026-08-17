import { describe, expect, it } from "vitest";
import {
  emptySlotRule,
  generateSlotPreview,
  toSlotRuleRows,
  validateSlotRules,
  type DraftSlotRule,
} from "./slotRules";

function rule(overrides: Partial<DraftSlotRule> = {}): DraftSlotRule {
  return {
    weekdays: [1, 2, 3, 4, 5, 6],
    startTime: "10:00",
    endTime: "21:00",
    slotDurationMinutes: "60",
    capacity: "4",
    ...overrides,
  };
}

describe("validateSlotRules", () => {
  it("un tableau vide est valide — les créneaux restent optionnels", () => {
    expect(validateSlotRules([])).toBeNull();
  });

  it("une règle entièrement remplie est valide", () => {
    expect(validateSlotRules([rule()])).toBeNull();
  });

  it("aucun jour de la semaine coché → erreur", () => {
    expect(validateSlotRules([rule({ weekdays: [] })])).toMatch(/día de la semana/);
  });

  it("heure de fin avant ou égale à l'heure de début → erreur", () => {
    expect(validateSlotRules([rule({ startTime: "10:00", endTime: "10:00" })])).toMatch(/fin/);
    expect(validateSlotRules([rule({ startTime: "21:00", endTime: "10:00" })])).toMatch(/fin/);
  });

  it("durée du créneau non entière ou nulle → erreur", () => {
    expect(validateSlotRules([rule({ slotDurationMinutes: "0" })])).toMatch(/duración/);
    expect(validateSlotRules([rule({ slotDurationMinutes: "abc" })])).toMatch(/duración/);
  });

  it("capacité non entière ou nulle → erreur", () => {
    expect(validateSlotRules([rule({ capacity: "0" })])).toMatch(/capacidad/);
  });
});

describe("generateSlotPreview", () => {
  it("cas jetski littéral : 10:00-21:00, créneaux de 60 min → 11 créneaux", () => {
    const slots = generateSlotPreview(rule());
    expect(slots).toHaveLength(11);
    expect(slots[0]).toBe("10:00–11:00");
    expect(slots[slots.length - 1]).toBe("20:00–21:00");
  });

  it("plage non multiple de la durée → le reliquat est tronqué, pas une erreur", () => {
    const slots = generateSlotPreview(rule({ startTime: "10:00", endTime: "10:50", slotDurationMinutes: "60" }));
    expect(slots).toEqual([]);
  });

  it("champs manquants ou invalides → tableau vide", () => {
    expect(generateSlotPreview(rule({ startTime: "" }))).toEqual([]);
    expect(generateSlotPreview(rule({ slotDurationMinutes: "0" }))).toEqual([]);
    expect(generateSlotPreview(rule({ startTime: "21:00", endTime: "10:00" }))).toEqual([]);
  });
});

describe("emptySlotRule / toSlotRuleRows", () => {
  it("emptySlotRule ne coche aucun jour et laisse les champs vides", () => {
    expect(emptySlotRule()).toEqual({
      weekdays: [],
      startTime: "",
      endTime: "",
      slotDurationMinutes: "",
      capacity: "",
    });
  });

  it("toSlotRuleRows convertit vers les types de colonne réels et trie les jours", () => {
    expect(toSlotRuleRows([rule({ weekdays: [6, 1, 3] })])).toEqual([
      {
        weekdays: [1, 3, 6],
        start_time: "10:00",
        end_time: "21:00",
        slot_duration_minutes: 60,
        capacity: 4,
      },
    ]);
  });
});
