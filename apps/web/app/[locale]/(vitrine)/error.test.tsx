import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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

const MESSAGES = {
  Common: {
    error: {
      titulo: "Algo salió mal",
      descripcion: "No pudimos cargar esta página.",
      reintentar: "Reintentar",
      volver: "Volver al inicio",
    },
  },
};

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
