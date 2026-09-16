import { addDays, format, parseISO } from "date-fns";
import type { CartLineForDisplay } from "./getCartLines";

// Reflet côté front de la validation stricte de create_order (raison `camp_missing_lodging`,
// migration 20260915100000_camp_requires_compatible_lodging.sql) — MÊME formule, jamais une
// variante : nuits requises = duration_days - 1, dernier jour du camp = date + duration_days - 1,
// une SEULE ligne lodging du panier doit couvrir à elle seule toute la plage, aucune comparaison
// de quantité/personnes (qty côté lodging = des unités, qty côté camp = des personnes — deux
// grandeurs différentes), aucun filtre d'établissement.
//
// ⚠️ Ceci ne fait que GUIDER l'écran panier (bloc d'avertissement, bouton de paiement désactivé,
// lien vers l'hébergement) — la seule barrière réelle reste create_order au checkout. Un panier qui
// passe cette vérification côté front n'est jamais garanti d'être accepté (et inversement, un faux
// négatif ici ne ferait que rediriger inutilement vers /alojamientos, jamais accepter une commande
// invalide : create_order revalidera tout).

/**
 * Le DERNIER JOUR d'un camp parti le `departIso` — LA formule, celle que `create_order` applique
 * (`date + duration_days - 1`). Exportée plutôt que gardée locale parce que les deux écrans qui
 * renvoient vers `/alojamientos` en ont besoin pour composer leur plage de dates : elle était
 * écrite trois fois (ici, `mi-viaje/page.tsx`, `ReservationForm.tsx`), c'est-à-dire trois occasions
 * de diverger de la base sans que rien ne le signale.
 */
export function ultimoDiaCampIso(departIso: string, durationDays: number): string {
  return format(addDays(parseISO(departIso), Math.max(durationDays, 1) - 1), "yyyy-MM-dd");
}

/** Les NUITS qu'un camp impose de couvrir — `duration_days - 1`, même formule que `create_order`. */
export function nochesRequeridas(durationDays: number): number {
  return Math.max(durationDays, 1) - 1;
}

/** La première ligne camp du panier dont aucune ligne lodging ne couvre les nuits requises, ou
 * `null` si toutes en ont une (ou si le panier n'a aucun camp de plus d'un jour). */
export function findCampMissingLodging(lines: CartLineForDisplay[]): CartLineForDisplay | null {
  return (
    lines.find((line) => {
      if (line.productType !== "camp" || !line.durationDays || line.durationDays <= 1) return false;

      const arrival = parseISO(line.date);
      const lastDay = parseISO(ultimoDiaCampIso(line.date, line.durationDays));

      return !lines.some((candidate) => {
        if (candidate.productType !== "lodging" || !candidate.endDate) return false;
        return parseISO(candidate.date) <= arrival && parseISO(candidate.endDate) >= lastDay;
      });
    }) ?? null
  );
}
