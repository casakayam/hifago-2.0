import type { LocalizedValue } from "@/components/localized-text-field";

// Programme jour par jour d'un camp (spec 37, migrations 20260916130000/140000). Reprend en le
// structurant le champ `program` de la V1 (experiences.program, un textarea « una línea por
// punto ») : la journée y était une convention d'écriture dans le texte (« Día 1 · … »), elle
// devient ici une donnée.
//
// Le jour est RELATIF au départ (día 1..n), jamais une date calendaire : un camp a plusieurs
// départs (product_availability) et un seul programme, que la vitrine date à l'affichage.
//
// Même convention que priceTiers.ts/slotRules.ts/stayRates.ts : brouillon en strings pour des
// inputs contrôlés, validation qui retourne un message d'erreur ou null, conversion vers le JSON
// de colonne juste avant l'écriture, et lecture qui ne throw jamais.
//
// ⚠️ Deux formes distinctes, volontairement :
//   - le BROUILLON est groupé par journée (une carte par jour à l'écran, bien plus lisible que
//     200 lignes portant chacune un numéro) ;
//   - la COLONNE est une liste PLATE [{day, text}], où plusieurs entrées partagent le même `day`.
// C'est la forme demandée par Jérôme (« peut avoir plusieurs avec le même numéro de day ») et elle
// évite d'avoir à arbitrer un jour dupliqué : la question ne se pose pas.
export type DraftProgramDay = { day: number; lines: LocalizedValue[] };
export type DraftProgram = DraftProgramDay[];

export type ProgramEntry = { day: number; text: LocalizedValue };

export const MAX_DIA = 60;
export const MAX_LINEAS = 200;
export const MAX_TEXTO = 300;

export const LANGUE_OBLIGATOIRE = "es";

export function emptyProgram(): DraftProgram {
  return [];
}

function texteDe(ligne: LocalizedValue, lang: string): string {
  return (ligne[lang] ?? "").trim();
}

// Une ligne est « vide » si AUCUNE langue ne porte de texte — elle est alors silencieusement
// retirée à l'écriture (un brouillon en cours de saisie contient forcément des lignes vides).
// Une ligne qui porte un texte anglais mais pas espagnol, elle, est une ERREUR : le repli de
// resolveLocalizedField afficherait l'anglais sur la fiche espagnole (CLAUDE.md §5.1).
function ligneEstVide(ligne: LocalizedValue): boolean {
  return Object.values(ligne).every((valeur) => (valeur ?? "").trim() === "");
}

// Message d'erreur prêt à passer tel quel à toast.danger, ou null. Un programme entièrement vide
// est valide : le programme reste facultatif, même discipline que « 0 tramo »/« aucun horario ».
//
// `durationDays` vaut null quand la durée n'est pas connue — ce qui arrive réellement : rien
// n'oblige l'admin à saisir « Duración (días) » avant le programme sur l'écran de création, et
// l'édition ne la réinjecte pas dans le formulaire. La borne ne s'applique alors pas : mieux vaut
// un programme non borné qu'un formulaire qui refuse une saisie légitime.
export function validateProgram(draft: DraftProgram, durationDays: number | null): string | null {
  let total = 0;

  for (const jour of draft) {
    if (!Number.isInteger(jour.day) || jour.day < 1) {
      return "Cada día del programa debe ser un número entero mayor o igual a 1.";
    }
    if (jour.day > MAX_DIA) {
      return `El programa no puede pasar del día ${MAX_DIA}.`;
    }
    if (durationDays != null && jour.day > durationDays) {
      return `El programa llega al día ${jour.day}, pero el camp dura ${durationDays} día(s).`;
    }

    for (const ligne of jour.lines) {
      if (ligneEstVide(ligne)) continue;
      total += 1;
      if (texteDe(ligne, LANGUE_OBLIGATOIRE) === "") {
        return `Falta el texto en español de una línea del día ${jour.day}.`;
      }
      if (Object.values(ligne).some((valeur) => (valeur ?? "").trim().length > MAX_TEXTO)) {
        return `Cada línea del programa debe tener menos de ${MAX_TEXTO} caracteres.`;
      }
    }
  }

  if (total > MAX_LINEAS) {
    return `Máximo ${MAX_LINEAS} líneas en el programa.`;
  }
  return null;
}

// Brouillon → colonne. Aplatit, trie par jour (l'ordre des lignes DANS un jour est préservé tel
// quel : c'est lui qui fait foi à l'affichage), retire les lignes vides puis les journées devenues
// vides, et les langues vides de chaque ligne. `null` si tout est vide — même convention que
// price_tiers/stay_rates (« NULL = pas de programme »), et jamais `[]`, qui stockerait du bruit.
export function toProgramColumn(draft: DraftProgram): ProgramEntry[] | null {
  const entrees: ProgramEntry[] = [];

  // `slice()` avant `sort()` : sort() mute le tableau reçu, et celui-ci vient d'un state React.
  for (const jour of [...draft].sort((a, b) => a.day - b.day)) {
    for (const ligne of jour.lines) {
      if (ligneEstVide(ligne)) continue;
      const text: LocalizedValue = {};
      for (const [lang, valeur] of Object.entries(ligne)) {
        const propre = (valeur ?? "").trim();
        if (propre !== "") text[lang] = propre;
      }
      if (text[LANGUE_OBLIGATOIRE] === undefined) continue;
      entrees.push({ day: jour.day, text });
    }
  }

  return entrees.length > 0 ? entrees : null;
}

// Colonne → brouillon, sans JAMAIS throw : une colonne absente, corrompue ou d'une forme
// inattendue rend un brouillon vide, même philosophie que stayRatesFromColumn. Regroupe la liste
// plate par journée en préservant l'ordre d'apparition des lignes.
export function programFromColumn(value: unknown): DraftProgram {
  if (!Array.isArray(value)) return emptyProgram();

  const parJour = new Map<number, LocalizedValue[]>();
  for (const brut of value) {
    if (!brut || typeof brut !== "object") continue;
    const entree = brut as Partial<ProgramEntry>;
    const day = Number(entree.day);
    if (!Number.isInteger(day) || day < 1) continue;
    if (!entree.text || typeof entree.text !== "object") continue;

    const text: LocalizedValue = {};
    for (const [lang, valeur] of Object.entries(entree.text as Record<string, unknown>)) {
      if (typeof valeur === "string") text[lang] = valeur;
    }
    if (Object.keys(text).length === 0) continue;

    if (!parJour.has(day)) parJour.set(day, []);
    parJour.get(day)!.push(text);
  }

  return [...parJour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, lines]) => ({ day, lines }));
}

// Les journées à proposer à l'écran : celles déjà saisies, complétées par 1..durationDays quand la
// durée est connue — pour qu'un camp de 5 jours ouvre ses 5 cartes sans que l'admin ait à cliquer
// « Agregar día » cinq fois.
export function joursAAfficher(draft: DraftProgram, durationDays: number | null): number[] {
  const jours = new Set(draft.map((jour) => jour.day));
  if (durationDays != null && durationDays >= 1) {
    for (let jour = 1; jour <= Math.min(durationDays, MAX_DIA); jour += 1) jours.add(jour);
  }
  if (jours.size === 0) jours.add(1);
  return [...jours].sort((a, b) => a - b);
}

// Écrit `texte` dans la langue active d'une ligne, en créant la journée et la ligne au besoin.
// Passe par une copie à chaque niveau : le brouillon vient d'un state React, jamais muté en place.
export function setLigne(
  draft: DraftProgram,
  day: number,
  index: number,
  lang: string,
  texte: string,
): DraftProgram {
  const existant = draft.find((jour) => jour.day === day);
  const lines = existant ? [...existant.lines] : [];
  while (lines.length <= index) lines.push({});
  lines[index] = { ...lines[index], [lang]: texte };

  const majJour = { day, lines };
  return existant
    ? draft.map((jour) => (jour.day === day ? majJour : jour))
    : [...draft, majJour].sort((a, b) => a.day - b.day);
}

export function ajouterLigne(draft: DraftProgram, day: number): DraftProgram {
  const existant = draft.find((jour) => jour.day === day);
  if (!existant) return [...draft, { day, lines: [{}] }].sort((a, b) => a.day - b.day);
  return draft.map((jour) => (jour.day === day ? { ...jour, lines: [...jour.lines, {}] } : jour));
}

export function retirerLigne(draft: DraftProgram, day: number, index: number): DraftProgram {
  return draft.map((jour) =>
    jour.day === day ? { ...jour, lines: jour.lines.filter((_, i) => i !== index) } : jour,
  );
}

// Retire la journée du brouillon. Elle réapparaîtra vide si elle est dans 1..durationDays
// (joursAAfficher) — c'est voulu : on ne « supprime » pas le 3e jour d'un camp de 5 jours, on vide
// son contenu.
export function retirerJour(draft: DraftProgram, day: number): DraftProgram {
  return draft.filter((jour) => jour.day !== day);
}

export function prochainJour(draft: DraftProgram, durationDays: number | null): number {
  const jours = joursAAfficher(draft, durationDays);
  return Math.min((jours[jours.length - 1] ?? 0) + 1, MAX_DIA);
}
