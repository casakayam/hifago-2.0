import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le mock rend la prop `locale` en préfixe, comme le vrai `Link` de next-intl : sans elle, rien de
// ce que ce composant existe pour garantir ne serait vérifiable.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/products/kayak",
}));

function rendu(locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <LanguageSwitcher testId="lang" />
    </NextIntlClientProvider>
  );
  return {
    container,
    declencheur: container.querySelector('[data-testid="lang-trigger"]') as HTMLButtonElement,
    panneau: container.querySelector('[data-testid="lang-panneau"]') as HTMLElement,
  };
}

describe("LanguageSwitcher", () => {
  it("affiche la langue courante en toutes lettres, dans sa propre langue", () => {
    expect(rendu("es").declencheur.textContent).toContain("Español");
    // ⚠️ « English » et non « Inglés » : un anglophone perdu sur /es doit reconnaître sa langue.
    expect(rendu("en").declencheur.textContent).toContain("English");
  });

  it("propose les deux langues, chacune en vrai lien préfixé", () => {
    const { container } = rendu("es");
    expect((container.querySelector('[data-testid="lang-es"]') as HTMLAnchorElement).getAttribute("href")).toBe(
      "/es/products/kayak"
    );
    const en = container.querySelector('[data-testid="lang-en"]') as HTMLAnchorElement;
    expect(en.tagName).toBe("A");
    expect(en.getAttribute("href")).toBe("/en/products/kayak");
  });

  it("marque la langue active autrement que par un signe visuel", () => {
    const { container } = rendu("es");
    expect((container.querySelector('[data-testid="lang-es"]') as HTMLElement).getAttribute("aria-current")).toBe(
      "true"
    );
    expect((container.querySelector('[data-testid="lang-en"]') as HTMLElement).getAttribute("aria-current")).toBeNull();
  });

  // ⚠️ Mesuré en rendu SERVEUR : un `Dropdown`/`Popover` de HeroUI ne contient AUCUN de ses liens
  // dans le HTML servi tant qu'il est fermé. Ici le panneau est rendu puis masqué — c'est ce qui
  // permet à la version anglaise d'être découverte par le maillage interne, y compris sur mobile
  // où ce sélecteur vit dans le menu du header.
  it("laisse ses liens dans le HTML SERVI alors qu'il est fermé", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
        <LanguageSwitcher testId="lang" />
      </NextIntlClientProvider>
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden=");
    expect(html).toContain('href="/en/products/kayak"');
  });

  it("annonce son état et ce qu'il commande", () => {
    const { declencheur, panneau } = rendu();
    expect(declencheur.getAttribute("aria-expanded")).toBe("false");
    expect(declencheur.getAttribute("aria-controls")).toBe(panneau.id);
    expect(panneau.hasAttribute("hidden")).toBe(true);

    fireEvent.click(declencheur);
    expect(declencheur.getAttribute("aria-expanded")).toBe("true");
    expect(panneau.hasAttribute("hidden")).toBe(false);
  });

  it("se ferme par Échap et rend le focus au déclencheur", () => {
    const { declencheur, panneau } = rendu();
    fireEvent.click(declencheur);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panneau.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(declencheur);
  });

  it("se ferme au clic à l'extérieur", () => {
    const { declencheur, panneau } = rendu();
    fireEvent.click(declencheur);
    expect(panneau.hasAttribute("hidden")).toBe(false);
    fireEvent.mouseDown(document.body);
    expect(panneau.hasAttribute("hidden")).toBe(true);
  });

  it("garde une cible tactile de 44 px sur le déclencheur et sur chaque entrée", () => {
    const { container, declencheur } = rendu();
    expect(declencheur.className).toContain("min-h-11");
    for (const valeur of ["es", "en"]) {
      expect((container.querySelector(`[data-testid="lang-${valeur}"]`) as HTMLElement).className).toContain(
        "min-h-11"
      );
    }
  });

  // Le drapeau accompagne, il n'informe pas : aucun n'est juste pour l'anglais, et `es` est ici
  // l'espagnol de Colombie. Le nom écrit à côté porte l'information.
  it("rend les drapeaux invisibles au lecteur d'écran", () => {
    const { container } = rendu();
    const drapeaux = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(drapeaux.length).toBeGreaterThanOrEqual(3);
  });
});
