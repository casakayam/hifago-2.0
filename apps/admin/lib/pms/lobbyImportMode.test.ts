import { describe, expect, it } from "vitest";
import { lobbyImportMode } from "./lobbyImportMode";

// Ces cas ne testent pas un formatage : ils verrouillent une frontière d'AUTORISATION. `attach` est
// admin-only, `stage` est ouvert à l'operator de l'établissement — un corps qui basculerait de l'un
// à l'autre changerait qui a le droit d'écrire dans Storage sur le jeton Lobby d'un partenaire.
describe("lobbyImportMode — quel corps atteint quelle garde", () => {
  it("un productId présent va toujours vers attach, même accompagné des champs de stage", () => {
    // Le cas qui compte : porter les DEUX jeux de champs ne doit jamais donner accès à la garde
    // la plus faible.
    expect(lobbyImportMode({ productId: "abc", establishmentId: "e1", categoryId: 1 })).toBe("attach");
  });

  it.each([
    ["chaîne vide", { productId: "", establishmentId: "e1", categoryId: 1 }],
    ["null explicite", { productId: null, establishmentId: "e1", categoryId: 1 }],
    ["undefined explicite", { productId: undefined, establishmentId: "e1", categoryId: 1 }],
    ["type inattendu", { productId: 42, establishmentId: "e1", categoryId: 1 }],
  ])("un productId falsy (%s) reste dans attach — jamais un repli vers stage", (_label, body) => {
    expect(lobbyImportMode(body)).toBe("attach");
  });

  it("sans clé productId, c'est stage", () => {
    expect(lobbyImportMode({ establishmentId: "e1", categoryId: 1 })).toBe("stage");
  });

  it.each([
    ["null", null],
    ["tableau", []],
    ["chaîne", "productId"],
    ["nombre", 42],
  ])("un corps qui n'est pas un objet (%s) est invalide, jamais déréférencé", (_label, body) => {
    expect(lobbyImportMode(body)).toBe("invalid");
  });
});
