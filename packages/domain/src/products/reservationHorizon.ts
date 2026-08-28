import { addMonthsIso, monthRank, todayInBogota } from "../time/bogotaDates.ts";

/**
 * L'HORIZON PRODUIT : jusqu'où hifago accepte d'ouvrir la réservation.
 *
 * Décidé par Jérôme le 2026-08-28 : **six mois**. Une seule définition dans tout le dépôt, parce
 * qu'il y en avait trois qui ne disaient pas la même chose —
 *   - `addDaysIso(todayIso, 180)` pour le catalogue à créneaux (fiche produit),
 *   - `addDaysIso(today, 183)` pour l'agenda socio,
 *   - `MAX_MONTHS_AHEAD = 36` pour la route de disponibilité PMS.
 * Les deux premières divergeaient de trois jours, ce qui suffit à ouvrir une nuit d'un côté et à la
 * fermer de l'autre. La troisième n'a jamais prétendu être un horizon produit : c'était un garde
 * d'ABUS (route publique et anonyme, chaque mois distinct coûtant un vrai appel LobbyPMS). Elle est
 * désormais couverte par celui-ci, qui est strictement plus serré — un garde d'abus n'a aucune
 * raison d'être plus large que ce qu'on accepte de vendre.
 */
export const RESERVATION_HORIZON_MONTHS = 6;

/**
 * La dernière date civile réservable, à partir du jour qu'il est À GUATAPÉ.
 *
 * ⚠️ Inclusive : c'est le dernier jour qu'on accepte, pas le premier qu'on refuse. Les appelants
 * l'emploient tels quels dans des bornes `lte`/`p_to`, qui sont inclusives côté SQL.
 */
export function lastBookableDateIso(todayIso: string = todayInBogota()): string {
  return addMonthsIso(todayIso, RESERVATION_HORIZON_MONTHS);
}

/**
 * Un mois `yyyy-MM` est-il interrogeable ? Faux pour le passé comme pour l'au-delà de l'horizon.
 *
 * ⚠️ La comparaison porte sur le MOIS, pas sur le jour : le mois de `lastBookableDateIso` est
 * accepté ENTIER, quitte à contenir quelques jours au-delà de la borne exacte. C'est voulu — un
 * calendrier qui ouvre un mois pour n'en afficher que les onze premiers jours réservables est plus
 * clair qu'un mois manquant, et le verdict à la nuit près reste posé plus bas par la disponibilité
 * elle-même. C'est aussi ce qui garde ce test purement arithmétique, sans arbitrage de bord.
 */
export function isMonthWithinHorizon(month: string, todayIso: string = todayInBogota()): boolean {
  const ecart = monthRank(month) - monthRank(todayIso.slice(0, 7));
  return ecart >= 0 && ecart <= RESERVATION_HORIZON_MONTHS;
}
