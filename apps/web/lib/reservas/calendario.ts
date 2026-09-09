import { format, parseISO } from "date-fns";
import {
  addDaysIso,
  isoDateToLocalMidnight,
  lastBookableDateIso,
  startOfTodayInBogota,
  type LobbyNightRestrictions,
} from "@hifago/domain";
import type { ReachableWindow } from "./reservationRange";

// Ce que les trois calendriers de réservation partagent. Extrait par la spec 30 §7a (lot B3) : le
// même `useMemo`, le même repli de mois et le même formatage ISO étaient recopiés dans les trois
// formulaires, chacun avec son commentaire de cinq lignes.
//
// ⚠️ TOUT « AUJOURD'HUI » PASSE PAR GUATAPÉ, jamais par le navigateur (CLAUDE.md §11.20, lot fuseau
// du 2026-08-28). C'est la raison d'être de la moitié de ce fichier : `react-day-picker` retombe
// sinon sur son propre `new Date()`, et un visiteur européen ouvrant la fiche le 1er du mois à 2 h
// voit le dernier jour du mois précédent — encore réservable à Guatapé — présenté comme passé.

/**
 * Borne HAUTE de l'horizon produit (six mois, décidé le 2026-08-28), sous la forme qu'attendent
 * les matchers de react-day-picker.
 *
 * À envelopper dans `useMemo(() => ultimoDiaReservable(), [])` chez l'appelant : la valeur doit
 * garder la MÊME référence d'un rendu à l'autre, sans quoi react-day-picker retraite sa grille à
 * chaque frappe du champ quantité.
 *
 * ⚠️ La forme inline n'est pas une préférence de style : `react-hooks/use-memo` refuse une
 * référence de fonction en premier argument (« Expected the first argument to be an inline
 * function expression »), le compilateur React ne pouvant pas l'analyser. Mesuré au lint.
 */
export function ultimoDiaReservable(): Date {
  return isoDateToLocalMidnight(lastBookableDateIso());
}

/**
 * Mois sur lequel le calendrier s'ouvre : celui de la première date configurée, sinon le mois
 * courant À GUATAPÉ.
 *
 * ⚠️ Le repli n'est jamais `undefined`. Sans disponibilité en base, react-day-picker retombe sur
 * son propre `new Date()`, c'est-à-dire sur le mois du NAVIGATEUR — angle mort trouvé par la
 * relecture adversariale du lot fuseau, pas par sa liste initiale.
 */
export function mesPorDefecto(primeraFechaIso: string | undefined): Date {
  return primeraFechaIso ? parseISO(primeraFechaIso) : startOfTodayInBogota();
}

/** Une date de calendrier en ISO `yyyy-MM-dd`, ou `null` quand rien n'est sélectionné. */
export function isoDeFecha(fecha: Date | undefined): string | null {
  return fecha ? format(fecha, "yyyy-MM-dd") : null;
}

/**
 * `lead_days` — LE PLANCHER QUI MONTE, pas des nuits à barrer une par une : le délai de réservation
 * est une propriété de la catégorie, pas de telle ou telle nuit.
 *
 * On retient le MAXIMUM des valeurs non nulles relevées : si deux nuits annonçaient des délais
 * différents, le plus strict est le seul qui ne propose jamais une nuit que Lobby refuserait.
 *
 * ⚠️ `null` est IGNORÉ, jamais lu comme 0 — « Lobby n'a rien dit » n'apporte aucune contrainte. La
 * distinction est gardée par le relevé (`parseLobbyNightCatalog`, verrouillé par son test) ; ici on
 * choisit un défaut d'APPLICATION sans réécrire l'observation.
 *
 * `hoyIso` est passé par l'appelant plutôt que lu ici : c'est ce qui rend la fonction testable sans
 * mock d'horloge, et ce qui force l'appelant à écrire `todayInBogota()` — visible à la relecture,
 * et attrapé par `check-timezone.sh` s'il écrit autre chose.
 */
export function pisoLeadDays(
  restricciones: Map<string, LobbyNightRestrictions>,
  hoyIso: string
): string {
  let lead = 0;
  for (const restriccion of restricciones.values()) {
    if (restriccion.leadDays !== null && restriccion.leadDays > lead) lead = restriccion.leadDays;
  }
  return lead > 0 ? addDaysIso(hoyIso, lead) : hoyIso;
}

/**
 * Le prédicat `disabled` du calendrier d'hébergement — la pièce la plus dense du lot B3, trente
 * lignes écrites en propriété JSX (spec 30 §7a, duplication n°7).
 *
 * POLARITÉ : `true` = la case est DÉSACTIVÉE, exactement comme le `disabled` de react-day-picker.
 * L'appelant ne l'inverse jamais — une négation à ce site serait la façon la plus discrète de
 * rouvrir l'enjambement de nuits pleines.
 *
 * Elle ne lit AUCUN état React : tout ce dont elle a besoin est passé. C'est ce qui la rend
 * testable sans monter un calendrier.
 */
export function nocheDeshabilitada(
  iso: string,
  {
    ancreIso,
    fenetreAtteignable,
    fenetresParArrivee,
    calculerFenetre,
  }: {
    /** L'arrivée posée, s'il y en a une. */
    ancreIso: string | null;
    /** La fenêtre calculée depuis cette arrivée. */
    fenetreAtteignable: ReachableWindow | null;
    /** Fenêtres pré-calculées par date d'arrivée — le cache de la phase 1. */
    fenetresParArrivee: Map<string, ReachableWindow | null>;
    /** Repli du cache, pour une date qu'il ne porte pas. */
    calculerFenetre: (iso: string) => ReachableWindow | null;
  }
): boolean {
  // PHASE 2 — une arrivée est posée. Seule la fenêtre atteignable reste cliquable, et la première
  // nuit bloquante y figure comme date de SORTIE (on dort jusqu'à la veille). C'est ce qui empêche
  // d'ENJAMBER une nuit pleine, au lieu de le reprocher après coup : `hasUnavailableNightInRange`
  // n'a plus l'occasion de parler.
  if (fenetreAtteignable && ancreIso) {
    if (iso === ancreIso) return false; // recliquer l'ancre reste permis (ré-ancrage)
    if (iso < fenetreAtteignable.fromIso || iso > fenetreAtteignable.toIso) return true;
    // `min_stay` — la borne BASSE. Une sortie trop proche de l'arrivée ne fait pas un séjour assez
    // long : elle n'est pas signalée, elle n'est pas sélectionnable.
    if (iso > ancreIso) {
      const sortie = fenetreAtteignable.earliestCheckOutIso;
      return sortie === null || iso < sortie;
    }
    const arrivee = fenetreAtteignable.latestCheckInIso;
    return arrivee === null || iso > arrivee;
  }

  // PHASE 1 — pas encore d'arrivée. On demande à la MÊME fonction si un séjour valide peut partir
  // d'ici, plutôt que de réécrire la règle : ça couvre la nuit SANS DONNÉE (acquis du 2026-08-28),
  // la nuit PLEINE (2026-08-29), et l'arrivée d'où aucun séjour d'au moins `min_stay` nuits ne
  // tient dans la fenêtre.
  //
  // ⚠️ `has`, pas `??` : une fenêtre légitimement calculée peut valoir `null` (l'arrivée elle-même
  // ne tient pas la quantité), et `??` la reprendrait pour un défaut de cache. Le repli ne sert que
  // les cases hors du mois chargé, déjà écartées plus haut.
  const depuisIci = fenetresParArrivee.has(iso)
    ? fenetresParArrivee.get(iso)!
    : calculerFenetre(iso);
  return depuisIci === null || depuisIci.earliestCheckOutIso === null;
}
