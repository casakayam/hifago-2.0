// @vitest-environment node
import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./serialize";

describe("serializeJsonLd", () => {
  it("neutralise une fermeture de balise script glissée dans du contenu partenaire", () => {
    // Le scénario réel : un partenaire colle du HTML dans la description de son produit.
    const out = serializeJsonLd({ description: "Tour </script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<img");
  });

  it("reste du JSON valide après échappement", () => {
    const out = serializeJsonLd({ description: "Tour </script> suite" });
    expect(JSON.parse(out).description).toBe("Tour </script> suite");
  });

  it("neutralise aussi l'ouverture de commentaire HTML", () => {
    expect(serializeJsonLd({ n: "a <!-- b" })).not.toContain("<!--");
  });

  it("échappe TOUT chevron ouvrant, pas seulement ceux des balises", () => {
    // Vérifie le comportement plutôt que la forme de la ligne : les deux écritures possibles de
    // ce remplacement sont visuellement identiques, et l'une d'elles ne fait rien.
    expect(serializeJsonLd({ n: "a < b" })).not.toMatch(/[^\\u]</);
  });
});
