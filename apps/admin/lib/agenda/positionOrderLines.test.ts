import { describe, expect, it } from "vitest";
import { positionOrderLines, type OrderLineForAgenda, type SlotDuration } from "./positionOrderLines";

function line(overrides: Partial<OrderLineForAgenda> = {}): OrderLineForAgenda {
  return {
    id: "line-1",
    productId: "product-1",
    productName: "Jetski",
    productType: "activity",
    productDurationDays: null,
    holderName: "Cliente Uno",
    qty: 2,
    status: "reserved",
    date: "2029-06-01",
    endDate: null,
    slotStartTime: null,
    ...overrides,
  };
}

describe("positionOrderLines", () => {
  it("titre au format 'activité - client - N pers.'", () => {
    const [event] = positionOrderLines([line()], []);
    expect(event.text).toBe("Jetski - Cliente Uno - 2 pers.");
  });

  it("un événement par order_line, jamais un agrégat — plusieurs réservations simultanées restent toutes visibles", () => {
    const events = positionOrderLines(
      [line({ id: "line-1", holderName: "Cliente Uno" }), line({ id: "line-2", holderName: "Cliente Dos" })],
      []
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id)).toEqual(["line-1", "line-2"]);
  });

  describe("branche créneau horaire", () => {
    const slots: SlotDuration[] = [
      { productId: "product-1", slotDate: "2029-06-01", slotStartTime: "09:00:00", slotDurationMinutes: 90 },
    ];

    it("positionne l'événement sur date + slot_start_time, durée = product_slot_availability", () => {
      const [event] = positionOrderLines([line({ slotStartTime: "09:00:00" })], slots);
      expect(event.allDay).toBe(false);
      expect(event.start).toEqual(new Date(2029, 5, 1, 9, 0, 0));
      expect(event.end).toEqual(new Date(2029, 5, 1, 10, 30, 0));
    });

    it("durée de secours si aucune product_slot_availability ne correspond (jamais censé arriver en pratique, mais une fonction pure ne doit jamais planter)", () => {
      const [event] = positionOrderLines([line({ slotStartTime: "14:00:00" })], []);
      expect(event.start).toEqual(new Date(2029, 5, 1, 14, 0, 0));
      expect(event.end).toEqual(new Date(2029, 5, 1, 15, 0, 0));
    });

    it("ne mélange jamais la durée d'un autre produit/date/heure (clé composite stricte)", () => {
      const otherProductSlots: SlotDuration[] = [
        { productId: "product-2", slotDate: "2029-06-01", slotStartTime: "09:00:00", slotDurationMinutes: 999 },
      ];
      const [event] = positionOrderLines([line({ slotStartTime: "09:00:00" })], otherProductSlots);
      expect(event.end).toEqual(new Date(2029, 5, 1, 10, 0, 0)); // 60 min de secours, pas 999
    });
  });

  describe("branche plage de nuits (end_date)", () => {
    it("bandeau toute la journée du check-in au check-out", () => {
      const [event] = positionOrderLines(
        [line({ date: "2029-06-01", endDate: "2029-06-04", productType: "lodging" })],
        []
      );
      expect(event.allDay).toBe(true);
      expect(event.start).toEqual(new Date(2029, 5, 1));
      expect(event.end).toEqual(new Date(2029, 5, 4));
    });
  });

  describe("branche camp (duration_days, pas de colonne end_date)", () => {
    it("fin calculée via productDurationDays, en borne exclusive (jour APRÈS le dernier jour du camp, cf. MonthViewModel de SVAR)", () => {
      const [event] = positionOrderLines(
        [line({ date: "2029-06-01", productType: "camp", productDurationDays: 5, endDate: null })],
        []
      );
      expect(event.allDay).toBe(true);
      expect(event.start).toEqual(new Date(2029, 5, 1));
      expect(event.end).toEqual(new Date(2029, 5, 6)); // 5 jours occupés (01→05), fin exclusive = 06
    });
  });

  describe("branche date simple — jamais d'heure fabriquée", () => {
    it("chip toute la journée sur le seul jour concerné, end en borne exclusive (jour suivant)", () => {
      const [event] = positionOrderLines([line({ date: "2029-06-01" })], []);
      expect(event.allDay).toBe(true);
      expect(event.start).toEqual(new Date(2029, 5, 1));
      expect(event.end).toEqual(new Date(2029, 5, 2));
    });
  });

  it("le statut de la ligne est reporté tel quel sur l'événement", () => {
    const [event] = positionOrderLines([line({ status: "no_show" })], []);
    expect(event.status).toBe("no_show");
  });
});
