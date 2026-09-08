import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CategoriaConOferta } from "@/lib/catalog/tipos";
import { IndiceCategorias } from "./IndiceCategorias";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const SIN_TAG = { nombre: "Otras actividades", descripcion: "Lo que no entra ailleurs." };

function categoria(slug: string, over: Partial<CategoriaConOferta> = {}): CategoriaConOferta {
  return {
    slug,
    href: `/actividades/${slug}`,
    nombre: slug,
    descripcion: null,
    foto: null,
    esSinTag: false,
    localesNativas: ["es", "en"],
    testId: `categoria-${slug}`,
    ...over,
  };
}

describe("IndiceCategorias", () => {
  it("rend une tuile par catégorie, dans l'ordre reçu", () => {
    // ⚠️ L'ordre vient de `lib/catalog/` (tri par `Intl.Collator`), jamais d'ici : ce composant ne
    // trie rien, il rend. Un tri ajouté ici entrerait en conflit avec celui de la couche sans que
    // rien ne le signale.
    const { container } = render(
      <IndiceCategorias
        categorias={[categoria("buceo"), categoria("kayak"), categoria("zip")]}
        libellesSinTag={SIN_TAG}
        testId="indice"
      />
    );
    const titres = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(titres).toEqual(["buceo", "kayak", "zip"]);
    expect(container.querySelectorAll("li").length).toBe(3);
  });

  it("rend la tuile « sans tag » comme les autres, avec ses libellés", () => {
    const { container } = render(
      <IndiceCategorias
        categorias={[
          categoria("kayak"),
          categoria("otras", { nombre: "", esSinTag: true, testId: "categoria-otras" }),
        ]}
        libellesSinTag={SIN_TAG}
      />
    );
    // Une grille où une tuile détonne se lit comme un défaut d'affichage (décision de Jérôme,
    // 2026-09-08) : même forme, même niveau de titre.
    expect(Array.from(container.querySelectorAll("h2")).map((h) => h.textContent)).toEqual([
      "kayak",
      "Otras actividades",
    ]);
  });

  it("rend une grille vide sans lever quand il n'y a aucune catégorie", () => {
    // La page décide d'afficher l'état vide à la place ; le composant n'a pas cette vue d'ensemble
    // et ne doit pas casser si on le monte quand même — même contrat que `SeccionOfertas`.
    const { container } = render(
      <IndiceCategorias categorias={[]} libellesSinTag={SIN_TAG} testId="indice" />
    );
    expect(container.querySelector('[data-testid="indice"]')?.children.length).toBe(0);
  });

  // ⚠️ Une règle documentée que rien ne vérifie n'est pas une règle (CLAUDE.md §11.20). Celle-ci est
  // invisible au typecheck, au lint ET en dev : un `"use client"` ajouté par distraction ferait
  // descendre toute la grille dans le navigateur — c'est-à-dire le contenu que cette page existe
  // pour faire indexer — sans qu'aucun outil ne s'en plaigne. D'où une lecture du TEXTE du fichier.
  it("reste un Server Component : ni « use client », ni le moindre import de @hifago/ui", () => {
    // `new URL("./x", import.meta.url)` ne marche pas sous jsdom (le constructeur global résout
    // contre le baseURI du document) — `fileURLToPath` n'a pas ce défaut.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "IndiceCategorias.tsx"),
      "utf8"
    );
    const sansCommentaires = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sansCommentaires).not.toContain('"use client"');
    expect(sansCommentaires).not.toContain("@hifago/ui");
  });
});
