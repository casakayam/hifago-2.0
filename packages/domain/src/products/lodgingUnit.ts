import { type LodgingKind } from "./lodgingKind.ts";

// `products.unit` — unité de PRIX d'un logement, à ne jamais confondre avec `lodging_kind`, qui est
// une nature de couchage (cf. lodgingKind.ts). La fiche publique s'en sert pour imprimer « por
// persona » ou « por la casa entera » à côté du montant.
//
// Trois valeurs depuis 20260827120000 ; `per_house` vient de la v1 (src/services/catalogService.js
// :841), où une propriété louée en entier se vend « une maison, une réservation par nuit ».
export const LODGING_UNITS = ["per_person", "per_two", "per_house"] as const;

export type LodgingUnit = (typeof LODGING_UNITS)[number];

export function asLodgingUnit(value: unknown): LodgingUnit | null {
  return typeof value === "string" && (LODGING_UNITS as readonly string[]).includes(value)
    ? (value as LodgingUnit)
    : null;
}

/**
 * Unité de prix PROPOSÉE au moment de lier une chambre à LobbyPMS — jamais imposée, toujours
 * corrigeable dans le formulaire.
 *
 * Ne propose QUE les cas non ambigus, et renvoie `null` partout ailleurs. C'est délibéré : le prix
 * est la donnée la plus visible d'une fiche, et se tromper d'unité la rend fausse sans la rendre
 * suspecte. Mieux vaut ne rien pré-remplir qu'un choix que personne ne relira.
 *
 * Pourquoi aucune correspondance mécanique n'existe, observé le 2026-08-27 sur le compte réel :
 * les prix de LobbyPMS sont par NIVEAU D'OCCUPATION — `plans[].prices[]` contient autant d'entrées
 * que la capacité d'une unité (GLAMPING capacity 2 → 2 prix, CAMPER Van capacity 4 → 4 prix). Leur
 * modèle n'est donc pas celui de hifago, et « CAMPER Van », chambre privée de capacité 4, n'est
 * évidemment ni `per_person`, ni `per_two`, ni `per_house`. C'est exactement le cas que cette
 * fonction laisse à l'humain.
 */
export function proposeLodgingUnit(
  kind: LodgingKind | null,
  capacity: number | null,
): LodgingUnit | null {
  // Un lit en dortoir se vend à la personne — c'est ce qu'on achète, littéralement.
  if (kind === "dorm") return "per_person";
  // Un logement entier se vend entier, quelle que soit sa capacité.
  if (kind === "whole_house") return "per_house";
  // Une privée de DEUX personnes, et seulement deux : c'est ce que `per_two` veut dire.
  if (kind === "private" && capacity === 2) return "per_two";
  return null;
}
