import { describe, expect, it } from "vitest";
import { resolverModoReserva, resolverUrlContacto } from "./producto";
import { TELEFONO_HIFAGO, urlDeContacto } from "@/lib/contacto/whatsapp";

// Décision Jérôme du 2026-09-17 : un transport ne se réserve pas en ligne, on écrit au
// transporteur. Ces tests prouvent la GARANTIE qui le rend vrai — sans eux, « un transport n'a
// jamais de calendrier » serait un souhait et pas une règle (CLAUDE.md §11.20).
describe("resolverUrlContacto", () => {
  it("transport sans rien → le WhatsApp de Hifago, jamais null", () => {
    expect(
      resolverUrlContacto({ esTransporte: true, urlExterna: null, telefonoTransporte: null }),
    ).toBe(urlDeContacto(TELEFONO_HIFAGO));
  });

  it("transport avec son propre téléphone → son WhatsApp", () => {
    expect(
      resolverUrlContacto({
        esTransporte: true,
        urlExterna: null,
        telefonoTransporte: "+573001112233",
      }),
    ).toBe("https://wa.me/573001112233");
  });

  // Un transporteur qui a son propre site de réservation garde la main.
  it("l'URL externe reste prioritaire sur le téléphone", () => {
    expect(
      resolverUrlContacto({
        esTransporte: true,
        urlExterna: "https://gotravel.example/reservar",
        telefonoTransporte: "+573001112233",
      }),
    ).toBe("https://gotravel.example/reservar");
  });

  it("un autre type sans URL externe reste sans contact — comportement inchangé", () => {
    expect(
      resolverUrlContacto({ esTransporte: false, urlExterna: null, telefonoTransporte: null }),
    ).toBeNull();
  });
});

// LA garantie, énoncée comme une assertion : quelles que soient les données, un transport tombe en
// mode « vitrina » — donc bouton de contact, jamais de calendrier ni de panier.
describe("un transport n'a JAMAIS de calendrier", () => {
  it.each([
    ["sans téléphone ni URL", null, null],
    ["avec un téléphone", null, "+573001112233"],
    ["avec une URL externe", "https://gotravel.example/reservar", null],
  ])("%s → mode vitrina", (_cas, urlExterna, telefono) => {
    const urlContacto = resolverUrlContacto({
      esTransporte: true,
      urlExterna,
      telefonoTransporte: telefono,
    });
    expect(urlContacto).not.toBeNull();
    expect(
      resolverModoReserva({
        esEvento: false,
        esEventoReservable: false,
        urlExterna: urlContacto,
        esAlojamiento: false,
        // Même un transport qui porterait des créneaux resterait en vitrine : l'URL garantie passe
        // AVANT la branche `slot` dans le résolveur.
        tieneFranjas: true,
      }),
    ).toBe("vitrina");
  });

  // Le contre-exemple qui rend le test significatif : sans la garantie, on retombait sur "date",
  // c'est-à-dire le calendrier que Jérôme ne voulait pas.
  it("SANS la garantie, le même produit retomberait sur « date » (le calendrier)", () => {
    expect(
      resolverModoReserva({
        esEvento: false,
        esEventoReservable: false,
        urlExterna: null,
        esAlojamiento: false,
        tieneFranjas: false,
      }),
    ).toBe("date");
  });
});
