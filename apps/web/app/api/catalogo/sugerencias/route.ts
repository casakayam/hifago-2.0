import { hasLocale } from "next-intl";
import { buscarSugerencias } from "@/lib/catalog/sugerencias";
import { routing } from "@/i18n/routing";

// Le pont entre la barre de recherche et le catalogue (2026-09-08, Tranche 2 du lot D —
// docs/specs/28-vitrine-accueil-et-resultats.md §2).
//
// ⚠️ POURQUOI CE FICHIER EXISTE. Le champ de recherche vit dans le NAVIGATEUR (`BuscadorInicio`,
// composant client) et `lib/catalog/` est réservé au serveur : un composant client qui importerait
// la couche embarquerait le graphe Supabase dans son bundle. Un Route Handler est le seul pont
// possible — et le seul appelant de `buscarSugerencias`.
//
// ⚠️ AUCUNE AUTHENTIFICATION, ET C'EST CORRECT. Cette route n'expose rien de plus que l'accueil
// lui-même : même RPC `search_catalog` (`security invoker`), même client ANONYME sans cookies,
// donc mêmes policies `_select_public` — un produit non `sellable` ou un établissement non
// `active` reste invisible ici comme ailleurs. Y ajouter une garde de session ne protégerait rien
// et rendrait la recherche impossible à un visiteur, qui est précisément le public visé.
// (Précédent identique : `app/api/pms/night-availability/route.ts`, GET public assumé.)
//
// ⚠️ `force-dynamic` : la réponse dépend de la requête (`q`, `locale`) ET du catalogue, qui bouge
// dès qu'un socio publie une offre. Une réponse mise en cache au build serait fausse deux fois —
// figée sur un texte et sur un état du catalogue.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";

  // ⚠️ AUCUN PARAMÈTRE N'ÉCHOUE JAMAIS — même règle que les critères d'URL de l'accueil
  // (`lib/catalog/criterios.ts`). Une locale absente, mal orthographiée ou inconnue retombe sur
  // l'espagnol : rendre 400 ferait disparaître les suggestions d'un visiteur pour une faute que
  // lui n'a pas commise, et la seule conséquence du repli est un nom résolu dans l'autre langue.
  const solicitada = url.searchParams.get("locale");
  const locale = hasLocale(routing.locales, solicitada) ? solicitada : routing.defaultLocale;

  try {
    // `q` trop court (ou vide) rend `[]` sans interroger la base : le seuil vit dans la couche, pas
    // ici — la route ne redécide rien de ce que la couche sait déjà.
    const sugerencias = await buscarSugerencias(q, { locale });
    return Response.json({ sugerencias });
  } catch (error) {
    // ⚠️ Le message Postgres ne sort JAMAIS d'ici : il nomme des tables, des colonnes et parfois la
    // valeur qui a fait échouer la requête. Le serveur le journalise, le client reçoit un motif
    // stable — même patron que `payments/create` (`mercadopago_unavailable`).
    console.error(`GET /api/catalogo/sugerencias a échoué (q="${q}", locale=${locale})`, error);
    // ⚠️ PAS de `sugerencias: []` dans ce corps, et c'est le point : un tableau vide se lirait
    // « aucun résultat » et la panne s'afficherait comme un catalogue vide. Une réponse d'échec
    // n'a pas la forme d'une réponse de succès.
    return Response.json({ ok: false, reason: "catalogo_no_disponible" }, { status: 500 });
  }
}
