import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { SiteFooter } from "./SiteFooter";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} data-localized="true" {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/products/kayak",
}));

const messages = loadMessages("es");

function rendu(locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <SiteFooter testId="footer" />
    </NextIntlClientProvider>
  );
  return { container, pied: container.querySelector("footer") as HTMLElement };
}

const CLES = [
  "footerLegalNotice",
  "footerPrivacy",
  "footerContact",
  "footerHelp",
  "footerTerms",
] as const;

describe("SiteFooter", () => {
  it("est un vrai <footer> avec une navigation nommée", () => {
    const { pied } = rendu();
    expect(pied).not.toBeNull();
    const nav = pied.querySelector("nav") as HTMLElement;
    expect(nav.getAttribute("aria-label")).toBe(messages.Chrome.footerNavLabel);
  });

  it("porte les cinq liens institutionnels du cahier des charges, en liste", () => {
    const { container } = rendu();
    const liste = container.querySelector("nav ul") as HTMLElement;
    expect(liste.querySelectorAll("li").length).toBe(CLES.length);
    for (const cle of CLES) {
      const lien = container.querySelector(`[data-testid="footer-${cle}"]`) as HTMLAnchorElement;
      expect(lien.textContent).toBe(messages.Chrome[cle]);
      // ⚠️ Chaque lien interne passe par le `Link` de @/i18n/navigation : lui seul conserve le
      // préfixe de locale. Un `<a href="/legal">` renverrait un hispanophone sur une page sans
      // langue.
      expect(lien.getAttribute("data-localized")).toBe("true");
    }
  });

  it("garde une cible tactile de 44 px sur chaque lien", () => {
    const { container } = rendu();
    for (const cle of CLES) {
      expect(
        (container.querySelector(`[data-testid="footer-${cle}"]`) as HTMLElement).className
      ).toContain("min-h-11");
    }
  });

  // ⚠️ Le lien externe passe par `LinkButton`, qui impose `rel="noopener noreferrer"` (sa prop
  // `rel` n'existe pas) et exige le libellé « nouvel onglet », rendu en sr-only. Écrire un `<a>` à
  // la main aurait remis ces deux garanties à la vigilance de qui relit.
  it("ouvre WhatsApp dans un nouvel onglet, en le disant et sans fuite d'opener", () => {
    const { container } = rendu();
    const lien = container.querySelector('[data-testid="footer-whatsapp"]') as HTMLAnchorElement;
    expect(lien.getAttribute("href")).toBe("https://wa.me/573215764841");
    expect(lien.getAttribute("target")).toBe("_blank");
    expect(lien.getAttribute("rel")).toBe("noopener noreferrer");
    expect(lien.textContent).toContain(messages.Chrome.footerWhatsApp);
    expect(lien.textContent).toContain(messages.Chrome.footerWhatsAppNewTab);
  });

  // ⚠️ LE point du lot : le footer réutilise le sélecteur du header, il n'en écrit pas un second.
  // Deux implémentations divergentes (l'une avec de vrais liens, l'autre en JavaScript seul) est
  // le défaut classique de la paire header/footer — et ici il coûterait la découverte de la
  // version anglaise.
  it("réutilise le LanguageSwitcher du header, avec ses vrais liens", () => {
    const { container } = rendu();
    const declencheur = container.querySelector('[data-testid="footer-language-trigger"]');
    expect(declencheur).not.toBeNull();
    const en = container.querySelector('[data-testid="footer-language-en"]') as HTMLAnchorElement;
    expect(en.tagName).toBe("A");
    expect(en.getAttribute("href")).toBe("/en/products/kayak");
  });

  it("affiche la ligne d'identité reprise du footer legacy", () => {
    const { container } = rendu();
    expect((container.querySelector('[data-testid="footer-identity"]') as HTMLElement).textContent).toBe(
      "Hifago · Guatapé, Colombia"
    );
  });

  it("traduit tout ce qu'il affiche", () => {
    const { container } = rendu("en");
    expect((container.querySelector('[data-testid="footer-footerHelp"]') as HTMLElement).textContent).toBe(
      "Help and FAQ"
    );
    expect((container.querySelector("nav") as HTMLElement).getAttribute("aria-label")).toBe(
      "Institutional links"
    );
  });

  // ⚠️ Aucune couleur en dur : cinq pistes de thème sont montées et aucune n'est adoptée. Le couple
  // fond/texte vient du thème, donc sa lisibilité est garantie par lui — dans les cinq pistes et
  // dans les deux modes.
  // ⚠️ `--surface-tertiary` retenu après mesure des cinq candidats sur 5 pistes × 2 modes : c'est
  // le plus marqué des jetons qui laissent intacts les composants posés dessus (LinkButton,
  // LanguageSwitcher), dont les couleurs supposent un fond de surface claire.
  it("prend sa bande de couleur dans les jetons, jamais en dur", () => {
    const { pied } = rendu();
    expect(pied.className).toContain("bg-[var(--surface-tertiary)]");
    expect(pied.className).toContain("text-[var(--surface-tertiary-foreground)]");
    expect(pied.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("livre tous ses liens dans le HTML SERVI", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <SiteFooter testId="footer" />
      </NextIntlClientProvider>
    );
    for (const href of ["/legal", "/privacy", "/contact", "/help", "/terms"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("https://wa.me/573215764841");
    expect(html).toContain('href="/en/products/kayak"');
  });
});
