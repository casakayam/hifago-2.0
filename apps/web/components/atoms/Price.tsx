// Un montant en pesos colombiens, rendu partout de la même façon.
//
// Créé le 2026-09-01 (vague 1 des atomes, lot « données affichées »). Il n'invente AUCUN
// formatage : `formatCop` de @hifago/domain est déjà l'unique point de vérité du projet (mémoïsé
// par locale, 0 décimale, 41 appels côté admin et 3 côté web) et reste seul à décider de la forme
// du montant. Cet atome ne fait que lui donner un support de rendu commun, pour que trois écrans
// n'écrivent pas trois `<span>` différents autour du même appel.
//
// ⚠️ Volontairement nu : ni libellé, ni suffixe « / nuit », ni prix barré. Ces compositions
// appartiennent à `PriceBlock` (molecule, vague 2).
// ⚠️ Il ne connaît pas le cas `evento` : un evento porte un `price_label` en TEXTE LIBRE, affiché
// tel quel et jamais formaté en COP (règle métier, cahier des charges admin §3c). L'aiguillage
// vit déjà dans `app/[locale]/products/[slug]/page.tsx` — lui ajouter ici une branche texte libre
// ferait entrer une décision métier dans un atome de présentation.
import { formatCop } from "@hifago/domain";
import type { Locale } from "@/messages";

export type PriceProps = {
  amountCop: number;
  /**
   * Le formatage monétaire dépend de la langue, pas l'atome.
   * ⚠️ Typé `Locale` (exporté par `@/messages`, dérivé de `routing.locales`) et non `string` :
   * `<Price locale={product.slug} />` compilait sans broncher et `Intl` rendait silencieusement
   * n'importe quoi. Même parti pris que `alt`/`sizes` d'`Image` — la contrainte est portée par le
   * type, pas par un commentaire. Une troisième locale ajoutée à `i18n/routing.ts` l'élargira
   * toute seule.
   */
  locale: Locale;
  testId?: string;
};

export function Price({ amountCop, locale, testId }: PriceProps) {
  // `tabular-nums` : les montants s'empilent en colonne (cartes de catalogue, récapitulatif de
  // commande) et des chiffres de largeurs inégales les font danser d'une ligne à l'autre. Seule
  // classe posée par cet atome — la taille et la graisse restent au composant qui l'accueille.
  return (
    <span className="tabular-nums" data-testid={testId}>
      {formatCop(amountCop, locale)}
    </span>
  );
}
