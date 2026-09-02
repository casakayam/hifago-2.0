// Le calcul de contraste WCAG du playground — un seul point de vérité (2026-09-02).
//
// ⚠️ POURQUOI CE MODULE EXISTE. La formule était écrite DEUX FOIS, par deux agents qui ne se
// voyaient pas : `Button.stories.tsx` (matrice des douze combinaisons) et `Palette.stories.tsx`
// (comparaison des cinq pistes). Les deux versions avaient déjà divergé sur le seuil de
// linéarisation sRGB — `0.03928` d'un côté, `0.04045` de l'autre — et sur l'arrondi. Or ce sont
// les SEULES sources des chiffres sur lesquels tout le chantier argumente : les 3.59 / 3.48
// documentés dans `Button.tsx`, les tableaux de la story `Contrastes`, et la piste que Jérôme
// choisira. Deux implémentations pouvant rendre deux nombres pour la même paire de couleurs,
// c'était le pire endroit du lot où se permettre un doublon.
//
// Seuil retenu : `0.03928`, celui de la définition WCAG 2.x (« relative luminance »). `0.04045`
// est la valeur de la spec sRGB ; l'écart entre les deux est invisible au deuxième chiffre après
// la virgule, mais c'est le texte de WCAG qui fait foi ici puisque c'est un seuil WCAG qu'on
// mesure — et c'est aussi la valeur qu'emploie axe-core, le moteur du panneau a11y de Storybook,
// donc nos chiffres et les siens restent comparables.

/**
 * Canvas 1×1 partagé, créé une seule fois.
 *
 * ⚠️ Il sert de convertisseur universel : il accepte `oklch()`, `oklab(… / .15)` et `color-mix()`
 * — vérifié — et il compose l'alpha lui-même. Un aplat translucide (les fonds `soft` de HeroUI)
 * n'a de contraste réel qu'une fois posé sur son fond : c'est ce que la composition en couches
 * mesure.
 *
 * ⚠️ Créé UNE fois au niveau module, pas à chaque conversion : la story `Contrastes` monte
 * 5 pistes × 2 modes × 24 conversions, soit 240 canvas et 240 contextes 2D par montage dans la
 * version d'origine. `willReadFrequently` ne paie d'ailleurs que sur un canvas réutilisé — il
 * était décoratif tant qu'on en jetait un à chaque appel.
 */
let ctxPartage: CanvasRenderingContext2D | null | undefined;

function contexte(): CanvasRenderingContext2D | null {
  if (ctxPartage === undefined) {
    const canevas = document.createElement("canvas");
    canevas.width = canevas.height = 1;
    ctxPartage = canevas.getContext("2d", { willReadFrequently: true });
  }
  return ctxPartage;
}

/** Une couleur composée, en canaux 0→1. */
export type Rgb = [number, number, number];

/**
 * Empile les couches données (de la plus basse à la plus haute) et rend la couleur résultante.
 * Chaque couche est une couleur CSS quelconque, y compris translucide.
 */
export function composer(couches: string[]): Rgb {
  const ctx = contexte();
  if (!ctx) return [0, 0, 0];
  ctx.clearRect(0, 0, 1, 1);
  for (const couche of couches) {
    ctx.fillStyle = couche;
    ctx.fillRect(0, 0, 1, 1);
  }
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

/** Luminance relative WCAG 2.x d'une couleur en canaux 0→1. */
export function luminance([r, g, b]: Rgb): number {
  const l = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}

/** Rapport de contraste entre deux couleurs composées. Ordre indifférent. */
export function contraste(a: Rgb, b: Rgb): number {
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (haut + 0.05) / (bas + 0.05);
}

/**
 * Résout une expression CSS (`var(--accent)`, `light-dark(…)`, `color-mix(…)`) en couleur calculée,
 * en la faisant évaluer par le moteur sur un élément réel.
 *
 * ⚠️ Indispensable, et pas seulement pratique : lue en brut, une custom property de ce projet vaut
 * la chaîne `light-dark(clair, sombre)` ENTIÈRE, dont le canvas prendrait toujours la branche
 * claire — on mesurerait donc le mode clair en croyant mesurer le sombre.
 *
 * La sonde doit être attachée au document, à l'endroit dont on veut hériter le contexte de thème.
 */
export function resoudre(sonde: HTMLElement, expression: string): string {
  sonde.style.color = "";
  sonde.style.color = expression;
  return getComputedStyle(sonde).color;
}
