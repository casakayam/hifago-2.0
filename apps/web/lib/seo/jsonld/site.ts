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
 * ⚠️ Pas de `potentialAction`/`SearchAction` — et depuis le 2026-09-08 la RAISON D'ORIGINE N'EST
 * PLUS VRAIE. Elle disait : « la recherche du catalogue est un filtre en mémoire côté client
 * (`CatalogBrowser.tsx`), sans URL de résultats adressable ». `CatalogBrowser` est supprimé
 * (spec 28), et les critères vivent maintenant DANS l'URL de l'accueil (`?q=`, cf.
 * `escribirCriterios`) : la cible existe désormais, et elle répond.
 *
 * Ce nœud reste donc sans `SearchAction` par simple NON-DÉCISION, pas par choix motivé. L'ajouter
 * est une décision de référencement à prendre pour elle-même — pas un effet de bord d'un lot de
 * nettoyage. Portée au backlog le 2026-09-08.
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
