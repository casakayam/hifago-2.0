import { createPublicClient } from "@/lib/supabase/publicClient";
import { identidadDeFila, type FilaCatalogo } from "./buscar";
import { esTipoOferta, type SugerenciaCatalogo } from "./tipos";

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
 * Les suggestions à proposer pour un texte en cours de frappe.
 *
 * ⚠️ Pas de `p_por_tipo` : on veut les MEILLEURES correspondances, tous types confondus. Le plafond
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
    p_limite: limite,
  });

  // Échec franc, comme `buscarSecciones` : un tableau vide se lit « aucun résultat », donc rendre
  // ça sur une panne ferait dire à la barre qu'il n'y a rien à vendre (CLAUDE.md §4.4).
  if (error) throw error;

  return ((data ?? []) as FilaCatalogo[])
    .map((fila) => enSugerencia(fila, locale))
    .filter((s): s is SugerenciaCatalogo => s !== null);
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
