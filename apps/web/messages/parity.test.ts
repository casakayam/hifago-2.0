// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMessages } from "./index";

// Garde-fou de la faute i18n la plus fréquente, et la plus silencieuse : une clé ajoutée d'un seul
// côté. next-intl n'échoue pas — il affiche le NOM BRUT de la clé au client, en production.
//
// Il devient franchement utile maintenant que plusieurs agents créent des composants en parallèle :
// chacun n'écrit que dans son namespace, et personne ne relit les neuf autres.
//
// ⚠️ Ce test ne vérifie PAS qu'une clé est réellement utilisée par un composant, ni qu'aucune chaîne
// n'est écrite en dur. Cette règle-là reste tenue par la relecture (un grep sur les littéraux JSX
// serait noyé de faux positifs) — ne pas croire qu'elle est couverte ici.

/** Tous les chemins de clés d'un objet de messages, à plat : `HomePage.types.lodging`. */
function cheminsDeCles(valeur: unknown, prefixe = ""): string[] {
  if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) {
    return [prefixe];
  }
  return Object.entries(valeur as Record<string, unknown>).flatMap(([cle, sous]) =>
    cheminsDeCles(sous, prefixe ? `${prefixe}.${cle}` : cle)
  );
}

describe("parité des messages entre les locales", () => {
  it("les deux locales portent exactement les mêmes clés", () => {
    const es = new Set(cheminsDeCles(loadMessages("es")));
    const en = new Set(cheminsDeCles(loadMessages("en")));

    const manquantEnAnglais = [...es].filter((c) => !en.has(c)).sort();
    const manquantEnEspagnol = [...en].filter((c) => !es.has(c)).sort();

    // Message explicite : la valeur d'un garde-fou tient à ce qu'il dise quoi corriger.
    expect({ manquantEnAnglais, manquantEnEspagnol }).toEqual({
      manquantEnAnglais: [],
      manquantEnEspagnol: [],
    });
  });

  it("aucun fichier de namespace n'est oublié dans messages/index.ts", () => {
    // Le cas concret : un agent crée `messages/es/Chrome.json` et `messages/en/Chrome.json` mais
    // oublie de les brancher dans index.ts. Rien ne casse, et son écran affiche des clés brutes.
    const surDisque = (locale: string) =>
      readdirSync(join(__dirname, locale))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();

    // Les namespaces branchés sont DÉRIVÉS de l'agrégateur, jamais redits dans une liste à part :
    // une quatrième copie des mêmes dix noms finirait par diverger, et ferait accuser le disque
    // alors que le branchement serait correct. Dériver couvre en prime les DEUX locales.
    for (const locale of ["es", "en"] as const) {
      expect(surDisque(locale)).toEqual(Object.keys(loadMessages(locale)).sort());
    }
  });
});
