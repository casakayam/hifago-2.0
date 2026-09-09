import type { CartLine } from "@/lib/cart/CartContext";

// Les places restantes, et ce qu'on en dit à l'écran. Extrait des trois formulaires de réservation
// par la spec 30 §7a (lot B3), où le même calcul était écrit à QUATRE endroits — dont deux fois
// dans le même fichier.
//
// ⚠️ RIEN ICI N'EST UNE BARRIÈRE. Le plafond affiché au client est indicatif : la seule barrière
// de capacité est `create_order` (`SECURITY DEFINER`, `SELECT … FOR UPDATE`), appelée depuis
// /pago. Ce module sert le GUIDAGE — « ne propose pas ce que la base refusera » — et son invariant
// est l'échec fermé : une ligne absente n'est jamais réservable.

/** Une ligne de disponibilité, quelle que soit sa clé (date seule, ou date + créneau). */
export type FilaCapacidad = { capacity: number; booked: number };

/**
 * Places encore prenables sur une ligne, NETTES de ce que le panier en cours occupe déjà.
 *
 * Le panier n'est pas en base : ignorer ce qu'il contient laisserait ajouter deux fois la même
 * dernière place sans le moindre avertissement visuel.
 *
 * Peut rendre un nombre NÉGATIF, et c'est voulu : `estadoDisponibilidad` ne distingue pas « zéro »
 * de « moins deux », mais un appelant qui borne à 0 masquerait une incohérence de données au lieu
 * de la laisser voir.
 */
export function plazasRestantes(fila: FilaCapacidad, enCarrito: number): number {
  return fila.capacity - fila.booked - enCarrito;
}

/**
 * Ce qu'il faut DIRE d'un nombre de places restantes — une valeur, jamais un libellé.
 *
 * La couche ne traduit rien (même frontière que `lib/catalog/`, spec 28 §0) : elle rend le
 * discriminant, la page choisit la clé next-intl et lui passe `count`. Sans ça, un module
 * `server-only` finirait par importer `useTranslations`.
 */
export type EstadoPlazas = "completo" | "ultima" | "quedan";

export function estadoDisponibilidad(restantes: number): EstadoPlazas {
  if (restantes <= 0) return "completo";
  if (restantes === 1) return "ultima";
  return "quedan";
}

/**
 * Agrège les quantités du panier par clé, pour les lignes à DATE UNIQUE (une activité, un
 * créneau) — celles que `buildInCartNightsMap` ignore justement parce qu'elles n'ont pas
 * d'`endDate`.
 *
 * ⚠️ Les deux fonctions ne sont PAS interchangeables, et c'est la raison d'être de celle-ci : une
 * ligne d'hébergement occupe toutes les nuits de [date, endDate), une ligne d'activité occupe sa
 * seule date. Les fusionner ferait compter une nuit d'hébergement comme une place d'activité, ou
 * l'inverse — silencieusement.
 *
 * `claveDe` construit la clé : la date seule pour une activité, `date|heure` pour un créneau (deux
 * créneaux d'une même date sont deux cupos indépendants).
 */
export function agregarEnCarrito(
  lineas: CartLine[],
  incluir: (linea: CartLine) => boolean,
  claveDe: (linea: CartLine) => string
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const linea of lineas) {
    if (!incluir(linea)) continue;
    const clave = claveDe(linea);
    mapa.set(clave, (mapa.get(clave) ?? 0) + linea.qty);
  }
  return mapa;
}

/**
 * Clé next-intl (namespace `ProductPage`) par état. Ce sont des IDENTIFIANTS, pas des libellés :
 * la couche ne traduit toujours rien, elle nomme. Même forme que `claveI18n` dans `pms.ts`.
 *
 * ⚠️ `spotsLeft` attend un `count` ; les deux autres l'ignorent. L'appelant le passe toujours —
 * c'est ce qui permet UN seul site d'appel au lieu du ternaire imbriqué recopié à TROIS endroits
 * (spec 30 §7a, duplication n°3).
 */
export const CLAVE_PLAZAS: Record<EstadoPlazas, "full" | "lastSpot" | "spotsLeft"> = {
  completo: "full",
  ultima: "lastSpot",
  quedan: "spotsLeft",
};
