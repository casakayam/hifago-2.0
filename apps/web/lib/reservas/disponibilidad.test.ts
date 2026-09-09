import { describe, expect, it } from "vitest";
import type { CartLine } from "@/lib/cart/CartContext";
import {
  agregarEnCarrito,
  estadoDisponibilidad,
  plazasRestantes,
} from "./disponibilidad";

const linea = (partiel: Partial<CartLine>): CartLine =>
  ({
    productId: "p1",
    productName: "Kayak",
    establishmentName: "Casa Kayam",
    date: "2026-12-20",
    qty: 1,
    priceCop: 50_000,
    ...partiel,
  }) as CartLine;

describe("plazasRestantes", () => {
  it("retire le réservé ET ce que le panier occupe déjà", () => {
    expect(plazasRestantes({ capacity: 8, booked: 3 }, 2)).toBe(3);
  });

  it("un panier vide ne retire rien", () => {
    expect(plazasRestantes({ capacity: 8, booked: 3 }, 0)).toBe(5);
  });

  it("rend un NÉGATIF plutôt que de le masquer — une incohérence de données doit rester visible", () => {
    expect(plazasRestantes({ capacity: 2, booked: 3 }, 1)).toBe(-2);
  });
});

describe("estadoDisponibilidad", () => {
  it("zéro place est complet", () => {
    expect(estadoDisponibilidad(0)).toBe("completo");
  });

  it("un négatif est complet, jamais un état à part", () => {
    expect(estadoDisponibilidad(-3)).toBe("completo");
  });

  it("une seule place a son propre état — c'est ce qui déclenche « dernière place »", () => {
    expect(estadoDisponibilidad(1)).toBe("ultima");
  });

  it("au-delà, il reste des places", () => {
    expect(estadoDisponibilidad(2)).toBe("quedan");
  });

  it("ne rend JAMAIS un libellé traduit — la couche ne traduit rien", () => {
    // Le jour où quelqu'un fait rendre « Última plaza » à cette fonction, un module partagé se met
    // à dépendre de next-intl. L'assertion porte donc sur le jeu fermé de valeurs.
    expect(["completo", "ultima", "quedan"]).toContain(estadoDisponibilidad(5));
  });
});

describe("agregarEnCarrito", () => {
  it("additionne les quantités d'une même clé", () => {
    const mapa = agregarEnCarrito(
      [linea({ qty: 2 }), linea({ qty: 3 })],
      (l) => l.productId === "p1",
      (l) => l.date
    );
    expect(mapa.get("2026-12-20")).toBe(5);
  });

  it("ignore les lignes que le filtre écarte", () => {
    const mapa = agregarEnCarrito(
      [linea({ qty: 2 }), linea({ productId: "autre", qty: 9 })],
      (l) => l.productId === "p1",
      (l) => l.date
    );
    expect(mapa.get("2026-12-20")).toBe(2);
  });

  it("sépare deux créneaux d'une même date — deux cupos indépendants", () => {
    const mapa = agregarEnCarrito(
      [
        linea({ qty: 1, slotStartTime: "09:00" }),
        linea({ qty: 2, slotStartTime: "14:00" }),
      ],
      (l) => Boolean(l.slotStartTime),
      (l) => `${l.date}|${l.slotStartTime}`
    );
    expect(mapa.get("2026-12-20|09:00")).toBe(1);
    expect(mapa.get("2026-12-20|14:00")).toBe(2);
  });

  it("compte une ligne à date unique, là où buildInCartNightsMap la SAUTE", () => {
    // C'est la raison d'être de cette fonction, et la correction que l'écriture du lot B3 a
    // apportée à la spec 30 §7a : `buildInCartNightsMap` fait `if (!line.endDate) continue`, donc
    // elle ignore toute ligne d'activité ou de créneau. Les fusionner ferait compter une nuit
    // d'hébergement comme une place d'activité, silencieusement.
    const sansEndDate = linea({ qty: 4 });
    expect(sansEndDate.endDate).toBeUndefined();
    const mapa = agregarEnCarrito([sansEndDate], () => true, (l) => l.date);
    expect(mapa.get("2026-12-20")).toBe(4);
  });
});
