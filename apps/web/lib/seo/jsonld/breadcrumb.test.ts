// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildBreadcrumbJsonLd } from "./breadcrumb";

describe("buildBreadcrumbJsonLd", () => {
  it("numérote les échelons à partir de 1 et rend des URL absolues", () => {
    const result = buildBreadcrumbJsonLd("https://hifago.co", [
      { name: "Inicio", path: "/es" },
      { name: "Tour en lancha", path: "/es/products/tour-lancha" },
    ]);

    expect(result).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Inicio", item: "https://hifago.co/es" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Tour en lancha",
          item: "https://hifago.co/es/products/tour-lancha",
        },
      ],
    });
  });
});
