import { leerCriterios } from "./criterios";
import type { Criterios } from "./tipos";

// Spec 28, Tranche 3 : « après un ajout au panier, le client revient à l'accueil, ses critères de
// recherche conservés » (cahier §2b.5). Or la fiche produit ne porte JAMAIS les critères dans son
// URL (spec 28 §4, décision volontaire) — il n'y a donc rien à relire au moment de rediriger.
//
// ⚠️ Ce mécanisme n'existait nulle part avant ce lot (vérifié par grep : aucun `sessionStorage`/
// `localStorage` dans `apps/web`, hors un commentaire de story disant explicitement que ce n'est
// PAS fait). C'est la seule façon de donner un sens à « conservés » depuis une fiche produit.
//
// Fichier SÉPARÉ de `criterios.ts` : celui-ci documente explicitement zéro dépendance (lisible
// depuis un Server Component comme un Client Component) — `sessionStorage` est une API navigateur,
// elle n'a rien à faire dans un module qui doit rester importable des deux côtés.
//
// Format de stockage : le même que l'URL (la sortie d'`escribirCriterios`), jamais un format
// maison à valider une seconde fois. `sessionStorage`, pas `localStorage` : un onglet ouvert par
// clic-milieu sur une fiche produit n'a pas la mémoire d'un onglet resté sur l'accueil — accepté,
// même non-décision déjà actée sur les recherches récentes (`SearchBar.stories.tsx`).
const CLAVE = "hifago:ultimosCriterios";

/**
 * Prend directement la SORTIE d'`escribirCriterios` (`"?q=kayak&personas=2"`, ou `""`), pas
 * l'objet `Criterios` — c'est délibéré : `BuscadorInicio` a déjà cette chaîne (`firmaUrl`), stable
 * d'un rendu à l'autre. Repartir de l'objet `criteriosIniciales`, reconstruit à CHAQUE rendu par
 * React Server Components, forcerait soit un effet qui se redéclenche sans rapport avec un vrai
 * changement de critères, soit une exception `react-hooks/exhaustive-deps` à faire taire — que ce
 * dépôt ne pratique nulle part (vérifié par grep : zéro `eslint-disable`).
 *
 * N'échoue jamais — Safari en navigation privée et un quota dépassé lèvent sur `setItem`.
 */
export function guardarUltimosCriterios(sufijoCriterios: string): void {
  try {
    sessionStorage.setItem(CLAVE, sufijoCriterios);
  } catch {
    // Rien à faire : le pire cas est un retour à l'accueil sans critères conservés, jamais une
    // page cassée (même philosophie que `leerCriterios` — rien n'échoue jamais).
  }
}

/** `{}` si rien n'a été mémorisé, ou si le contenu est absent/corrompu. */
export function leerUltimosCriterios(): Criterios {
  try {
    const cadena = sessionStorage.getItem(CLAVE) ?? "";
    return leerCriterios(Object.fromEntries(new URLSearchParams(cadena.replace(/^\?/, ""))));
  } catch {
    return {};
  }
}
