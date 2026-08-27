import { describe, expect, it } from "vitest";
import { asLodgingUnit, proposeLodgingUnit } from "./lodgingUnit";

// proposeLodgingUnit ne propose que l'évident et se tait sur le reste. C'est le point du test :
// une unité de prix fausse rend une fiche fausse sans la rendre suspecte, donc ne rien pré-remplir
// vaut mieux qu'un choix que personne ne relira.
describe("proposeLodgingUnit", () => {
  it("un lit en dortoir se vend à la personne", () => {
    expect(proposeLodgingUnit("dorm", 1)).toBe("per_person");
    // Vrai quelle que soit la capacité déclarée — c'est la nature qui tranche, pas le nombre.
    expect(proposeLodgingUnit("dorm", 8)).toBe("per_person");
  });

  it("un logement entier se vend entier", () => {
    expect(proposeLodgingUnit("whole_house", 8)).toBe("per_house");
    expect(proposeLodgingUnit("whole_house", null)).toBe("per_house");
  });

  it("une privée de DEUX, et seulement deux, se vend per_two", () => {
    expect(proposeLodgingUnit("private", 2)).toBe("per_two");
  });

  // LE cas qui justifie l'existence de cette fonction plutôt qu'une table de correspondance :
  // « CAMPER Van », privada de capacité 4 sur le compte réel, n'est évidemment ni per_person, ni
  // per_two, ni per_house. Deviner ici serait pire que se taire.
  it("ne propose RIEN pour une privée dont la capacité n'est pas deux", () => {
    for (const capacity of [1, 3, 4, 6, null]) {
      expect(proposeLodgingUnit("private", capacity)).toBeNull();
    }
  });

  it("ne propose rien sans nature de couchage", () => {
    expect(proposeLodgingUnit(null, 2)).toBeNull();
  });
});

describe("asLodgingUnit", () => {
  it("accepte les trois valeurs du domaine", () => {
    for (const unit of ["per_person", "per_two", "per_house"]) {
      expect(asLodgingUnit(unit)).toBe(unit);
    }
  });

  // La colonne est typée `string | null` côté types générés : sans ce filtre, une valeur hors
  // domaine traverserait jusqu'au Select, qui n'afficherait alors aucune option sans rien signaler.
  it("ramène tout le reste à null", () => {
    for (const value of [null, undefined, "", "per_three", 2, {}]) {
      expect(asLodgingUnit(value)).toBeNull();
    }
  });
});
