import { describe, expect, it } from "vitest";
import { resolveOrigin } from "./resolveOrigin";

describe("resolveOrigin", () => {
  it("préfère X-Forwarded-Host/Proto quand présents (requête derrière un tunnel/proxy)", () => {
    expect(
      resolveOrigin({
        requestUrl: "http://localhost:3100/api/payments/create",
        forwardedHost: "communist-quad-athletic-fresh.trycloudflare.com",
        forwardedProto: "https",
      })
    ).toBe("https://communist-quad-athletic-fresh.trycloudflare.com");
  });

  it("retombe sur https si X-Forwarded-Proto est absent mais X-Forwarded-Host présent", () => {
    expect(
      resolveOrigin({
        requestUrl: "http://localhost:3100/api/payments/create",
        forwardedHost: "example.com",
        forwardedProto: null,
      })
    ).toBe("https://example.com");
  });

  it("retombe sur l'origine de request.url en accès direct (pas de proxy)", () => {
    expect(
      resolveOrigin({
        requestUrl: "http://localhost:3100/api/payments/create",
        forwardedHost: null,
        forwardedProto: null,
      })
    ).toBe("http://localhost:3100");
  });
});
