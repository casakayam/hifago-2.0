import { describe, expect, it } from "vitest";
import { mapLobbyErrorCode } from "./mapLobbyErrorCode";

describe("mapLobbyErrorCode", () => {
  it.each([
    ["INPUT_PARAMETERS", /invalides|réservable/],
    ["NOT_ROOM", /indisponible/],
    ["RESTRICTED_RESERVATION", /prestation attachée/],
    ["UNAUTHORIZED_BOOKING", /pas été créé par l'API/],
  ])("code connu %s → message explicite", (code, pattern) => {
    expect(mapLobbyErrorCode(code)).toMatch(pattern);
  });

  it("code null/absent → message générique, jamais une exception", () => {
    expect(mapLobbyErrorCode(null)).toBe("Erreur LobbyPMS non identifiée.");
    expect(mapLobbyErrorCode(undefined)).toBe("Erreur LobbyPMS non identifiée.");
  });

  it("code inconnu → message générique qui garde le code brut (jamais silencieux)", () => {
    expect(mapLobbyErrorCode("SOME_NEW_CODE")).toBe("Erreur LobbyPMS non documentée : SOME_NEW_CODE.");
  });
});
