import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { formatCop } from "@hifago/domain";
import { Price } from "./Price";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions DOM
// natives uniquement.
//
// ⚠️ Aucune chaîne attendue n'est écrite en dur ici, et ce n'est pas de la paresse : la sortie
// d'`Intl.NumberFormat` pour COP dépend de la version d'ICU embarquée par Node (nature de l'espace,
// place du symbole). Figer « 80.000 COP » ferait échouer ce test sur une autre machine sans qu'une
// seule ligne du projet ait bougé. On compare donc à `formatCop`, qui est justement le point de
// vérité que cet atome doit se contenter de respecter.

function rendre(props: { amountCop: number; locale: string; testId?: string }) {
  const { container } = render(<Price {...props} />);
  const span = container.querySelector("span");
  if (!span) throw new Error("Price n'a rendu aucun <span>");
  return span;
}

describe("Price", () => {
  it("rend exactement la sortie de formatCop, sans rien y ajouter", () => {
    const span = rendre({ amountCop: 80000, locale: "es" });
    expect(span.textContent).toBe(formatCop(80000, "es"));
  });

  it("honore la locale reçue plutôt qu'une locale par défaut", () => {
    const es = rendre({ amountCop: 80000, locale: "es" }).textContent;
    const en = rendre({ amountCop: 80000, locale: "en" }).textContent;

    expect(en).toBe(formatCop(80000, "en"));
    // Si l'atome ignorait la prop `locale`, les deux rendus seraient identiques. La position du
    // symbole diffère entre es et en dans toutes les versions d'ICU, donc l'inégalité est stable.
    expect(es).not.toBe(en);
  });

  it("affiche zéro au lieu de le confondre avec l'absence de prix", () => {
    const span = rendre({ amountCop: 0, locale: "es" });
    expect(span.textContent).toBe(formatCop(0, "es"));
    expect(span.textContent).not.toBe("");
  });

  it("formate un grand montant avec ses séparateurs de milliers", () => {
    const span = rendre({ amountCop: 12500000, locale: "es" });
    expect(span.textContent).toBe(formatCop(12500000, "es"));
  });

  it("expose testId en data-testid, et rien quand il est absent", () => {
    expect(rendre({ amountCop: 80000, locale: "es", testId: "prix-total" }).getAttribute("data-testid")).toBe(
      "prix-total"
    );
    expect(rendre({ amountCop: 80000, locale: "es" }).hasAttribute("data-testid")).toBe(false);
  });
});
