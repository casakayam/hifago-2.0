import { hasLocale } from "next-intl";
import { buscarTipo } from "@/lib/catalog/buscar";
import { TAMANO_PAGINA, leerCriterios, leerPagina } from "@/lib/catalog/criterios";
import { esTipoOferta } from "@/lib/catalog/tipos";
import { routing } from "@/i18n/routing";

// Le pont du défilement infini (2026-09-08, spec 29 §7c).
//
// ⚠️ POURQUOI CE FICHIER EXISTE, et pourquoi il ne pouvait pas être évité. `ListadoInfinito` vit
// dans le NAVIGATEUR (il observe le défilement, il tient l'état de la liste) et `lib/catalog/` est
// réservé au serveur : un composant client qui importerait la couche embarquerait le graphe
// Supabase et la clé anonyme dans son bundle. Un Route Handler est le seul chemin — exactement le
// raisonnement du pont des suggestions (spec 28 §10ter), et le second usage du même motif.
//
// ⚠️ AUCUNE AUTHENTIFICATION, ET C'EST CORRECT. Cette route n'expose rien de plus que la page de
// listing qu'elle prolonge : même fonction `buscarTipo`, même RPC `search_catalog`
// (`security invoker`), même client ANONYME sans cookies, donc mêmes policies `_select_public`.
// Un produit non `sellable` ou un établissement non `active` reste invisible ici comme ailleurs.
//
// ⚠️ ASYMÉTRIE AVEC LA PAGE, ET ELLE EST VOULUE. La page rend `pagina × TAMANO_PAGINA` offres d'un
// coup (ouvrir `?pagina=3` doit rendre les trois pages, sinon la liste commence au milieu de rien) ;
// cette route rend UNE tranche — celle qu'on ajoute en bas. Même fonction, bornes différentes.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const brutos = Object.fromEntries(url.searchParams);

  // Le type vient du SEGMENT d'URL de la page appelante, pas d'un critère de recherche : c'est lui
  // qui définit la page. Un type absent ou inconnu est la seule erreur possible ici — la requête ne
  // décrit alors aucune page existante, et rendre « toutes les offres » serait pire que refuser.
  const tipo = url.searchParams.get("tipo");
  if (!tipo || !esTipoOferta(tipo)) {
    return Response.json({ ok: false, reason: "tipo_desconocido" }, { status: 400 });
  }

  // Tout le reste suit la règle du dépôt : aucun paramètre n'échoue jamais. `leerCriterios` ignore
  // ce qui est invalide, `leerPagina` ramène à 1 hors bornes, et une locale inconnue retombe sur
  // l'espagnol — rendre 400 ferait disparaître la suite d'une liste pour une faute que le visiteur
  // n'a pas commise.
  const criterios = leerCriterios(brutos);
  const solicitada = url.searchParams.get("locale");
  const locale = hasLocale(routing.locales, solicitada) ? solicitada : routing.defaultLocale;

  // ⚠️ LE PLAFOND EST REPOSÉ ICI, et ce n'est pas une redondance : cette route est appelable
  // directement, sans passer par la page. Sans `leerPagina`, `?pagina=99999` contournerait la
  // protection en une requête — le plafond ne vaut que s'il est posé à CHAQUE porte d'entrée.
  const pagina = leerPagina(brutos);
  const sinTag = url.searchParams.get("sinTag") === "1";

  try {
    const { tarjetas, hayMas } = await buscarTipo(tipo, criterios, {
      limite: TAMANO_PAGINA,
      desplazamiento: (pagina - 1) * TAMANO_PAGINA,
      locale,
      sinTag,
    });
    return Response.json({ tarjetas, hayMas });
  } catch (error) {
    // ⚠️ Le message Postgres ne sort JAMAIS d'ici : il nomme des tables, des colonnes et parfois la
    // valeur qui a fait échouer la requête. Le serveur le journalise, le client reçoit un motif
    // stable.
    console.error(`GET /api/catalogo/listado a échoué (tipo=${tipo}, pagina=${pagina})`, error);
    // ⚠️ PAS de `tarjetas: []` dans ce corps. Un tableau vide se lirait « il n'y a plus rien » et la
    // panne s'afficherait comme une fin de liste : le visiteur croirait avoir tout vu. Une réponse
    // d'échec n'a jamais la forme d'une réponse de succès — et c'est ce qui permet à
    // `ListadoInfinito` de distinguer les deux et de proposer « Reintentar ».
    return Response.json({ ok: false, reason: "catalogo_no_disponible" }, { status: 500 });
  }
}
