import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { SiteMenu } from "./SiteMenu";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/products/kayak",
}));

const messages = loadMessages("es");

function rendu({
  isAuthenticated = false,
  isOpen = false,
  locale = "es" as Locale,
} = {}) {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <SiteMenu isAuthenticated={isAuthenticated} isOpen={isOpen} id="menu" testId="menu" />
    </NextIntlClientProvider>
  );
  return {
    container,
    panneau: container.querySelector('[data-testid="menu"]') as HTMLElement,
    compte: container.querySelector('[data-testid="menu-account"]') as HTMLAnchorElement,
  };
}

describe("SiteMenu", () => {
  it("est une vraie liste de navigation", () => {
    const { panneau } = rendu();
    const liste = panneau.querySelector("ul");
    expect(liste).not.toBeNull();
    // Une liste, c'est ce qu'annonce un lecteur d'écran (« liste de N éléments ») et ce qui
    // structurera les entrées suivantes.
    expect(liste?.querySelectorAll("li").length).toBe(1);
  });

  // ⚠️ Ce que la refonte du 2026-09-02 a apporté : le libellé est ÉCRIT, plus seulement annoncé.
  // Une icône seule dans un menu vertical n'a aucune affordance.
  it("écrit le libellé de chaque entrée, au lieu de le cacher dans un aria-label", () => {
    expect(rendu().compte.textContent).toBe(messages.Chrome.loginLabel);
    expect(rendu({ isAuthenticated: true }).compte.textContent).toBe(messages.Chrome.accountLabel);
  });

  // ⚠️ `md:sr-only` et non `md:hidden` : sur desktop l'entrée devient un bouton rond à icône seule,
  // et son nom doit survivre. `hidden` retirerait le texte de l'arbre d'accessibilité EN MÊME
  // TEMPS que de l'écran — le lien deviendrait muet, ce que rien ne signalerait à l'œil.
  it("garde le libellé dans l'arbre d'accessibilité quand il devient invisible", () => {
    const { compte } = rendu();
    const libelle = compte.querySelector("span:last-child") as HTMLElement;
    expect(libelle.className).toContain("md:sr-only");
    expect(libelle.className).not.toContain("md:hidden");
  });

  it("mène à la connexion ou au compte selon l'état de connexion", () => {
    expect(rendu().compte.getAttribute("href")).toBe("/login");
    expect(rendu({ isAuthenticated: true }).compte.getAttribute("href")).toBe("/account/orders");
  });

  it("place la langue APRÈS la liste, jamais avant", () => {
    const { panneau } = rendu();
    const enfants = [...panneau.children];
    const indexListe = enfants.findIndex((e) => e.tagName === "UL");
    const indexLangue = enfants.findIndex((e) => e.querySelector('[data-testid="menu-language"]'));
    expect(indexListe).toBeGreaterThanOrEqual(0);
    expect(indexLangue).toBeGreaterThan(indexListe);
  });

  it("garde une cible tactile de 44 px sur chaque entrée", () => {
    expect(rendu().compte.className).toContain("min-h-11");
  });

  it("se replie sans disparaître du DOM", () => {
    expect(rendu({ isOpen: false }).panneau.className).toContain("hidden");
    // …et reste toujours en ligne à partir de `md`, replié ou non.
    expect(rendu({ isOpen: false }).panneau.className).toContain("md:flex");
    expect(rendu({ isOpen: true }).panneau.className).toContain("flex");
  });

  // ⚠️ Google indexe la version MOBILE : replié, ce panneau doit quand même livrer ses liens dans
  // le HTML servi. Un `{isOpen && …}` les en sortirait.
  it("livre ses liens dans le HTML SERVI alors qu'il est replié", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <SiteMenu isAuthenticated={false} isOpen={false} id="menu" testId="menu" />
      </NextIntlClientProvider>
    );
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/en/products/kayak"');
    // Le libellé aussi : c'est du contenu, pas seulement un attribut.
    expect(html).toContain(messages.Chrome.loginLabel);
  });
});
