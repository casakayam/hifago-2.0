import { describe, expect, it } from "vitest";
import {
  MAX_TEXTO,
  ajouterLigne,
  emptyProgram,
  joursAAfficher,
  programFromColumn,
  prochainJour,
  retirerJour,
  retirerLigne,
  setLigne,
  toProgramColumn,
  validateProgram,
} from "./program";

describe("toProgramColumn / programFromColumn", () => {
  it("un brouillon vide ne stocke rien — null, jamais [] (convention price_tiers/stay_rates)", () => {
    expect(toProgramColumn(emptyProgram())).toBeNull();
    expect(toProgramColumn([{ day: 1, lines: [{}, { es: "   " }] }])).toBeNull();
  });

  it("aplatit vers une liste plate où PLUSIEURS entrées portent le même day", () => {
    const colonne = toProgramColumn([
      { day: 1, lines: [{ es: "Recogida", en: "Pickup" }, { es: "Fogata" }] },
      { day: 2, lines: [{ es: "Lancha" }] },
    ]);
    expect(colonne).toEqual([
      { day: 1, text: { es: "Recogida", en: "Pickup" } },
      { day: 1, text: { es: "Fogata" } },
      { day: 2, text: { es: "Lancha" } },
    ]);
  });

  it("préserve l'ordre des lignes DANS un jour — c'est lui qui fait foi à l'affichage", () => {
    const colonne = toProgramColumn([{ day: 1, lines: [{ es: "Primero" }, { es: "Segundo" }] }]);
    expect(colonne?.map((e) => e.text.es)).toEqual(["Primero", "Segundo"]);
  });

  it("trie les journées sans muter le brouillon reçu (il vient d'un state React)", () => {
    const draft = [
      { day: 3, lines: [{ es: "Tres" }] },
      { day: 1, lines: [{ es: "Uno" }] },
    ];
    expect(toProgramColumn(draft)?.map((e) => e.day)).toEqual([1, 3]);
    expect(draft[0].day).toBe(3);
  });

  it("retire les lignes vides, les langues vides, et les lignes sans espagnol", () => {
    expect(
      toProgramColumn([
        { day: 1, lines: [{ es: "  Recogida  ", en: "   " }, {}, { en: "Only english" }] },
      ]),
    ).toEqual([{ day: 1, text: { es: "Recogida" } }]);
  });

  it("aller-retour colonne → brouillon → colonne, sans perte quand un jour porte plusieurs lignes", () => {
    const colonne = [
      { day: 1, text: { es: "Recogida", en: "Pickup" } },
      { day: 1, text: { es: "Fogata" } },
      { day: 2, text: { es: "Lancha" } },
    ];
    expect(toProgramColumn(programFromColumn(colonne))).toEqual(colonne);
  });

  it("regroupe la liste plate par journée", () => {
    expect(programFromColumn([
      { day: 2, text: { es: "B" } },
      { day: 1, text: { es: "A1" } },
      { day: 1, text: { es: "A2" } },
    ])).toEqual([
      { day: 1, lines: [{ es: "A1" }, { es: "A2" }] },
      { day: 2, lines: [{ es: "B" }] },
    ]);
  });

  it("ne throw JAMAIS sur une colonne absente, corrompue ou d'une forme inattendue", () => {
    for (const valeur of [null, undefined, {}, "texto", 42, [1, 2], [{ day: 0, text: { es: "x" } }],
                          [{ day: "uno", text: { es: "x" } }], [{ day: 1 }], [{ day: 1, text: 5 }],
                          [{ day: 1, text: { es: 7 } }]]) {
      expect(() => programFromColumn(valeur)).not.toThrow();
    }
    expect(programFromColumn("texto")).toEqual([]);
    expect(programFromColumn([{ day: 1, text: { es: 7 } }])).toEqual([]);
  });
});

describe("validateProgram", () => {
  it("un programme vide est valide — le programme reste facultatif", () => {
    expect(validateProgram(emptyProgram(), 5)).toBeNull();
    expect(validateProgram([{ day: 1, lines: [{}] }], 5)).toBeNull();
  });

  it("une ligne en anglais sans espagnol est refusée (sinon le repli l'afficherait en ES)", () => {
    expect(validateProgram([{ day: 1, lines: [{ en: "Pickup" }] }], 5)).toMatch(/español/);
  });

  it("refuse un jour au-delà de la durée du camp QUAND elle est connue", () => {
    expect(validateProgram([{ day: 6, lines: [{ es: "x" }] }], 5)).toMatch(/día 6/);
  });

  it("…et l'accepte quand la durée est inconnue — saisir le programme avant la durée est légitime", () => {
    expect(validateProgram([{ day: 6, lines: [{ es: "x" }] }], null)).toBeNull();
  });

  it("refuse un jour absurde et une ligne trop longue", () => {
    expect(validateProgram([{ day: 0, lines: [{ es: "x" }] }], null)).toMatch(/mayor o igual a 1/);
    expect(validateProgram([{ day: 61, lines: [{ es: "x" }] }], null)).toMatch(/día 60/);
    expect(validateProgram([{ day: 1, lines: [{ es: "x".repeat(MAX_TEXTO + 1) }] }], null))
      .toMatch(new RegExp(String(MAX_TEXTO)));
  });

  it("refuse au-delà du plafond de lignes (miroir du program_cap_exceeded serveur)", () => {
    const lines = Array.from({ length: 201 }, () => ({ es: "x" }));
    expect(validateProgram([{ day: 1, lines }], null)).toMatch(/200/);
  });
});

describe("édition du brouillon", () => {
  it("setLigne crée la journée et la ligne au besoin, sans muter le brouillon", () => {
    const draft = emptyProgram();
    const apres = setLigne(draft, 2, 0, "es", "Lancha");
    expect(apres).toEqual([{ day: 2, lines: [{ es: "Lancha" }] }]);
    expect(draft).toEqual([]);
  });

  it("setLigne conserve l'autre langue — la régression que ce helper existe pour empêcher", () => {
    let draft = setLigne(emptyProgram(), 1, 0, "es", "Recogida");
    draft = setLigne(draft, 1, 0, "en", "Pickup");
    draft = setLigne(draft, 1, 0, "es", "Recogida en Medellín");
    expect(draft[0].lines[0]).toEqual({ es: "Recogida en Medellín", en: "Pickup" });
  });

  it("ajouterLigne / retirerLigne / retirerJour", () => {
    let draft = ajouterLigne(emptyProgram(), 1);
    draft = setLigne(draft, 1, 0, "es", "A");
    draft = ajouterLigne(draft, 1);
    draft = setLigne(draft, 1, 1, "es", "B");
    expect(draft[0].lines).toHaveLength(2);
    draft = retirerLigne(draft, 1, 0);
    expect(draft[0].lines).toEqual([{ es: "B" }]);
    expect(retirerJour(draft, 1)).toEqual([]);
  });
});

describe("joursAAfficher / prochainJour", () => {
  it("ouvre 1..durationDays quand la durée est connue", () => {
    expect(joursAAfficher(emptyProgram(), 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("garde un jour déjà saisi hors de la durée plutôt que de le faire disparaître", () => {
    expect(joursAAfficher([{ day: 7, lines: [{ es: "x" }] }], 5)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("propose au moins le jour 1 quand la durée est inconnue", () => {
    expect(joursAAfficher(emptyProgram(), null)).toEqual([1]);
    expect(prochainJour(emptyProgram(), null)).toBe(2);
    expect(prochainJour(emptyProgram(), 3)).toBe(4);
  });
});
