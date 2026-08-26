import { describe, expect, it } from "vitest";
import { parseLobbyServices } from "./parseLobbyServices";

describe("parseLobbyServices", () => {
  it("parse la forme documentée", () => {
    expect(
      parseLobbyServices({
        data: [
          { service_id: 69899, name: "Tour Guatape", value: "120000.00", infinite_inventory: 1, stock: null },
        ],
        meta: { total_records: 3, current_page: 1, records_per_page: 100, total_pages: 1 },
      })
    ).toEqual([
      { serviceId: 69899, name: "Tour Guatape", valueCop: 120000, infiniteInventory: true, stock: null },
    ]);
  });

  it("un service réduit à {service_id, name} reste exploitable", () => {
    expect(parseLobbyServices({ data: [{ service_id: 473218, name: "Mezcla" }] })).toEqual([
      { serviceId: 473218, name: "Mezcla", valueCop: null, infiniteInventory: null, stock: null },
    ]);
  });

  it("stock limité : infinite_inventory à 0 et un stock réel", () => {
    expect(
      parseLobbyServices({ data: [{ service_id: 1, name: "X", infinite_inventory: 0, stock: "7" }] })
    ).toEqual([{ serviceId: 1, name: "X", valueCop: null, infiniteInventory: false, stock: 7 }]);
  });

  it("un prix nul, négatif ou illisible est traité comme absent, jamais affiché comme 0", () => {
    const parsed = parseLobbyServices({
      data: [
        { service_id: 1, name: "A", value: "0.00" },
        { service_id: 2, name: "B", value: "-5000" },
        { service_id: 3, name: "C", value: "gratuit" },
      ],
    });
    expect(parsed.map((s) => s.valueCop)).toEqual([null, null, null]);
  });

  it("ignore une entrée sans service_id ou sans nom", () => {
    const parsed = parseLobbyServices({
      data: [{ name: "Sans id" }, { service_id: 5 }, { service_id: 565423, name: "Transporte" }],
    });
    expect(parsed.map((s) => s.serviceId)).toEqual([565423]);
  });

  it.each([null, undefined, "", 42, [], {}, { data: null }, { data: "oops" }])(
    "forme inattendue %j → [], jamais une exception",
    (body) => {
      expect(parseLobbyServices(body)).toEqual([]);
    }
  );
});
