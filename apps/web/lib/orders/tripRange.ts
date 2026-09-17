import { isoDateToLocalMidnight } from "@hifago/domain";
import { resolveDisplayEndDate, type LineSchedule } from "./formatLineSchedule";

export type TripRangeLine = LineSchedule;

export type TripRange = { start: string; end: string };

/**
 * Bornes du voyage représenté par une commande OU un panier : la première date, et la dernière
 * (checkout si la ligne en a un, calculée pour un camp via `duration_days`, sinon sa propre date —
 * même résolution que `formatLineSchedule`, `resolveDisplayEndDate`). TOUTES les lignes comptent, y
 * compris annulées/expirées (décision Jérôme) — contrairement à `OrderForDisplay.totalCop`, qui lui
 * exclut les lignes mortes. `lines` n'est jamais vide côté commande (`create_order` refuse
 * `p_lines` vide, migration `20260910140000_simplification_spec31.sql:70`) ; côté panier,
 * l'appelant garde déjà un embranchement dédié au panier vide (`CartSummary.tsx`), donc jamais
 * atteint ici non plus.
 */
export function computeTripRange(lines: TripRangeLine[]): TripRange {
  const starts = lines.map((line) => line.date);
  const ends = lines.map((line) => resolveDisplayEndDate(line) ?? line.date);
  return {
    start: starts.reduce((earliest, date) => (date < earliest ? date : earliest)),
    end: ends.reduce((latest, date) => (date > latest ? date : latest)),
  };
}

/**
 * "Tu viaje del 12 al 15 sept" / "Tu viaje del 12 sept" — le titre affiché au-dessus d'un groupe
 * de prestations, partagé par l'écran de résultat (`OrderResult.tsx`) et le panier
 * (`CartSummary.tsx`, `/mi-viaje` et `/pago`). `t` est le traducteur du namespace
 * `OrderResultPage` (clés `trip.range`/`trip.single`) — les MÊMES clés dans les trois écrans,
 * jamais recopiées (même précédent que `lineStatus`/`status`, réutilisées par `OrderCard.tsx`
 * plutôt que dupliquées dans `AccountOrdersPage`).
 *
 * ⚠️ `Intl.DateTimeFormat` ici et pas `formatRange` (`formatPlage`/`formatEditionDateRange`) : le
 * mot de liaison ("del … al …" / "from … to …") change d'ordre et de sens par langue, ce que
 * `formatRange` ne produit pas — d'où le passage par une clé i18n à deux paramètres déjà formatés.
 */
export function formatTripLabel(
  range: TripRange,
  locale: string,
  t: (key: string, values: Record<string, string>) => string
): string {
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  // `isoDateToLocalMidnight` et pas `new Date(iso)` : ce dernier est lu en UTC minuit et
  // `Intl.DateTimeFormat.format` peut alors reculer d'un jour selon le fuseau du runtime. Le
  // dépôt a UN helper pour ce piège (`@hifago/domain`), jamais l'idiome recopié à la main.
  const label = (iso: string) => format.format(isoDateToLocalMidnight(iso));
  return range.start === range.end
    ? t("trip.single", { start: label(range.start) })
    : t("trip.range", { start: label(range.start), end: label(range.end) });
}
