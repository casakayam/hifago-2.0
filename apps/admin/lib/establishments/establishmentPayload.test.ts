import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { buildEstablishmentRpcParams } from "./establishmentPayload";
import { useEstablishmentFieldsState, type EstablishmentFieldsInit } from "./useEstablishmentFieldsState";

function fields(init: EstablishmentFieldsInit = {}) {
  const { result } = renderHook(() => useEstablishmentFieldsState(init));
  return result.current;
}

describe("buildEstablishmentRpcParams", () => {
  it("nom seul, tout le reste vide → description/address/lat/lon undefined", () => {
    const params = buildEstablishmentRpcParams("Casa Kayam", fields());
    expect(params).toEqual({
      p_name: { es: "Casa Kayam" },
      p_description: undefined,
      p_address: undefined,
      p_lat: undefined,
      p_lon: undefined,
      p_operated_directly: false,
    });
  });

  it("nom rogné (trim), operatedDirectly propagé", () => {
    const params = buildEstablishmentRpcParams("  Casa Kayam  ", fields({ operatedDirectly: true }));
    expect(params.p_name).toEqual({ es: "Casa Kayam" });
    expect(params.p_operated_directly).toBe(true);
  });

  it("description ES seule → objet { es }, pas de clé en", () => {
    const params = buildEstablishmentRpcParams("Casa Kayam", fields({ descriptionEs: "Un lugar tranquilo" }));
    expect(params.p_description).toEqual({ es: "Un lugar tranquilo" });
  });

  it("description ES + EN → objet { es, en }", () => {
    const params = buildEstablishmentRpcParams(
      "Casa Kayam",
      fields({ descriptionEs: "Un lugar tranquilo", descriptionEn: "A quiet place" }),
    );
    expect(params.p_description).toEqual({ es: "Un lugar tranquilo", en: "A quiet place" });
  });

  it("description EN seule (sans ES) → objet { en } seul, jamais { es: '' }", () => {
    const params = buildEstablishmentRpcParams("Casa Kayam", fields({ descriptionEn: "A quiet place" }));
    expect(params.p_description).toEqual({ en: "A quiet place" });
  });

  it("description composée uniquement d'espaces → undefined, pas un objet vide", () => {
    const params = buildEstablishmentRpcParams("Casa Kayam", fields({ descriptionEs: "   ", descriptionEn: "  " }));
    expect(params.p_description).toBeUndefined();
  });

  it("adresse/lat/lon renseignés → address trim, lat/lon convertis en number", () => {
    const params = buildEstablishmentRpcParams(
      "Casa Kayam",
      fields({ address: "  Guatapé, Antioquia  ", lat: 6.23, lon: -75.16 }),
    );
    expect(params.p_address).toBe("Guatapé, Antioquia");
    expect(params.p_lat).toBe(6.23);
    expect(params.p_lon).toBe(-75.16);
  });

  it("adresse composée uniquement d'espaces → undefined", () => {
    const params = buildEstablishmentRpcParams("Casa Kayam", fields({ address: "   " }));
    expect(params.p_address).toBeUndefined();
  });
});
