import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CategoriaConOferta } from "@/lib/catalog/tipos";
import { TarjetaCategoria } from "./TarjetaCategoria";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce fichier protège, et qui ne se voit sur aucun rendu correct :
//   • la tuile « Otras actividades » prend ses libellés des MESSAGES, pas de la base (qui n'en a
//     aucun pour elle) — sans ça, elle s'afficherait vide ;
//   • une catégorie non rédigée ne laisse pas de bloc vide sous son titre ;
//   • l'image est décorative (`alt=""`), sans quoi un lecteur d'écran annoncerait deux fois le nom.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

const SIN_TAG = { nombre: "Otras actividades", descripcion: "Todo lo que no entra en una categoría." };

function categoria(over: Partial<CategoriaConOferta> = {}): CategoriaConOferta {
  return {
    slug: "kayak",
    href: "/actividades/kayak",
    nombre: "Kayak",
    descripcion: "Recorridos guiados por el embalse.",
    foto: { url: "https://cdn.test/tags/kayak.webp" },
    esSinTag: false,
    localesNativas: ["es", "en"],
    testId: "categoria-kayak",
    ...over,
  };
}

function rendre(cat: CategoriaConOferta, prioridad = false) {
  const { container } = render(
    <TarjetaCategoria categoria={cat} libellesSinTag={SIN_TAG} prioridad={prioridad} />
  );
  return container;
}

describe("TarjetaCategoria", () => {
  it("rend le nom en <h2> et le texte de la catégorie", () => {
    const container = rendre(categoria());
    expect(container.querySelector("h2")?.textContent).toBe("Kayak");
    expect(
      container.querySelector('[data-testid="categoria-kayak-descripcion"]')?.textContent
    ).toBe("Recorridos guiados por el embalse.");
  });

  it("mène à sa page par le lien LOCALISÉ du titre", () => {
    const lien = rendre(categoria()).querySelector("a");
    expect(lien?.getAttribute("href")).toBe("/actividades/kayak");
    // `data-localized` prouve que c'est le Link de @/i18n/navigation, pas un <a> nu : sans lui le
    // préfixe de langue serait perdu.
    expect(lien?.getAttribute("data-localized")).toBe("true");
  });

  // ⚠️ LE test de la tuile « Otras » : ses libellés ne peuvent PAS venir de la base, elle n'y
  // existe pas. `lib/catalog/` les laisse vides à dessein — si ce composant ne les remplaçait pas,
  // la tuile s'afficherait sans titre et sans texte.
  it("prend ses libellés des messages pour la tuile « sans tag »", () => {
    const container = rendre(
      categoria({ slug: "otras", href: "/actividades/otras", nombre: "", descripcion: null, foto: null, esSinTag: true, testId: "categoria-otras" })
    );
    expect(container.querySelector("h2")?.textContent).toBe("Otras actividades");
    expect(
      container.querySelector('[data-testid="categoria-otras-descripcion"]')?.textContent
    ).toBe("Todo lo que no entra en una categoría.");
  });

  it("n'ouvre AUCUN bloc quand la catégorie n'est pas rédigée", () => {
    // Un bloc vide laisserait un écart sous le titre, et la grille perdrait son alignement d'une
    // tuile à l'autre.
    const container = rendre(categoria({ descripcion: null }));
    expect(container.querySelector('[data-testid="categoria-kayak-descripcion"]')).toBeNull();
  });

  // ⚠️ `alt=""` est un CHOIX explicite, pas un oubli : l'image n'apporte rien que le titre juste en
  // dessous ne dise, et le lien porte déjà ce titre comme nom accessible. Un `alt` qui répéterait
  // « Kayak » ferait annoncer deux fois la même chose.
  it("traite l'image comme décorative", () => {
    const img = rendre(categoria()).querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("rend le substitut sans image, et garde sa forme", () => {
    // Le cas du seed, qui n'a AUCUNE image de catégorie (spec 29 §6e) : c'est ce qu'on verra en
    // local et en e2e.
    const container = rendre(categoria({ foto: null }));
    expect(container.querySelector('[data-testid="categoria-kayak-foto"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
