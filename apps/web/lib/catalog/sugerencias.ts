import { createPublicClient } from "@/lib/supabase/publicClient";
import { identidadDeFila, type FilaCatalogo } from "./buscar";
import { ORDEN_SECCIONES, esTipoOferta, type SugerenciaCatalogo } from "./tipos";

// Les suggestions de la barre de recherche de l'accueil (2026-09-08, Tranche 2 du lot D —
// docs/specs/28-vitrine-accueil-et-resultats.md §2). `SearchBar` « ne cherche rien, il reçoit » :
// voici ce qu'il reçoit, et l'unique endroit où cette liste se fabrique.
//
// ⚠️ Même couche, mêmes règles que `buscar.ts`, et notamment la même RPC — `search_catalog`. Une
// suggestion n'est PAS une autre recherche : c'est la même, avec un petit plafond et sans plafond
// par section. Ouvrir une seconde requête (un `ilike` sur `products`, par exemple) redéfinirait en
// silence le prédicat de visibilité, l'ordre et le regroupement des établissements — la barre
// proposerait alors des offres que la page de résultats ne montre pas.
//
// ⚠️ AUCUNE TRADUCTION ICI. On rend le TYPE de l'offre et le NOM de son établissement, jamais la
// phrase « Actividad · Casa Kayam » : composer un libellé est le travail du composant client, qui
// a le traducteur. Même arbitrage que pour le texte alternatif des photos (spec 28 §6, en tête de
// `buscar.ts`) — l'y mettre coupleraient `lib/catalog/` à next-intl.
//
// ⚠️ Ce module est réservé au serveur SANS que rien ne le force — `server-only` n'est toujours pas
// installé dans ce dépôt (vérifié le 2026-09-08, `require.resolve` échoue). L'en-tête de
// `buscar.ts` porte le détail et la décision d'une ligne à prendre ; ajouter la ligne d'import
// sans le paquet casserait le build. La frontière tient ici par le fait qu'un seul appelant existe
// et que c'est un Route Handler : `app/api/catalogo/sugerencias/route.ts`.

/**
 * En dessous de deux caractères, la base n'est pas interrogée du tout.
 *
 * ⚠️ Ce seuil est écrit DEUX fois, et c'est voulu : `BuscadorInicio` le tient aussi côté client
 * (avec son anti-rebond) pour ne pas émettre la requête HTTP, celui-ci est le garde-fou serveur.
 * La route est publique et n'a aucune raison de croire son appelant — une lettre unique renverrait
 * le catalogue entier trié par pertinence, une fois par frappe.
 */
const MINIMO_CARACTERES = 2;

/**
 * Combien de lignes demander à la base pour en garder `limite`.
 *
 * ⚠️ CE FACTEUR N'EST PAS UNE MARGE DE CONFORT, il répare un défaut mesuré le 2026-09-08 par la
 * revue du lot. `search_catalog` finit par `order by c.tipo, c.rango_seccion` — un ordre pensé pour
 * l'ACCUEIL, qui range ses cinq sections. `products.type` est du texte, donc l'ordre est
 * alphabétique : activity < camp < evento < lodging < transport. Demander six lignes à cette
 * requête, c'est donc demander « les six premières ACTIVITÉS », jamais « les six meilleures
 * correspondances ».
 *
 * Reproduit contre le Postgres local : taper « Casa Kayam » proposait bien l'hôtel ; en ajoutant
 * cinq activités au même établissement, le même appel rendait six lignes `activity` et **la carte
 * de l'hôtel avait disparu**. Le prédicat texte couvre le nom de l'établissement, donc son nom fait
 * correspondre TOUS ses produits — et sa propre carte, de type `lodging`, est servie en dernier.
 *
 * Autant de fois la réserve qu'il y a de sections : c'est le seul facteur qui garantit d'atteindre
 * la dernière section quelle que soit la répartition. L'accueil applique déjà exactement ce facteur
 * (`porSeccion * ORDEN_SECCIONES.length`, `buscar.ts`) pour la même raison.
 *
 * ⚠️ DÉRIVÉ, jamais écrit en dur : c'était `5`, sous un commentaire qui disait déjà « cinq sections,
 * donc cinq fois la réserve » — la règle était donc écrite, mais seul `buscar.ts` la suivait. Un
 * sixième type d'offre aurait élargi la recherche de l'accueil et laissé les suggestions trop
 * courtes, en silence : aucun test de ce module n'aurait rougi, il aurait fallu que la dernière
 * section soit justement celle qu'on cherchait.
 */
const RESERVA_POR_SECCION = ORDEN_SECCIONES.length;

/**
 * Les suggestions à proposer pour un texte en cours de frappe, **classées par pertinence**.
 *
 * ⚠️ Pas de `p_por_tipo` : on veut les meilleures correspondances, tous types confondus. Le plafond
 * par section est un besoin de l'accueil (cinq rangées à remplir), pas d'une liste de six lignes —
 * l'y poser rendrait « huit par type » et noierait la correspondance exacte sous les autres.
 */
export async function buscarSugerencias(
  q: string,
  { locale, limite = 6 }: { locale: string; limite?: number }
): Promise<SugerenciaCatalogo[]> {
  const texto = q.trim();
  if (texto.length < MINIMO_CARACTERES) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("search_catalog", {
    p_query: texto,
    p_limite: limite * RESERVA_POR_SECCION,
  });

  // Échec franc, comme `buscarSecciones` : un tableau vide se lit « aucun résultat », donc rendre
  // ça sur une panne ferait dire à la barre qu'il n'y a rien à vendre (CLAUDE.md §4.4).
  if (error) throw error;

  return ((data ?? []) as FilaCatalogo[])
    .map((fila) => enSugerencia(fila, locale))
    .filter((s): s is SugerenciaCatalogo => s !== null)
    .sort(porPertinencia(texto))
    .slice(0, limite);
}

/**
 * L'ordre d'une liste de suggestions, qui n'est PAS celui d'une page de résultats.
 *
 * Trois critères, du plus fort au plus faible :
 *  1. le nom COMMENCE par ce qui est tapé — c'est ce que cherche quelqu'un qui tape un nom ;
 *  2. à égalité, un ÉTABLISSEMENT passe devant ses propres offres : taper « Casa Kayam » doit
 *     proposer Casa Kayam, pas sa troisième activité ;
 *  3. à égalité encore, l'ordre rendu par la base est conservé (`sort` est stable en JS depuis
 *     ES2019, donc `0` préserve vraiment la position d'origine — ce n'est pas une supposition).
 *
 * ⚠️ Comparaison insensible à la casse ET aux accents (`localeCompare` ne le fait pas ; la
 * normalisation Unicode si) : la base, elle, cherche déjà en `unaccent`, et un classement plus
 * strict que le filtre remonterait « Guatapé » derrière une correspondance moins bonne quand on
 * tape « guatape ».
 */
function porPertinencia(texto: string) {
  const buscado = normalizar(texto);
  return (a: SugerenciaCatalogo, b: SugerenciaCatalogo) => {
    const prefijoA = normalizar(a.nombre).startsWith(buscado) ? 0 : 1;
    const prefijoB = normalizar(b.nombre).startsWith(buscado) ? 0 : 1;
    if (prefijoA !== prefijoB) return prefijoA - prefijoB;
    if (a.esEstablecimiento !== b.esEstablecimiento) return a.esEstablecimiento ? -1 : 1;
    return 0;
  };
}

function normalizar(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function enSugerencia(fila: FilaCatalogo, locale: string): SugerenciaCatalogo | null {
  if (!esTipoOferta(fila.tipo)) return null; // un type inconnu ne casse pas la barre, il disparaît

  // `clave` devient l'`id` de la suggestion : la même offre porte la même identité qu'en carte,
  // ce qui rend les deux comparables sans table de correspondance.
  const { clave, href, nombre, establecimiento } = identidadDeFila(fila, locale);
  return {
    id: clave,
    nombre,
    tipo: fila.tipo,
    esEstablecimiento: fila.es_establecimiento,
    establecimiento,
    href,
  };
}
