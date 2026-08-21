import { describe, expect, it } from "vitest";
import { buildAuthCallbackRedirect } from "./buildAuthCallbackRedirect";

describe("buildAuthCallbackRedirect", () => {
  it("construit une URL absolue vers /auth/callback avec next en query string", () => {
    expect(
      buildAuthCallbackRedirect({ origin: "https://example.com", next: "/es" })
    ).toBe("https://example.com/auth/callback?next=%2Fes");
  });

  it("encode correctement un chemin next avec des segments multiples", () => {
    expect(
      buildAuthCallbackRedirect({ origin: "https://example.com", next: "/es/checkout" })
    ).toBe("https://example.com/auth/callback?next=%2Fes%2Fcheckout");
  });
});
