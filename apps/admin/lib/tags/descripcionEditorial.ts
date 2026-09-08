/**
 * Nettoie le texte éditorial d'une catégorie avant de l'écrire (spec 29 Tranche 3).
 *
 * ⚠️ CE N'EST PAS DE LA COSMÉTIQUE, c'est ce qui décide de l'INDEXATION côté vitrine. Le prédicat
 * `hasNativeContent` d'`apps/web` — le même qui sert au sitemap et aux fiches — considère qu'une
 * locale a du contenu natif dès que la chaîne est non blanche. Écrire `{ es: "", en: "  " }`
 * déclarerait donc la page de catégorie comme traduite dans les deux langues, et Google indexerait
 * deux URL au texte vide (règle SEO 2 du dépôt).
 *
 * Trois règles, dans cet ordre :
 *   1. une langue dont la valeur est vide ou blanche est RETIRÉE — pas conservée à `""` ;
 *   2. les valeurs restantes sont ébarbées (un espace final ne fait pas une traduction) ;
 *   3. si plus rien ne reste, on rend `null` — jamais `{}`, qui vaudrait « objet présent mais
 *      vide » en base et compliquerait toute lecture ultérieure pour rien.
 */
export function limpiarDescripcion(
  valeur: Record<string, string>
): Record<string, string> | null {
  const limpio: Record<string, string> = {};
  for (const [lang, texto] of Object.entries(valeur)) {
    const recortado = texto.trim();
    if (recortado.length > 0) limpio[lang] = recortado;
  }
  return Object.keys(limpio).length > 0 ? limpio : null;
}
