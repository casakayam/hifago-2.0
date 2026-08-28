// Le fuseau de l'exploitation, et toutes les formes de « date » qui en dépendent, en un seul endroit.
//
// POURQUOI CE MODULE EXISTE. Jusqu'au 2026-08-28, la chaîne "America/Bogota" n'apparaissait NULLE
// PART dans le code de hifago — seulement dans trois commentaires. Partout où il fallait « la date
// d'aujourd'hui », le code écrivait `new Date().toISOString().slice(0, 10)`, qui rend la date UTC.
// Bogotá est à UTC−5 toute l'année (la Colombie n'a pas d'heure d'été) : passé 19 h heure locale,
// cette expression rend DÉJÀ le lendemain. Dix sites l'écrivaient, plus dix-sept autres qui
// commettaient la même faute avec `Intl` (cf. `formatDateInBogota` en bas de fichier).
//
// Le cas concret qui a motivé la campagne — apps/web/app/api/pms/night-availability/route.ts, où
// cette valeur sert de plancher « ne rien demander avant aujourd'hui » : après 19 h à Guatapé, la
// nuit EN COURS n'était même pas demandée à LobbyPMS, donc jamais affichée, donc non réservable.
// Pas un décalage d'affichage : une nuit qui disparaît du calendrier tous les soirs.
//
// Ce répertoire est l'UNIQUE échappatoire autorisée à la règle de lint `no-restricted-syntax` des
// deux apps et au garde-fou scripts/check-timezone.sh. Sa contrepartie SQL est
// `public.today_in_bogota()` (migration 20260828150000).
//
// HISTORIQUE. Ce fichier est né de la fusion de `todayInBogota.ts` (lot connecteur PMS) et de
// `bogotaDates.ts` (lot fuseau), écrits le même jour par deux sessions parallèles qui ne pouvaient
// pas éditer le même fichier sans risquer de s'écraser. Les deux moitiés sont réunies ici depuis le
// 2026-08-28 ; il n'y a plus qu'un seul module.
export const OPERATION_TIME_ZONE = "America/Bogota";

// `Intl.DateTimeFormat` plutôt qu'un décalage de −5 h codé en dur : c'est la base de données de
// fuseaux du runtime qui fait foi, pas une soustraction qui deviendrait fausse le jour où la
// Colombie adopterait l'heure d'été (déjà arrivé en 1992-1993). `formatToParts` plutôt que
// `format` : la disposition d'une locale n'est pas un contrat stable, la liste des composants si.
const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: OPERATION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * La date civile (yyyy-MM-dd) qu'il est À GUATAPÉ à l'instant `now`, jamais celle d'UTC ni celle du
 * navigateur qui appelle. `now` est un paramètre pour que les tests puissent fixer l'instant sans
 * toucher à l'horloge du processus.
 */
export function todayInBogota(now: Date = new Date()): string {
  const parts = partsFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Minuit LOCAL du jour civil qu'il est à Guatapé — l'objet `Date` que réclament les calendriers.
 *
 * react-day-picker (`disabled={[{ before: … }]}`) et le calendrier socio raisonnent en jours
 * civils sur des `Date` à composants LOCAUX : `differenceInCalendarDays(matcher.before, day) > 0`
 * (vérifié dans react-day-picker 10.0.1, `utils/dateMatchModifiers.js`). La partie horaire est donc
 * sans effet — seul compte le jour, et c'est exactement le jour que ces trois formulaires prenaient
 * au NAVIGATEUR du visiteur au lieu de le prendre en Colombie. Un client à Paris qui ouvrait la
 * fiche le 1er du mois à 2 h du matin voyait le 30 barré alors qu'il était encore réservable.
 *
 * `new Date(annee, mois, jour)` (constructeur à composants locaux, jamais `Date.UTC`) : c'est ce
 * qui garantit que `getDate()` rende le jour de Guatapé quel que soit le fuseau de la machine.
 */
export function startOfTodayInBogota(now: Date = new Date()): Date {
  return isoDateToLocalMidnight(todayInBogota(now));
}

/**
 * Minuit LOCAL d'une date civile déjà connue (yyyy-MM-dd). Même contrat que
 * `startOfTodayInBogota`, pour une date qui ne vient pas de l'horloge.
 */
export function isoDateToLocalMidnight(dateIso: string): Date {
  const { year, month, day } = splitIsoDate(dateIso);
  return new Date(year, month - 1, day);
}

/**
 * Arithmétique de date CIVILE : `2026-12-23` + 1 jour = `2026-12-24`, sans fuseau d'aucune sorte.
 *
 * Le résultat ne dépend ni du fuseau de la machine ni de celui de Guatapé. Ce n'est PAS une
 * conversion de fuseau et ça n'a pas à en être une — la seule question dont la réponse dépend du
 * fuseau, « quel jour sommes-nous ? », est déjà tranchée par `todayInBogota()`, dont le résultat est
 * ce qu'on passe ici.
 *
 * ⚠️ DEUX PIÈGES, tous deux corrigés le 2026-08-28 après revue croisée des deux lots. La première
 * version ancrait sur `Date.UTC(year, …)` et rendait `anchor.toISOString().slice(0, 10)` :
 *
 *   - `Date.UTC(1, 0, 1)` ne vaut PAS l'an 1 mais 1901 — le remappage des années à deux chiffres
 *     hérité de JavaScript. `addDaysIso("0001-01-01", -1)` rendait donc `"1900-12-31"`, faux de
 *     dix-neuf siècles, en silence.
 *   - `toISOString()` bascule en format étendu au-delà de l'an 9999 :
 *     `addDaysIso("9999-12-31", 1)` rendait `"+010000-01"`, une date malformée qu'aucun garde du
 *     code n'aurait reconnue. Le jumeau de ce défaut vivait dans `addOneDay` du connecteur PMS, où
 *     la valeur partait telle quelle en `end_date` vers Lobby sur une route PUBLIQUE.
 *
 * `new Date("yyyy-MM-ddT00:00:00Z")` (analyse ISO, pas le constructeur à composants) échappe au
 * premier, et recomposer la sortie à partir des composants UTC échappe au second. La fonction
 * refusait déjà une entrée malformée ; elle refuse désormais aussi une SORTIE hors domaine, pour
 * qu'aucun appelant n'ait à se demander ce qu'il tient.
 */
export function addDaysIso(dateIso: string, days: number): string {
  splitIsoDate(dateIso);
  const anchor = new Date(`${dateIso}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);

  const year = anchor.getUTCFullYear();
  if (!Number.isFinite(year) || year < 1 || year > 9999) {
    throw new RangeError(
      `addDaysIso(${JSON.stringify(dateIso)}, ${days}) sort du domaine yyyy-MM-dd (année ${year}).`,
    );
  }
  return [
    String(year).padStart(4, "0"),
    String(anchor.getUTCMonth() + 1).padStart(2, "0"),
    String(anchor.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * L'INSTANT courant en ISO 8601 complet (avec l'heure, en UTC) — jamais une date civile.
 *
 * Existe pour rendre la distinction visible au point d'appel. Un `created_at`/`received_at` posé en
 * optimiste côté écran est un instant : l'écrire en UTC est correct, et le fuseau n'a rien à y voir.
 * Le bug de ce dépôt n'a jamais été « on écrit de l'UTC », il a été « on TRONQUE un instant UTC pour
 * en tirer un jour ». Sans cette fonction, ces trois sites-là auraient dû désactiver la règle de lint
 * une ligne sur deux, et la règle serait morte de ses exceptions.
 */
export function nowIsoInstant(now: Date = new Date()): string {
  return now.toISOString();
}

function splitIsoDate(dateIso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) {
    // Jamais silencieux : une date malformée qui glisse jusqu'ici produirait un `Invalid Date`, donc
    // une sortie absurde à des lignes de la vraie cause.
    throw new RangeError(`Date civile attendue au format yyyy-MM-dd, reçu : ${JSON.stringify(dateIso)}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Un INSTANT (`timestamptz` de la base : `created_at`, `expires_at`, `consumed_at`…) rendu à
 * l'écran dans le fuseau de Guatapé.
 *
 * POURQUOI CES DEUX FONCTIONS EXISTENT (ajoutées le 2026-08-28, après la relecture adversariale du
 * lot fuseau). Dix-sept sites écrivaient `new Date(order.created_at).toLocaleDateString("es")`.
 * C'est le MÊME défaut que `.toISOString().slice(0, 10)`, simplement écrit avec `Intl` : on projette
 * un instant sur une date civile sans jamais dire dans quel fuseau. Sur les Server Components c'est
 * pire encore — le serveur Vercel est en UTC, donc le résultat n'est le bon fuseau de PERSONNE :
 * une commande passée le 27 à 20 h 15 à Guatapé s'affichait « Creado el 28/8/2026 », tous les soirs.
 *
 * ⚠️ CE QUI CHANGE À L'ÉCRAN, EXACTEMENT. L'option `timeZone` est passée en gardant
 * `toLocaleDateString`/`toLocaleString` : sur les sites qui passaient DÉJÀ une locale explicite
 * (`("es")`, la grande majorité), le format rendu est rigoureusement identique et seul le fuseau de
 * projection change. Ce n'est PAS vrai partout, et une version antérieure de ce commentaire
 * l'affirmait à tort : sur `apps/web/app/[locale]/account/orders/OrdersList.tsx`, l'appel était
 * `toLocaleDateString()` SANS argument, donc la locale du serveur au rendu SSR puis celle du
 * NAVIGATEUR après hydratation — la date affichée changeait entre les deux. Ce site passe désormais
 * `useLocale()` (next-intl) : la locale change volontairement, parce que l'ancienne était un
 * second défaut, pas une intention.
 */
export function formatDateInBogota(instant: Date | string | number, locale?: string): string {
  return toInstant(instant).toLocaleDateString(locale, { timeZone: OPERATION_TIME_ZONE });
}

/** Comme `formatDateInBogota`, mais avec l'heure — pour les écrans qui l'affichaient déjà. */
export function formatDateTimeInBogota(instant: Date | string | number, locale?: string): string {
  return toInstant(instant).toLocaleString(locale, { timeZone: OPERATION_TIME_ZONE });
}

function toInstant(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}
