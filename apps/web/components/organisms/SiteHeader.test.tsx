import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { CartProvider, useCart, type CartLine } from "@/lib/cart/CartContext";
import { loadMessages, type Locale } from "@/messages";
import { SiteHeader } from "./SiteHeader";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// ⚠️ `@/i18n/navigation` tire next-intl/navigation → next/navigation, dont la résolution casse sous
// Vitest (même mock que CatalogBrowser.test.tsx et ProductDetailView.test.tsx). `Link` reçoit ici
// une prop `locale` en plus : le mock la rend en préfixe, exactement comme le vrai — sans quoi le
// test du sélecteur de langue ne vérifierait rien de ce qui compte.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/products/kayak",
}));

const messages = loadMessages("es");

function Entoure({
  children,
  locale = "es",
  lignes = [],
}: {
  children: React.ReactNode;
  locale?: Locale;
  lignes?: CartLine[];
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <CartProvider>
        <RemplitLePanier lignes={lignes} />
        {children}
      </CartProvider>
    </NextIntlClientProvider>
  );
}

/** Remplit le panier au montage : `CartProvider` n'accepte pas d'état initial. */
function RemplitLePanier({ lignes }: { lignes: CartLine[] }) {
  const { lines, addLine } = useCart();
  if (lines.length === 0 && lignes.length > 0) {
    for (const ligne of lignes) addLine(ligne);
  }
  return null;
}

const ligne = (id: string): CartLine => ({
  id,
  productId: `p-${id}`,
  productName: "Paseo en lancha",
  establishmentName: "Casa Kayam",
  date: "2026-09-14",
  qty: 3,
  priceCop: 80000,
});

function rendu(props: { isAuthenticated?: boolean; lignes?: CartLine[]; locale?: Locale } = {}) {
  const { container } = render(
    <Entoure locale={props.locale} lignes={props.lignes}>
      <SiteHeader isAuthenticated={props.isAuthenticated ?? false} testId="header" />
    </Entoure>
  );
  return container;
}

describe("SiteHeader", () => {
  it("introduit les landmarks que l'app n'avait pas", () => {
    const container = rendu();
    const header = container.querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.querySelectorAll("nav").length).toBe(1);
    // ⚠️ Le logo n'est PAS un <h1> : le titre appartient à la page, pas à la marque.
    expect(header.querySelector("h1")).toBeNull();
  });

  it("fait du logo un lien vers l'accueil, nommé", () => {
    const container = rendu();
    const logo = container.querySelector('[data-testid="header-home"]') as HTMLAnchorElement;
    expect(logo.tagName).toBe("A");
    expect(logo.getAttribute("href")).toBe("/");
    expect(logo.getAttribute("aria-label")).toBe(messages.Chrome.homeLabel);
  });

  describe("le panier", () => {
    // ⚠️ Ce que la pastille compte : les LIGNES, pas la somme des `qty` (décision de Jérôme).
    // Chaque ligne du panier de test porte `qty: 3` : si un jour quelqu'un « corrige » en sommant
    // les quantités, ce test tombe avec 9 au lieu de 3.
    it("compte les lignes sélectionnées, jamais la somme des quantités", () => {
      const container = rendu({ lignes: [ligne("a"), ligne("b"), ligne("c")] });
      const pastille = container.querySelector('[data-slot="badge-label"], .badge__label') as HTMLElement;
      expect(pastille.textContent).toBe("3");
    });

    // ⚠️ Un nombre affiché ne suffit pas à un lecteur d'écran : « 3 » à côté de « panier » peut
    // s'annoncer n'importe comment. Le compte est donc DANS le nom accessible, au pluriel de la
    // langue (ICU de next-intl), jamais concaténé.
    it("annonce le compte en toutes lettres, avec le bon pluriel", () => {
      const vide = rendu().querySelector('[data-testid="header-cart"]') as HTMLElement;
      expect(vide.getAttribute("aria-label")).toBe("Carrito, vacío");

      const un = rendu({ lignes: [ligne("a")] }).querySelector('[data-testid="header-cart"]') as HTMLElement;
      expect(un.getAttribute("aria-label")).toBe("Carrito, 1 artículo");

      const deux = rendu({ lignes: [ligne("a"), ligne("b")] }).querySelector(
        '[data-testid="header-cart"]'
      ) as HTMLElement;
      expect(deux.getAttribute("aria-label")).toBe("Carrito, 2 artículos");
    });

    it("n'affiche aucune pastille quand le panier est vide", () => {
      const container = rendu();
      expect(container.querySelector(".badge__label")).toBeNull();
    });

    it("plafonne l'affichage à 99+ sans mentir sur le nom accessible", () => {
      const cent = Array.from({ length: 100 }, (_, i) => ligne(String(i)));
      const container = rendu({ lignes: cent });
      expect((container.querySelector(".badge__label") as HTMLElement).textContent).toBe("99+");
      expect(
        (container.querySelector('[data-testid="header-cart"]') as HTMLElement).getAttribute("aria-label")
      ).toBe("Carrito, 100 artículos");
    });

    // Un lien, pas un bouton : le panier s'ouvre au clic du milieu, se copie, se met en favori.
    it("est un LIEN vers la page du panier", () => {
      const panier = rendu().querySelector('[data-testid="header-cart"]') as HTMLAnchorElement;
      expect(panier.tagName).toBe("A");
      expect(panier.getAttribute("href")).toBe("/checkout");
    });
  });

  // ⚠️ Le compte vit dans `SiteMenu` depuis le 2026-09-02 (le menu est devenu une liste d'entrées
  // avec libellés visibles). Ce qui est vérifié ici est le CÂBLAGE — que le header transmette bien
  // l'état de connexion ; le rendu de l'entrée elle-même appartient à SiteMenu.test.tsx.
  describe("le compte, transmis au menu", () => {
    it("mène à la connexion quand le visiteur est déconnecté", () => {
      const lien = rendu({ isAuthenticated: false }).querySelector(
        '[data-testid="header-menu-account"]'
      ) as HTMLAnchorElement;
      expect(lien.getAttribute("href")).toBe("/login");
      expect(lien.textContent).toBe(messages.Chrome.loginLabel);
    });

    it("mène à la page du compte quand il est connecté", () => {
      const lien = rendu({ isAuthenticated: true }).querySelector(
        '[data-testid="header-menu-account"]'
      ) as HTMLAnchorElement;
      expect(lien.getAttribute("href")).toBe("/account/orders");
      expect(lien.textContent).toBe(messages.Chrome.accountLabel);
    });
  });

  describe("le menu mobile", () => {
    it("annonce son état et ce qu'il commande", () => {
      const container = rendu();
      const bouton = container.querySelector('[data-testid="header-menu-toggle"]') as HTMLButtonElement;
      const menu = container.querySelector('[data-testid="header-menu"]') as HTMLElement;
      expect(bouton.getAttribute("aria-expanded")).toBe("false");
      expect(bouton.getAttribute("aria-controls")).toBe(menu.id);

      fireEvent.click(bouton);
      expect(bouton.getAttribute("aria-expanded")).toBe("true");
    });

    it("se ferme par Échap, et rend le focus au bouton", () => {
      const container = rendu();
      const bouton = container.querySelector('[data-testid="header-menu-toggle"]') as HTMLButtonElement;
      fireEvent.click(bouton);
      expect(bouton.getAttribute("aria-expanded")).toBe("true");

      fireEvent.keyDown(document, { key: "Escape" });
      expect(bouton.getAttribute("aria-expanded")).toBe("false");
      // Sans ce retour, le focus reste sur un élément masqué et la tabulation repart du début.
      expect(document.activeElement).toBe(bouton);
    });

    // ⚠️ LE test du lot. Google indexe la version MOBILE : si le menu était monté à la demande
    // (`{ouvert && …}`), les liens `/en/…` du sélecteur de langue — ce qui fait découvrir la
    // version anglaise — seraient absents du seul HTML que Googlebot voit. On vérifie donc le HTML
    // SERVI, pas le DOM après hydratation : les deux ne disent pas la même chose.
    it("laisse les liens de langue dans le HTML SERVI, menu fermé", () => {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="es" messages={messages}>
          <CartProvider>
            <SiteHeader isAuthenticated={false} testId="header" />
          </CartProvider>
        </NextIntlClientProvider>
      );
      // Le panneau est bien fermé dans ce HTML…
      expect(html).toContain('aria-expanded="false"');
      // …et pourtant les deux liens de langue y sont, avec leur préfixe.
      // ⚠️ Portée exacte de cette assertion : le préfixe vient du mock ci-dessus, pas du vrai
      // `Link`. Ce que le test prouve n'est donc pas la forme de l'URL — c'est que le panneau est
      // RENDU et non conditionné, donc que ses liens existent dans le HTML servi. C'est le point
      // qui casserait au premier `{ouvert && …}`.
      expect(html).toContain('href="/es/products/kayak"');
      expect(html).toContain('href="/en/products/kayak"');
      // …ainsi que le lien du compte, qui vit dans le même panneau.
      expect(html).toContain('href="/login"');
    });
  });

  it("traduit tout ce qu'il affiche, dans les deux langues", () => {
    const en = rendu({ locale: "en", lignes: [ligne("a")] });
    expect((en.querySelector('[data-testid="header-cart"]') as HTMLElement).getAttribute("aria-label")).toBe(
      "Cart, 1 item"
    );
    expect((en.querySelector('[data-testid="header-home"]') as HTMLElement).getAttribute("aria-label")).toBe(
      "Hifago, go to home"
    );
  });

  // ⚠️ L'hydratation : le panier vit côté client. Si `CartProvider` lisait un stockage local, le
  // serveur rendrait un compte et le client un autre — pastille qui clignote, ou erreur en console.
  // Vérifié plutôt que supposé : il s'initialise à `[]` sans aucune persistance (son en-tête le
  // documente), donc les deux rendus partent du même état.
  it("rend côté serveur exactement ce que le client rend au premier passage", () => {
    const serveur = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <CartProvider>
          <SiteHeader isAuthenticated={false} testId="header" />
        </CartProvider>
      </NextIntlClientProvider>
    );
    const client = rendu();
    const panierServeur = serveur.match(/aria-label="([^"]*Carrito[^"]*)"/)?.[1];
    const panierClient = (client.querySelector('[data-testid="header-cart"]') as HTMLElement).getAttribute(
      "aria-label"
    );
    expect(panierServeur).toBe(panierClient);
    expect(panierServeur).toBe("Carrito, vacío");
  });
});
