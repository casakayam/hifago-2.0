"use client";

import { Chip } from "@hifago/ui";

// Le type d'un produit, lisible sur une carte de catalogue ou une fiche.
//
// Créé le 2026-09-01 (vague 1 des atomes, lot « données affichées »). C'est le seul atome du lot
// qui n'extrait rien d'existant : aujourd'hui `products.type` ne sert QU'À FILTRER le catalogue
// (CatalogBrowser.tsx), il ne s'affiche nulle part. Rien à déplacer, donc — il se crée.
//
// ⚠️ `"use client"` est obligatoire, pas décoratif : CLAUDE.md §11.16 — tout import depuis le
// barrel `@hifago/ui` tire l'ensemble de son graphe de modules et fait planter `next build`
// (« Collecting page data ») dès qu'il atteint un Server Component. C'est le même garde-fou que
// CatalogBrowser.tsx et les dix autres consommateurs de @hifago/ui d'apps/web.
export type TypeBadgeProps = {
  /**
   * Volontairement `string` et non une union — voir la note sur `STYLES_PAR_TYPE` ci-dessous.
   */
  type: string;
  /** Déjà traduit — un atome ne traduit rien. */
  label: string;
  testId?: string;
};

type StyleBadge = {
  color: "accent" | "success" | "warning" | "default";
  variant: "soft" | "secondary" | "primary";
};

// Les cinq types réels de `products.type`, relevés dans CatalogBrowser.tsx:27 (eux-mêmes tirés du
// CHECK de supabase/migrations/20260817160000_calendar_tranche0_fixes.sql).
//
// ⚠️ Table LOCALE et `type: string` : cette union existe DÉJÀ deux fois dans le dépôt
// (apps/admin/lib/products/productTypeGating.ts:24 et la const PRODUCT_TYPES de
// CatalogBrowser.tsx). En écrire une troisième aggraverait le problème ; la remonter dans
// @hifago/domain est peut-être la bonne réponse, mais c'est une décision d'architecture
// (CLAUDE.md §2.1 : un module ne monte dans packages/ que si sa double consommation est prouvée)
// réservée au coordinateur. Un type ajouté en base ne doit jamais faire planter une page
// publique : tout ce qui n'est pas listé ici retombe sur STYLE_INCONNU.
//
// ⚠️ La couleur est DÉCORATIVE, elle ne porte jamais l'information seule (README, accessibilité) :
// le libellé est toujours rendu en toutes lettres. Le regroupement de teintes est donc modifiable
// sans risque fonctionnel — accent = où l'on dort, success = ce que l'on fait, warning = ce qui a
// une heure.
//
// Les couples couleur/variante ont été MESURÉS, pas choisis à l'œil, sur les jetons par défaut de
// HeroUI (= ceux du thème `vitrine`, qui n'en définit aucun). Contraste WCAG du texte, sur carte
// blanche (--surface) et sur fond de page (--background) :
//   accent/soft 5.08 – 4.70 · accent/secondary 5.12 · success/secondary 4.60 ·
//   warning/soft 5.14 – 4.76 · warning/primary 8.68 · default/soft 16.25 – 15.55
// Tous ≥ 4.5:1, et axe (le moteur du panneau a11y de Storybook) ne remonte aucune violation sur
// les quatre stories, dans les deux thèmes et les deux gabarits.
//
// Trois combinaisons ont été écartées à la mesure, pas par goût : `success/soft` (4.47 sur
// --background, sous le seuil), `accent/primary` et `danger/primary` (3.59 et 3.48 — un aplat
// plein saturé porte mal son texte). ⚠️ `warning/secondary` a été essayé puis retiré : correct en
// vitrine (4.79) mais **4.17 en thème admin**, dont le `--default` est un taupe plus sombre —
// l'atome ne rend jamais en admin, mais garder une combinaison qu'on sait fausse quelque part
// alors qu'une autre passe partout n'avait aucun intérêt. `danger` n'est employé nulle part :
// dans ce design system le rouge annonce une erreur, jamais une catégorie de produit.
const STYLES_PAR_TYPE: Record<string, StyleBadge> = {
  lodging: { color: "accent", variant: "soft" },
  camp: { color: "accent", variant: "secondary" },
  activity: { color: "success", variant: "secondary" },
  transport: { color: "warning", variant: "soft" },
  // Aplat ambre plein — c'est le seul type dont l'existence est un moment, pas une offre
  // permanente ; il assume d'attirer l'œil davantage que les autres.
  evento: { color: "warning", variant: "primary" },
};

const STYLE_INCONNU: StyleBadge = { color: "default", variant: "soft" };

export function TypeBadge({ type, label, testId }: TypeBadgeProps) {
  const style = STYLES_PAR_TYPE[type] ?? STYLE_INCONNU;

  return (
    <Chip color={style.color} variant={style.variant} data-testid={testId}>
      {label}
    </Chip>
  );
}
