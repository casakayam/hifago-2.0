import { describe, expect, it } from "vitest";
import { format } from "date-fns";
import type { LobbyNightRestrictions } from "@hifago/domain";
import {
  isoDeFecha,
  mesPorDefecto,
  nocheDeshabilitada,
  pisoLeadDays,
  ultimoDiaReservable,
} from "./calendario";
import type { ReachableWindow } from "./reservationRange";

const sinContrainte: LobbyNightRestrictions = { minStay: null, maxStay: null, leadDays: null };

describe("isoDeFecha", () => {
  it("formate une date en ISO", () => {
    expect(isoDeFecha(new Date(2026, 11, 20))).toBe("2026-12-20");
  });

  it("rend null quand rien n'est sélectionné", () => {
    expect(isoDeFecha(undefined)).toBeNull();
  });
});

describe("mesPorDefecto", () => {
  it("ouvre sur le mois de la première date configurée", () => {
    expect(format(mesPorDefecto("2027-03-14"), "yyyy-MM")).toBe("2027-03");
  });

  it("sans date configurée, retombe sur AUJOURD'HUI À GUATAPÉ — jamais sur undefined", () => {
    // `undefined` renverrait react-day-picker sur son propre `new Date()`, donc sur le mois du
    // NAVIGATEUR : un visiteur européen le 1er du mois à 2 h voyait s'ouvrir le mois suivant.
    // On n'assert pas une valeur d'horloge, mais le fait qu'une date soit bien rendue.
    const mes = mesPorDefecto(undefined);
    expect(mes).toBeInstanceOf(Date);
    expect(Number.isNaN(mes.getTime())).toBe(false);
  });
});

describe("ultimoDiaReservable", () => {
  it("rend une date valide, et la MÊME à chaque appel dans le même jour", () => {
    const a = ultimoDiaReservable();
    const b = ultimoDiaReservable();
    expect(a).toBeInstanceOf(Date);
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe("pisoLeadDays", () => {
  const hoy = "2026-12-20";

  it("sans aucune restriction, le plancher est aujourd'hui", () => {
    expect(pisoLeadDays(new Map(), hoy)).toBe(hoy);
  });

  it("des restrictions toutes nulles ne bougent rien — c'est le cas MESURÉ aujourd'hui", () => {
    const restrictions = new Map([["2026-12-21", sinContrainte]]);
    expect(pisoLeadDays(restrictions, hoy)).toBe(hoy);
  });

  it("retient le MAXIMUM des délais, jamais le premier ni le dernier", () => {
    const restrictions = new Map<string, LobbyNightRestrictions>([
      ["2026-12-21", { ...sinContrainte, leadDays: 2 }],
      ["2026-12-22", { ...sinContrainte, leadDays: 5 }],
      ["2026-12-23", { ...sinContrainte, leadDays: 1 }],
    ]);
    // Le plus strict est le seul qui ne propose jamais une nuit que Lobby refuserait.
    expect(pisoLeadDays(restrictions, hoy)).toBe("2026-12-25");
  });

  it("un leadDays à null est IGNORÉ, jamais lu comme 0", () => {
    const restrictions = new Map<string, LobbyNightRestrictions>([
      ["2026-12-21", { ...sinContrainte, leadDays: 3 }],
      ["2026-12-22", sinContrainte],
    ]);
    // Si `null` était lu comme 0, rien ne changerait ici — mais il ne doit pas non plus ABAISSER
    // le plancher trouvé par une autre nuit.
    expect(pisoLeadDays(restrictions, hoy)).toBe("2026-12-23");
  });

  it("un leadDays à zéro laisse le plancher sur aujourd'hui", () => {
    const restrictions = new Map([["2026-12-21", { ...sinContrainte, leadDays: 0 }]]);
    expect(pisoLeadDays(restrictions, hoy)).toBe(hoy);
  });
});

describe("nocheDeshabilitada", () => {
  const fenetre = (partiel: Partial<ReachableWindow>): ReachableWindow => ({
    fromIso: "2026-12-15",
    toIso: "2026-12-25",
    earliestCheckOutIso: "2026-12-21",
    latestCheckInIso: "2026-12-19",
    ...partiel,
  });

  // PHASE 1 — aucune arrivée posée.
  describe("phase 1 — aucune arrivée posée", () => {
    const sansAncre = (fenetres: Map<string, ReachableWindow | null>) => ({
      ancreIso: null,
      fenetreAtteignable: null,
      fenetresParArrivee: fenetres,
      calculerFenetre: () => null,
    });

    it("une date d'où un séjour valide peut partir reste cliquable", () => {
      const cache = new Map([["2026-12-20", fenetre({})]]);
      expect(nocheDeshabilitada("2026-12-20", sansAncre(cache))).toBe(false);
    });

    it("une date sans fenêtre est désactivée — nuit pleine ou SANS DONNÉE", () => {
      const cache = new Map<string, ReachableWindow | null>([["2026-12-23", null]]);
      expect(nocheDeshabilitada("2026-12-23", sansAncre(cache))).toBe(true);
    });

    it("une fenêtre sans sortie atteignable est désactivée — min_stay ne tient pas", () => {
      const cache = new Map([["2026-12-20", fenetre({ earliestCheckOutIso: null })]]);
      expect(nocheDeshabilitada("2026-12-20", sansAncre(cache))).toBe(true);
    });

    it("une fenêtre légitimement NULLE n'est pas confondue avec un défaut de cache", () => {
      // `has`, pas `??` : sans ça, une arrivée dont la fenêtre vaut null serait recalculée par le
      // repli, qui pourrait répondre autre chose. Ici le repli rendrait une fenêtre valide — la
      // case doit rester désactivée quand même.
      const cache = new Map<string, ReachableWindow | null>([["2026-12-23", null]]);
      const resultat = nocheDeshabilitada("2026-12-23", {
        ancreIso: null,
        fenetreAtteignable: null,
        fenetresParArrivee: cache,
        calculerFenetre: () => fenetre({}),
      });
      expect(resultat).toBe(true);
    });

    it("une date absente du cache passe par le repli", () => {
      const resultat = nocheDeshabilitada("2027-05-02", {
        ancreIso: null,
        fenetreAtteignable: null,
        fenetresParArrivee: new Map(),
        calculerFenetre: () => fenetre({}),
      });
      expect(resultat).toBe(false);
    });
  });

  // PHASE 2 — une arrivée est posée.
  describe("phase 2 — une arrivée est posée", () => {
    const avecAncre = (f: ReachableWindow) => ({
      ancreIso: "2026-12-20",
      fenetreAtteignable: f,
      fenetresParArrivee: new Map<string, ReachableWindow | null>(),
      calculerFenetre: () => null,
    });

    it("recliquer l'ancre reste permis — c'est le ré-ancrage", () => {
      expect(nocheDeshabilitada("2026-12-20", avecAncre(fenetre({})))).toBe(false);
    });

    it("hors de la fenêtre, tout est désactivé", () => {
      expect(nocheDeshabilitada("2026-12-14", avecAncre(fenetre({})))).toBe(true);
      expect(nocheDeshabilitada("2026-12-26", avecAncre(fenetre({})))).toBe(true);
    });

    it("EN AVANT, une sortie trop proche est refusée — min_stay est une borne BASSE", () => {
      // earliestCheckOutIso = 21 : le 21 passe, le 20+1 seulement s'il l'atteint.
      expect(nocheDeshabilitada("2026-12-21", avecAncre(fenetre({})))).toBe(false);
      expect(
        nocheDeshabilitada("2026-12-21", avecAncre(fenetre({ earliestCheckOutIso: "2026-12-22" })))
      ).toBe(true);
    });

    it("EN AVANT, la sortie sur la première nuit pleine est ATTEIGNABLE — tout l'enjeu du correctif", () => {
      // `toIso` EST la première nuit non réservable : on dort jusqu'à la veille et on s'en va.
      expect(nocheDeshabilitada("2026-12-25", avecAncre(fenetre({})))).toBe(false);
    });

    it("EN AVANT, aucune sortie proposable désactive tout l'avant", () => {
      expect(
        nocheDeshabilitada("2026-12-22", avecAncre(fenetre({ earliestCheckOutIso: null })))
      ).toBe(true);
    });

    it("EN ARRIÈRE, un clic avant l'ancre est permis jusqu'à latestCheckInIso", () => {
      expect(nocheDeshabilitada("2026-12-19", avecAncre(fenetre({})))).toBe(false);
      expect(nocheDeshabilitada("2026-12-16", avecAncre(fenetre({})))).toBe(false);
    });

    it("EN ARRIÈRE, une arrivée trop tardive est refusée", () => {
      expect(
        nocheDeshabilitada("2026-12-19", avecAncre(fenetre({ latestCheckInIso: "2026-12-18" })))
      ).toBe(true);
    });

    it("EN ARRIÈRE, aucune arrivée proposable désactive tout l'arrière", () => {
      expect(
        nocheDeshabilitada("2026-12-19", avecAncre(fenetre({ latestCheckInIso: null })))
      ).toBe(true);
    });

    it("une nuit pleine ne peut pas être ENJAMBÉE — le grief d'origine", () => {
      // Ancre au 20, première nuit pleine le 23 : `toIso` vaut 23, donc le 27 est hors fenêtre.
      // Cliquer 20 puis 27 par-dessus une nuit pleine n'est plus possible.
      const f = fenetre({ toIso: "2026-12-23", earliestCheckOutIso: "2026-12-21" });
      expect(nocheDeshabilitada("2026-12-27", avecAncre(f))).toBe(true);
      expect(nocheDeshabilitada("2026-12-23", avecAncre(f))).toBe(false);
    });
  });
});
