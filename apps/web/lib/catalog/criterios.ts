// Lecture et écriture des critères de recherche dans l'URL (spec 28 §7).
//
// Partagé par l'accueil et les pages de listing : c'est le SEUL endroit qui connaît le nom des
// paramètres, leur format et leur normalisation. Aucune dépendance à Supabase ni à React — donc
// testable unitairement, sans mock.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEUX RÈGLES QUI NE SE DEVINENT PAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. ⚠️ **Aucun paramètre n'échoue jamais.** Un `?personas=abc` rend l'accueil normale, il ne rend
//    pas une 400. Une URL est saisie par des humains, recopiée de travers, et suivie par des
//    robots : transformer un lien mal collé en page cassée donne à un crawler une raison de croire
//    le site instable. Tout ce qui est invalide est IGNORÉ, comme s'il était absent.
//
// 2. ⚠️ **Un paramètre à sa valeur par défaut n'est jamais écrit.** Sinon la même recherche produit
//    plusieurs URL (`?q=kayak` et `?q=kayak&personas=`), et le canonical auto-référent de l'accueil
//    ne les rassemble plus.

import { esTipoOferta, type Criterios } from "./tipos";

/**
 * La forme que Next passe réellement à `searchParams` — PAS un `URLSearchParams`.
 * Une valeur peut être un tableau si le paramètre est répété dans l'URL ; on prend la première.
 */
export type ParamsBrutos = Record<string, string | string[] | undefined>;

const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function primero(valor: string | string[] | undefined): string | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const limpio = bruto?.trim();
  return limpio ? limpio : undefined;
}

function fechaValida(valor: string | undefined): string | undefined {
  if (!valor || !ISO_FECHA.test(valor)) return undefined;

  // `2026-02-31` passe la regex mais n'existe pas : seule une reconstruction le prouve.
  //
  // ⚠️ PAS de `.toISOString().slice(0, 10)` ici, même pour une simple validation de forme : le lint
  // du dépôt l'interdit sans exception (`no-restricted-syntax`, règle de fuseau posée le
  // 2026-08-28), et il a raison de ne pas faire de cas particulier — c'est précisément parce que
  // « ce n'est qu'une validation » que le motif se propage ensuite à des dates métier. On compare
  // donc les composantes une à une, ce qui ne construit aucune date civile.
  const [anio, mes, dia] = valor.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  const existe =
    d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  return existe ? valor : undefined;
}

export function leerCriterios(params: ParamsBrutos): Criterios {
  const criterios: Criterios = {};

  const q = primero(params.q);
  if (q) criterios.q = q;

  const tipo = primero(params.tipo);
  if (tipo && esTipoOferta(tipo)) criterios.tipo = tipo;

  const tag = primero(params.tag);
  if (tag) criterios.tag = tag;

  const personas = Number(primero(params.personas));
  if (Number.isInteger(personas) && personas >= 1) criterios.personas = personas;

  // Les deux dates vont ensemble. Une seule saisie décrit une journée (décision du 2026-09-07 :
  // « tu mets une date ou 2 ») ; une plage inversée est ignorée EN ENTIER plutôt que réparée en
  // silence — réordonner les bornes ferait chercher autre chose que ce qui est écrit dans l'URL.
  const desde = fechaValida(primero(params.desde));
  const hasta = fechaValida(primero(params.hasta));
  if (desde || hasta) {
    const inicio = desde ?? hasta!;
    const fin = hasta ?? desde!;
    if (inicio <= fin) {
      criterios.desde = inicio;
      criterios.hasta = fin;
    }
  }

  return criterios;
}

/** Rend `""` quand il n'y a aucun critère — jamais `"?"` seul, qui fabriquerait une seconde URL. */
export function escribirCriterios(criterios: Criterios): string {
  const params = new URLSearchParams();
  if (criterios.q) params.set("q", criterios.q);
  if (criterios.tipo) params.set("tipo", criterios.tipo);
  if (criterios.tag) params.set("tag", criterios.tag);
  if (criterios.personas && criterios.personas >= 1) params.set("personas", String(criterios.personas));
  if (criterios.desde && criterios.hasta) {
    params.set("desde", criterios.desde);
    params.set("hasta", criterios.hasta);
  }
  const cadena = params.toString();
  return cadena ? `?${cadena}` : "";
}

/**
 * Combien d'offres une page de listing sert d'un coup (spec 29 §7b).
 *
 * 24 est un multiple de 1, 2 et 3 — les trois largeurs de la grille (`grid-cols-1`, `md:2`,
 * `lg:3`) : aucune rangée n'est laissée incomplète en bas de page, quel que soit l'écran.
 */
export const TAMANO_PAGINA = 24;

/**
 * Le plafond dur de `?pagina` (spec 29 §0).
 *
 * ⚠️ **Ce n'est pas un réglage d'affichage, c'est une protection.** Ces pages sont publiques et
 * anonymes, et `pagina` est multiplié par `TAMANO_PAGINA` pour construire la limite SQL : sans
 * plafond, `?pagina=99999` fait demander 2,4 millions de lignes à Postgres depuis une simple URL,
 * autant de fois qu'on la recharge. 20 pages = 480 offres, très au-delà de ce qu'un visiteur
 * atteint en défilant.
 */
export const MAX_PAGINAS = 20;

/**
 * Combien de pages sont déjà chargées, lu depuis l'URL.
 *
 * ⚠️ **`pagina` n'est PAS un critère**, et ne rejoint jamais `Criterios` : il décrit où en est le
 * DÉFILEMENT, pas ce qu'on cherche. L'y mettre le ferait écrire par `escribirCriterios` dans les
 * liens « Ver más » de l'accueil et dans le canonical — deux endroits où il n'a rien à faire.
 *
 * Même règle que tous les paramètres de ce dépôt : rien n'échoue jamais. Une valeur illisible,
 * nulle, négative ou au-delà du plafond retombe sur 1 — jamais une erreur, jamais une page vide.
 */
export function leerPagina(params: ParamsBrutos): number {
  const bruto = Number(primero(params.pagina));
  if (!Number.isInteger(bruto) || bruto < 1 || bruto > MAX_PAGINAS) return 1;
  return bruto;
}

/**
 * Vrai si au moins un filtre est actif — les listings et l'index de catégories s'en servent pour
 * choisir LEQUEL de leurs deux états vides afficher (« ta recherche ne donne rien » vs « cette
 * section est encore vide »).
 *
 * ⚠️ Pas l'accueil, contrairement à ce que ce commentaire a dit jusqu'au 2026-09-09 : c'est le seul
 * écran qui ne l'appelle pas. Il n'a qu'un état vide, puisqu'on n'y arrive jamais sans chercher.
 */
export function hayCriterios(criterios: Criterios): boolean {
  return Object.keys(criterios).length > 0;
}

/**
 * Vrai si l'accueil est atteinte juste après un ajout au panier (spec 28 Tranche 3).
 *
 * ⚠️ `desdeCarrito` n'est PAS un critère, et ne rejoint jamais `Criterios` — même raison que
 * `pagina` ci-dessus : ce n'est pas ce qu'on cherche, c'est d'où on vient. L'y mettre le ferait
 * écrire par `escribirCriterios` dans les liens « Ver más » et le canonical.
 *
 * Rien n'échoue jamais : une valeur absente ou différente de `"1"` répond simplement non.
 */
export function leerDesdeCarrito(params: ParamsBrutos): boolean {
  return primero(params.desdeCarrito) === "1";
}

/**
 * Le lien que `useAddToCart` construit pour revenir à l'accueil : les critères conservés, plus le
 * flag qui déclenche le réordonnancement selon le panier (`page.tsx`, `buscarSecciones`).
 *
 * Un seul endroit définit le nom du paramètre — le lecteur (`leerDesdeCarrito`) et l'écrivain sont
 * dans ce même fichier, jamais une chaîne recopiée à la main d'un côté ou de l'autre.
 */
export function hrefRetornoCarrito(criterios: Criterios): string {
  const sufijo = escribirCriterios(criterios);
  return `/${sufijo}${sufijo ? "&" : "?"}desdeCarrito=1`;
}

/**
 * Le lien vers l'écran d'hébergement pour un camp — dates et nombre de personnes déjà en filtre.
 * `BuscadorInicio` (déjà câblé sur `/alojamientos` via `IndiceCategoriasConOfertas`) les pré-remplit
 * depuis `criteriosIniciales` : aucun composant neuf n'est nécessaire pour que le visiteur les
 * voie déjà posés. Trois appelants (2026-09-15) : `ReservationForm.tsx` juste après l'ajout du camp
 * au panier, le bandeau contextuel de `/alojamientos` lui-même (« pourquoi je suis ici »), et le
 * bloc « hébergement obligatoire » de `/mi-viaje` (bouton « Elige tu alojamiento », qui bloque au
 * moment de payer) — même lien, même calcul de dates/personas, jamais deux formules.
 *
 * `alojamientoParaCamp=1` — même traitement que `desdeCarrito` : pas un critère (ne rejoint jamais
 * `Criterios`, jamais écrit dans un canonical/Ver más), seulement « pourquoi on est arrivé ici ».
 * Retour Jérôme (2026-09-15) : un visiteur qui atterrit sur `/alojamientos` juste après avoir
 * choisi un camp n'a sinon aucune indication de pourquoi il y est — `IndiceCategoriasConOfertas`
 * affiche un bandeau contextuel quand ce drapeau est présent. Complémentaire, pas un remplacement,
 * du bloc de `/mi-viaje` : celui-ci guide dès l'arrivée, celui-là bloque au moment de payer.
 */
export function hrefAlojamientosCompatibles(
  criterios: Pick<Criterios, "desde" | "hasta" | "personas">
): string {
  const sufijo = escribirCriterios(criterios);
  return `/alojamientos${sufijo}${sufijo ? "&" : "?"}alojamientoParaCamp=1`;
}

/**
 * Vrai si l'écran d'hébergement est atteint juste après l'ajout d'un camp au panier — même
 * raisonnement que `leerDesdeCarrito` (le paramètre décrit d'où on vient, jamais un critère).
 */
export function leerAlojamientoParaCamp(params: ParamsBrutos): boolean {
  return primero(params.alojamientoParaCamp) === "1";
}
