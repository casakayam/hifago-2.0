import { describe, expect, it } from "vitest";
import { resolveFilterParams } from "./resolveFilterParams";

describe("resolveFilterParams", () => {
  it("omet un filtre texte absent", () => {
    expect(resolveFilterParams({}, [{ name: "q", kind: "text" }])).toEqual({});
  });

  it("omet un filtre texte vide après trim, jamais une chaîne vide dans le résultat", () => {
    expect(resolveFilterParams({ q: "   " }, [{ name: "q", kind: "text" }])).toEqual({});
  });

  it("retient un filtre texte présent, trimmé", () => {
    expect(resolveFilterParams({ q: "  hostel  " }, [{ name: "q", kind: "text" }])).toEqual({
      q: "hostel",
    });
  });

  it("omet un filtre enum absent", () => {
    expect(
      resolveFilterParams({}, [{ name: "status", kind: "enum", allowed: ["pending", "resolved"] }])
    ).toEqual({});
  });

  it("omet un filtre enum hors liste fermée, jamais transmis", () => {
    expect(
      resolveFilterParams({ status: "hackme" }, [
        { name: "status", kind: "enum", allowed: ["pending", "resolved"] },
      ])
    ).toEqual({});
  });

  it("retient un filtre enum valide tel quel", () => {
    expect(
      resolveFilterParams({ status: "resolved" }, [
        { name: "status", kind: "enum", allowed: ["pending", "resolved"] },
      ])
    ).toEqual({ status: "resolved" });
  });

  it("omet un filtre date absent", () => {
    expect(resolveFilterParams({}, [{ name: "date_from", kind: "date" }])).toEqual({});
  });

  it("omet un filtre date malformée", () => {
    expect(resolveFilterParams({ date_from: "15-08-2026" }, [{ name: "date_from", kind: "date" }])).toEqual(
      {}
    );
  });

  it("retient un filtre date au format ISO exact", () => {
    expect(resolveFilterParams({ date_from: "2026-08-15" }, [{ name: "date_from", kind: "date" }])).toEqual(
      { date_from: "2026-08-15" }
    );
  });

  it("résout plusieurs définitions mixtes en une seule fois, ne gardant que les valeurs valides", () => {
    expect(
      resolveFilterParams({ q: " playa ", status: "hackme", date_from: "2026-08-15", email: undefined }, [
        { name: "q", kind: "text" },
        { name: "status", kind: "enum", allowed: ["pending", "resolved"] },
        { name: "date_from", kind: "date" },
        { name: "email", kind: "text" },
      ])
    ).toEqual({ q: "playa", date_from: "2026-08-15" });
  });
});
