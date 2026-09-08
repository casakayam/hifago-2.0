import { describe, expect, it } from "vitest";
import { ORDEN_SECCIONES } from "./tipos";
import { segmentoDeTipo, tipoDeSegmento } from "./segmentos";

describe("segmentos", () => {
  it("couvre les cinq types, sans trou", () => {
    for (const tipo of ORDEN_SECCIONES) {
      expect(segmentoDeTipo(tipo)).toBeTruthy();
    }
  });

  it("fait un aller-retour dans les deux sens", () => {
    for (const tipo of ORDEN_SECCIONES) {
      expect(tipoDeSegmento(segmentoDeTipo(tipo))).toBe(tipo);
    }
  });

  it("rend undefined sur un segment inconnu plutôt que de lever", () => {
    expect(tipoDeSegmento("hoteles")).toBeUndefined();
    expect(tipoDeSegmento("")).toBeUndefined();
  });

  it("n'expose aucun segment en anglais — les URL sont en espagnol dans les deux locales", () => {
    expect(segmentoDeTipo("lodging")).toBe("alojamientos");
    expect(segmentoDeTipo("activity")).toBe("actividades");
  });
});
