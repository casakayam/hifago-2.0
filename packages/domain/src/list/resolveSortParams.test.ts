import { describe, expect, it } from "vitest";
import { resolveSortParams } from "./resolveSortParams";

const whitelist = { name: "name->>es", created_at: "created_at" };
const defaultSort = { key: "created_at", direction: "desc" as const };

describe("resolveSortParams", () => {
  it("retombe sur le tri par défaut quand sort est absent", () => {
    expect(resolveSortParams({}, whitelist, defaultSort)).toEqual({
      key: "created_at",
      column: "created_at",
      direction: "desc",
    });
  });

  it("retombe sur le tri par défaut quand sort n'est pas dans la whitelist", () => {
    expect(resolveSortParams({ sort: "inexistant", dir: "asc" }, whitelist, defaultSort)).toEqual({
      key: "created_at",
      column: "created_at",
      direction: "desc",
    });
  });

  it("retombe sur le tri par défaut quand dir est invalide, jamais un mélange clé-valide/dir-défaut", () => {
    expect(resolveSortParams({ sort: "name", dir: "croissant" }, whitelist, defaultSort)).toEqual({
      key: "created_at",
      column: "created_at",
      direction: "desc",
    });
  });

  it("prend la première valeur si dir arrive en tableau", () => {
    expect(resolveSortParams({ sort: "name", dir: ["asc", "desc"] }, whitelist, defaultSort)).toEqual({
      key: "name",
      column: "name->>es",
      direction: "asc",
    });
  });

  it("prend la première valeur si sort arrive en tableau", () => {
    expect(resolveSortParams({ sort: ["name", "created_at"], dir: "asc" }, whitelist, defaultSort)).toEqual({
      key: "name",
      column: "name->>es",
      direction: "asc",
    });
  });

  it("résout le cas nominal en restituant l'expression SQL de la whitelist, pas la clé d'URL", () => {
    expect(resolveSortParams({ sort: "name", dir: "asc" }, whitelist, defaultSort)).toEqual({
      key: "name",
      column: "name->>es",
      direction: "asc",
    });
  });
});
