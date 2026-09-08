// Les types partagés de la couche d'accès au catalogue (spec 27 §0, spec 28 §0).
//
// Ce fichier ne dépend de RIEN : ni de Supabase, ni de next-intl, ni de React. C'est ce qui permet
// de le lire depuis un Server Component comme depuis un composant client sans traîner un graphe de
// modules derrière — et notamment sans faire entrer le barrel `@hifago/ui` dans le graphe d'un
// `page.tsx` (CLAUDE.md §11.16).

/** Les cinq types d'offre, dans l'ORDRE d'affichage par défaut de l'accueil (cahier §2a). */
export const ORDEN_SECCIONES = ["activity", "lodging", "transport", "camp", "evento"] as const;

export type TipoOferta = (typeof ORDEN_SECCIONES)[number];

export function esTipoOferta(valor: string): valor is TipoOferta {
  return (ORDEN_SECCIONES as readonly string[]).includes(valor);
}

/**
 * Les critères de recherche, tels qu'ils vivent dans l'URL des pages à résultats.
 *
 * Un champ absent = pas de filtre. Jamais de valeur sentinelle ("todos", -1, "") : l'absence est
 * la seule façon de dire « pas de filtre », sinon deux URL différentes décrivent la même recherche
 * et le canonical ne les rassemble plus.
 */
export type Criterios = {
  q?: string;
  tipo?: TipoOferta;
  tag?: string;
  personas?: number;
  /** ISO `YYYY-MM-DD`. Toujours posés ensemble : une seule date saisie devient desde = hasta. */
  desde?: string;
  hasta?: string;
};

export type FotoTarjeta = {
  /** URL publique déjà résolue depuis le `storage_path` — un composant ne parle jamais à Storage. */
  url: string;
};

/**
 * Le prix d'une carte. Quatre formes, parce que le catalogue en porte réellement quatre :
 *  - `monto`  : un prix chiffré (`products.price_cop`) ;
 *  - `desde`  : le minimum des couchages d'un établissement groupé ;
 *  - `texto`  : `products.price_label`, le prix libre d'une offre en vitrine (spec 27 §6) ;
 *  - `null`   : ni l'un ni l'autre — la carte n'affiche AUCUN prix, jamais « desde 0 ».
 */
export type PrecioTarjeta =
  | { tipo: "monto"; cop: number }
  | { tipo: "desde"; cop: number }
  | { tipo: "texto"; label: string }
  | null;

export type TarjetaOferta = {
  clave: string;
  href: string;
  nombre: string;
  establecimiento: string | null;
  precio: PrecioTarjeta;
  fotos: FotoTarjeta[];
  tipo: TipoOferta;
  testId: string;
};

export type Seccion = {
  tipo: TipoOferta;
  tarjetas: TarjetaOferta[];
  /** Nombre d'offres du type AVANT plafonnement — c'est lui qui donne son chiffre au « Ver más ». */
  total: number;
};
