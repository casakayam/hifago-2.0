export type BreadcrumbItem = { name: string; path: string };

/**
 * Fil d'Ariane structuré : il indique aux moteurs la place d'une page dans le site, et remplace
 * l'URL nue par un chemin lisible dans les résultats de recherche.
 *
 * Les `path` sont des chemins relatifs au site (`/es/products/tour`), transformés ici en URL
 * absolues — schema.org exige une URL complète pour `item`.
 */
export function buildBreadcrumbJsonLd(
  siteUrl: string,
  items: BreadcrumbItem[]
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.path}`,
    })),
  };
}
