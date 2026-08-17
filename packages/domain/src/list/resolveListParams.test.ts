import { describe, expect, it } from "vitest";
import { resolveListParams } from "./resolveListParams";

const sortWhitelist = { name: "name->>es", created_at: "created_at" };
const defaultSort = { key: "created_at", direction: "desc" as const };
const filters = [
  { name: "q", kind: "text" as const },
  { name: "status", kind: "enum" as const, allowed: ["pending", "resolved"] },
];

describe("resolveListParams", () => {
  it("compose pagination/tri/filtres par défaut quand searchParams est vide", () => {
    expect(resolveListParams({}, { sortWhitelist, defaultSort, filters })).toEqual({
      page: 1,
      pageSize: 20,
      from: 0,
      to: 19,
      sort: { key: "created_at", column: "created_at", direction: "desc" },
      filters: {},
      extraParams: { sort: "created_at", dir: "desc" },
    });
  });

  it("n'inclut jamais 'page' dans extraParams, même quand ?page=3 est présent", () => {
    const result = resolveListParams({ page: "3" }, { sortWhitelist, defaultSort, filters });
    expect(result.page).toBe(3);
    expect(result.extraParams).not.toHaveProperty("page");
  });

  it("compose sort + filtre + page bout-en-bout, tous fournis en même temps", () => {
    const result = resolveListParams(
      { page: "2", sort: "name", dir: "asc", q: " playa ", status: "resolved" },
      { sortWhitelist, defaultSort, filters, pageSize: 10 }
    );
    expect(result).toEqual({
      page: 2,
      pageSize: 10,
      from: 10,
      to: 19,
      sort: { key: "name", column: "name->>es", direction: "asc" },
      filters: { q: "playa", status: "resolved" },
      extraParams: { q: "playa", status: "resolved", sort: "name", dir: "asc" },
    });
  });
});
