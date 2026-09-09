import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import type { FichaEstablecimiento as DatosFicha, TarjetaOferta } from "@/lib/catalog/tipos";
import { FichaEstablecimiento } from "./FichaEstablecimiento";

const messages = loadMessages("es");

// `TarjetaOferta` monte `PhotoStrip` → Embla, qui exige trois bouchons de navigateur en jsdom.
// Neutralisée : ce fichier teste la FICHE, pas la carte (qui a ses propres tests).
vi.mock("@/components/molecules/PhotoStrip", () => ({ PhotoStrip: () => null }));
vi.mock("@/components/molecules/TarjetaOferta", () => ({
  TarjetaOferta: ({ oferta }: { oferta: TarjetaOferta }) => (
    <div data-testid={oferta.testId}>{oferta.nombre}</div>
  ),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const habitacion: TarjetaOferta = {
  clave: "producto-1",
  href: "/productos/cabana",
  nombre: "Cabaña del Lago",
  establecimiento: null,
  precio: { tipo: "monto", cop: 180000 },
  fotos: [],
  tipo: "lodging",
  nAlojamientos: null,
  capacidad: 4,
  testId: "tarjeta-cabana",
};

function ficha(overrides: Partial<DatosFicha> = {}): DatosFicha {
  return {
    id: "e1",
    slug: "casa-kayam",
    nombre: "Casa Kayam",
    descripcion: null,
    direccion: null,
    lat: null,
    lon: null,
    horaEntrada: null,
    horaSalida: null,
    modo: null,
    contacto: null,
    fotos: [],
    alojamientos: [],
    otrosProductos: [],
    localesNativas: ["es"],
    ...overrides,
  };
}

function renderFicha(overrides: Partial<DatosFicha> = {}) {
  return render(
    <NextIntlClientProvider
      locale="es"
      messages={{
        EstablishmentPage: messages.EstablishmentPage,
        HomePage: messages.HomePage,
        Common: messages.Common,
      }}
    >
      <FichaEstablecimiento ficha={ficha(overrides)} locale="es" />
    </NextIntlClientProvider>
  );
}

describe("FichaEstablecimiento — le titre", () => {
  it("porte un <h1>, et c'est le nom du lieu", () => {
    // La page n'en avait AUCUN : `Card.Title` de HeroUI rend un `<h3>`, et la hiérarchie mesurée
    // en réel était h3 → h2 → h3 (spec 30 §1.2).
    renderFicha();
    const titre = screen.getByTestId("establishment-name");
    expect(titre.tagName).toBe("H1");
    expect(titre.textContent).toBe("Casa Kayam");
  });
});

describe("FichaEstablecimiento — les horaires DU LIEU", () => {
  it("affiche les deux quand ils sont renseignés", () => {
    renderFicha({ horaEntrada: "15:00:00", horaSalida: "11:00:00" });
    const ligne = screen.getByTestId("establishment-hours").textContent ?? "";
    expect(ligne).toContain("15:00");
    expect(ligne).toContain("11:00");
  });

  it("affiche la moitié présente sans séparateur orphelin", () => {
    renderFicha({ horaEntrada: "15:00:00" });
    const ligne = screen.getByTestId("establishment-hours").textContent ?? "";
    expect(ligne).toContain("15:00");
    expect(ligne).not.toContain("·");
  });

  it("ne rend AUCUNE ligne quand aucun horaire n'est connu", () => {
    // Et c'est le cas qui compte le plus depuis le 2026-09-08 : `products.check_in_time` existe
    // toujours et reste éditable côté admin, mais l'établissement fait SEUL foi (spec 30 §3.4).
    // Un horaire saisi sur le produit ne doit rien faire apparaître ici.
    renderFicha();
    expect(screen.queryByTestId("establishment-hours")).toBeNull();
  });
});

describe("FichaEstablecimiento — le contact public", () => {
  it("construit un lien wa.me en retirant le +", () => {
    renderFicha({ contacto: "+573001234567" });
    const lien = screen.getByTestId("establishment-contact-link");
    expect(lien.getAttribute("href")).toBe("https://wa.me/573001234567");
  });

  it("ouvre dans un nouvel onglet, sans laisser la cible accéder à l'ouvreur", () => {
    renderFicha({ contacto: "+573001234567" });
    const lien = screen.getByTestId("establishment-contact-link");
    expect(lien.getAttribute("target")).toBe("_blank");
    // `noopener` : sans lui, la page cible peut réécrire l'URL de la nôtre.
    expect(lien.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("n'affiche AUCUN bouton sans numéro, et rien à la place", () => {
    renderFicha();
    expect(screen.queryByTestId("establishment-contact-link")).toBeNull();
  });
});

describe("FichaEstablecimiento — ses produits", () => {
  it("sépare les couchages des autres produits, chacun dans sa section", () => {
    const actividad: TarjetaOferta = { ...habitacion, clave: "p2", tipo: "activity", nombre: "Kayak", testId: "tarjeta-kayak" };
    renderFicha({ alojamientos: [habitacion], otrosProductos: [actividad] });
    expect(screen.getByTestId("establishment-lodgings")).toBeTruthy();
    expect(screen.getByTestId("establishment-activities")).toBeTruthy();
  });

  it("le titre des couchages suit le MODE du lieu, jamais un intitulé unique", () => {
    renderFicha({ alojamientos: [habitacion], modo: "whole_house" });
    expect(screen.getByTestId("establishment-lodgings").textContent).toContain("Alojamiento completo");
  });

  it("retombe sur un intitulé neutre quand le mode n'est pas renseigné", () => {
    // « Sin especificar » n'est pas un oubli : un établissement qui ne vend que des activités n'a
    // pas de mode d'hébergement, et lui en imposer un fabriquerait une information fausse.
    renderFicha({ alojamientos: [habitacion], modo: null });
    expect(screen.getByTestId("establishment-lodgings").textContent).toContain("Alojamiento");
  });

  it("ne rend pas une section vide", () => {
    renderFicha({ alojamientos: [habitacion] });
    expect(screen.queryByTestId("establishment-activities")).toBeNull();
  });
});
