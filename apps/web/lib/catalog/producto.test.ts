import { describe, expect, it } from "vitest";
import { esMiroirFresco, resolverModoReserva, resolverUrlContacto } from "./producto";
import { TELEFONO_HIFAGO, urlDeContacto } from "@/lib/contacto/whatsapp";

// Lot B (20260918170000) : le miroir de disponibilité LobbyPMS ne doit JAMAIS être semé côté
// serveur quand il est périmé — un connecteur tout juste activé (jamais synchronisé) ou un cron
// mort (arrêté 8 jours en août sans que personne ne le voie) afficherait sinon un calendrier faux
// que le client prendrait pour à jour. `getProductoPorSlug` n'a pas de test dédié (aucune
// fonction du fichier ne l'a jamais eu — pas de mock Supabase dans ce fichier), donc la garantie
// est extraite en fonction pure, testée ici sans base, comme `resolverUrlContacto` juste en dessous.
describe("esMiroirFresco", () => {
  const maintenant = Date.UTC(2026, 8, 18, 12, 0, 0);

  it("jamais synchronisé (établissement connecté à l'instant) → périmé", () => {
    expect(esMiroirFresco(null, maintenant)).toBe(false);
  });

  it("synchronisé il y a 1 minute → frais", () => {
    expect(esMiroirFresco(new Date(maintenant - 60_000).toISOString(), maintenant)).toBe(true);
  });

  it("synchronisé il y a 5 h 59 → encore frais, juste sous le seuil", () => {
    const cinqH59 = (5 * 60 + 59) * 60_000;
    expect(esMiroirFresco(new Date(maintenant - cinqH59).toISOString(), maintenant)).toBe(true);
  });

  it("synchronisé il y a EXACTEMENT 6 h → périmé (borne exclusive, comme search_catalog)", () => {
    const sixH = 6 * 60 * 60_000;
    expect(esMiroirFresco(new Date(maintenant - sixH).toISOString(), maintenant)).toBe(false);
  });

  it("le cron arrêté 8 jours (grief réel d'août 2026) → périmé", () => {
    const huitJours = 8 * 24 * 60 * 60_000;
    expect(esMiroirFresco(new Date(maintenant - huitJours).toISOString(), maintenant)).toBe(false);
  });
});

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
