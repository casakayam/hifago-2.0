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

/** Une suggestion de la barre de recherche, en DONNÉES : aucun libellé traduit ici. */
export type SugerenciaCatalogo = {
  /** Stable et unique dans la liste — reprend la `clave` d'une carte. */
  id: string;
  /** Déjà résolu dans la locale demandée. */
  nombre: string;
  tipo: TipoOferta;
  esEstablecimiento: boolean;
  /** Nom de l'établissement porteur, `null` pour une carte d'établissement. */
  establecimiento: string | null;
  /** Chemin SANS préfixe de langue : `/productos/<slug>` ou `/establecimientos/<slug>`. */
  href: string;
};

/**
 * Une CATÉGORIE de l'index `/es/actividades` (spec 29 §0).
 *
 * ⚠️ Le mot « catégorie » et non « tag » est délibéré : depuis la décision de Jérôme du 2026-09-08,
 * une ligne de `catalog_tags` porte une image, un nom et un texte — c'est une entité éditoriale que
 * le visiteur voit, plus une étiquette technique.
 *
 * Comme `TarjetaOferta`, tout est DÉJÀ RÉSOLU ici : le nom et le texte dans la locale demandée,
 * l'URL de l'image depuis son `storage_path`. Un composant ne parle jamais à Storage et ne résout
 * jamais un champ JSONB.
 */
export type CategoriaConOferta = {
  /** `kayak` — ou `otras` pour la tuile qui rattrape ce qu'aucune catégorie ne classe. */
  slug: string;
  /** Chemin SANS préfixe de langue : `/actividades/kayak`. */
  href: string;
  /**
   * ⚠️ VIDE quand `esSinTag` est vrai. « Otras actividades » n'est pas une ligne de la base : son
   * nom et son texte viennent des messages next-intl, donc de la page. Cette couche ne traduit
   * rien — même règle que le texte alternatif des photos et que les libellés de suggestion.
   */
  nombre: string;
  /** Déjà résolu, `null` si la catégorie n'a pas encore été rédigée. */
  descripcion: string | null;
  /** URL publique déjà résolue, `null` → la tuile rend un aplat. */
  foto: FotoTarjeta | null;
  /** Vrai pour LA seule tuile « Otras actividades », toujours rendue en dernier. */
  esSinTag: boolean;
  /**
   * Les locales où le NOM est réellement saisi — pas obtenu par repli.
   *
   * ⚠️ C'est une donnée d'INDEXATION, pas d'affichage : une page de catégorie servie en repli
   * (nom espagnol sous une URL `/en/`) doit rester `noindex` avec un canonical vers la langue
   * source (règle SEO 2). Elle est calculée dans la couche parce que c'est elle qui tient le champ
   * JSONB brut — le résoudre puis tenter de deviner s'il vient d'un repli serait impossible.
   */
  localesNativas: string[];
  testId: string;
};
