import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import ErrorVitrine from "./error";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce test protège tient en une phrase : **le message brut de l'erreur ne doit jamais
// atteindre l'écran**. Il peut porter un fragment de requête SQL ou un nom de table, et il arrive
// ici depuis une couche qui parle à Supabase. Le reste (un titre, deux actions) est du rendu.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

// ⚠️ Le catalogue de messages est le VRAI (`loadMessages`), jamais un objet écrit à la main — c'est
// la convention déjà majoritaire du dépôt (SiteHeader, SiteMenu, SiteFooter, LanguageSwitcher,
// ProductDetailView, formatOccurrenceLabel) et sa raison est mécanique : un catalogue de test
// recopié à la main teste le catalogue de test. Mesuré le 2026-09-08 par la revue du lot : renommer
// `{indice}` en `{index}` dans messages/{es,en}/HomePage.json laissait les 514 tests VERTS pendant
// que chaque photo du catalogue aurait porté `alt="HomePage.fotoAlt"` en production — `t()` n'est
// pas typé sur le catalogue (aucune augmentation `IntlMessages` dans ce dépôt), donc ni tsc ni le
// lint ne voient rien, et `parity.test.ts` ne compare que des CHEMINS de clés, jamais leurs
// variables.
const MESSAGES = loadMessages("es");

function monter(reset = () => {}) {
  const erreur = Object.assign(new Error('relation "public.products" does not exist'), {
    digest: "abc123",
  });
  return render(
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <ErrorVitrine error={erreur} reset={reset} />
    </NextIntlClientProvider>
  );
}

describe("ErrorVitrine", () => {
  it("rend un texte traduit, jamais le message brut de l'erreur", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = monter();

    expect(screen.getByText("Algo salió mal")).not.toBeNull();
    expect(container.textContent).not.toContain("public.products");
    expect(container.textContent).not.toContain("abc123");

    // Le message part tout de même au journal du navigateur : masqué au visiteur, jamais perdu.
    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
  });

  it("propose de réessayer sans recharger, et de revenir à l'accueil", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    monter(reset);

    (screen.getByTestId("error-vitrine-reintentar") as HTMLButtonElement).click();
    expect(reset).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("error-vitrine-volver").getAttribute("href")).toBe("/");
    vi.restoreAllMocks();
  });

  it("pose l'unique <main> de la page et ne rend aucune coquille", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = monter();

    // ⚠️ Un `error.tsx` de groupe est rendu À L'INTÉRIEUR du layout de sa zone : l'en-tête et le
    // pied de page sont déjà là. En rendre un second donnerait deux en-têtes — faute invisible au
    // typecheck, et que seule cette assertion attrape.
    expect(container.querySelectorAll("main").length).toBe(1);
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    vi.restoreAllMocks();
  });
});
