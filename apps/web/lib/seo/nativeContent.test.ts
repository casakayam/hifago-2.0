// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasNativeContent } from "./nativeContent";

describe("hasNativeContent", () => {
  it("reconnaît un contenu réellement saisi dans la locale", () => {
    expect(hasNativeContent({ es: "Tour en lancha", en: "Boat tour" }, "en")).toBe(true);
  });

  it("refuse une locale absente — c'est un repli, pas une traduction", () => {
    expect(hasNativeContent({ es: "Tour en lancha" }, "en")).toBe(false);
  });

  it("refuse une chaîne vide ou blanche", () => {
    // Sans ce durcissement, la page était indexée avec un titre blanc.
    expect(hasNativeContent({ es: "" }, "es")).toBe(false);
    expect(hasNativeContent({ es: "   " }, "es")).toBe(false);
  });

  it("refuse un JSONB scalaire, que asLocalizedField laisse passer sans validation", () => {
    // `"Tour"["es"]` vaut undefined ; ailleurs dans le code ce même cas fait renvoyer "T" par
    // resolveLocalizedField (Object.values("Tour")[0]).
    expect(hasNativeContent("Tour", "es")).toBe(false);
    expect(hasNativeContent(42, "es")).toBe(false);
  });

  it("refuse null et undefined", () => {
    expect(hasNativeContent(null, "es")).toBe(false);
    expect(hasNativeContent(undefined, "es")).toBe(false);
  });
});
