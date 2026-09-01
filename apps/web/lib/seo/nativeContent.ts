import { asLocalizedField } from "@hifago/domain";

/**
 * Le champ JSONB porte-t-il un contenu RÉELLEMENT saisi dans cette locale ?
 *
 * C'est le prédicat qui décide de l'indexation (hifago/CLAUDE.md §5.3 : une fiche servie en repli
 * reste `noindex` + canonical vers la langue source). Il vit ici pour être partagé par les
 * `generateMetadata` ET par le sitemap : deux copies divergeraient à la première évolution, et le
 * sitemap se mettrait à lister des URL que les métadonnées déclarent `noindex`.
 *
 * ⚠️ Plus strict que la forme d'origine (`Boolean(asLocalizedField(x)?.[locale])`), pour deux
 * raisons constatées dans le code :
 *  - `{ es: "   " }` produisait une page INDEXÉE au titre blanc ;
 *  - `asLocalizedField` est un cast SANS validation, donc un JSONB scalaire (`"Tour"` au lieu de
 *    `{"es":"Tour"}`) passait par l'indexation de chaîne. Ce cas est réellement dangereux ailleurs :
 *    `resolveLocalizedField` fait alors `Object.values("Tour")` et renvoie `"T"` comme titre de
 *    page. On ne corrige pas la cause ici (hors périmètre, cf. spec 26 §10), on refuse de l'indexer.
 */
export function hasNativeContent(field: unknown, locale: string): boolean {
  const value = asLocalizedField(field)?.[locale];
  return typeof value === "string" && value.trim().length > 0;
}
