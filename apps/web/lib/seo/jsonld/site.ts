/**
 * Nœud d'identité du site, posé sur l'accueil.
 *
 * C'est le nœud le plus rentable pour l'objectif « être cité par un moteur de réponse » : il
 * nomme l'entité, et il n'exige aucune colonne de base de données.
 *
 * ⚠️ Pas d'`Organization` ni de `logo` tant qu'aucun asset de marque n'existe : `public/` ne
 * contient que les SVG du starter Next et `app/favicon.ico` est celui de `create-next-app`.
 * Un `logo` pointant vers une icône générique serait une donnée fausse.
 *
 * ⚠️ Pas de `potentialAction`/`SearchAction` : la recherche du catalogue est un filtre en mémoire
 * côté client (CatalogBrowser.tsx), sans URL de résultats adressable. Déclarer une cible de
 * recherche qui ne répond pas serait une promesse creuse.
 */
export function buildWebSiteJsonLd(siteUrl: string, locale: string, name: string, description?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    ...(description ? { description } : {}),
    url: `${siteUrl}/${locale}`,
    inLanguage: locale,
  };
}
