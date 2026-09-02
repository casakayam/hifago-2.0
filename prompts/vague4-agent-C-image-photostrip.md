# Vague 4 — Agent C : Image.loading puis PhotoStrip

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-02. Deux autres agents tournent : le thème et le header.

---

```
Deux tâches, dans cet ordre — la seconde dépend de la première.

D'AUTRES AGENTS TRAVAILLENT EN CE MOMENT dans le même répertoire de travail : l'un sur le thème
(`packages/ui/src/styles/globals.css`, `.storybook/preview.tsx`, `components/playground/*`),
l'autre sur le header (`components/organisms/*`, `components/atoms/IconButton.tsx`,
`messages/`). Pas de merge git entre vous : tu ne touches à rien de tout ça.

## 0. À lire d'abord

`hifago/apps/web/components/README.md` (les conventions font foi) et
`hifago/apps/web/components/atoms/Image.tsx` — c'est ton point de départ.

## 1. Ton périmètre exclusif

apps/web/components/atoms/Image.tsx            + .stories.tsx + .test.tsx
apps/web/components/molecules/PhotoStrip.tsx   + .stories.tsx + .test.tsx

`molecules/` existe et est vide. Tu ne commites pas. Tu ne migres aucune page.

⚠️ Le `title` d'une story ne suit PAS le dossier (convention du 2026-09-02, écrite au README) :
`Image` est déjà en `"Affichage/Image"` — **ne le remets pas en `Atoms/`**. `PhotoStrip` rejoint
le même groupe : `"Affichage/PhotoStrip"`.

## 2. Image — rendre le chargement explicite

Le lazy loading n'est pas ce qui manque : `next/image` le fait par DÉFAUT depuis Next 11. Ton
atome charge donc déjà tout en lazy.

⚠️ **Ce qui manque, c'est l'inverse : `priority`.** L'image au-dessus de la ligne de flottaison ne
doit surtout PAS être lazy — c'est elle le LCP, et le navigateur ne la découvre qu'après avoir
calculé la mise en page. Le LCP est un Core Web Vital, donc un critère de classement : ça touche
directement le lot SEO du 2026-09-01.

La règle existe déjà dans le dépôt et n'est appliquée qu'à UN endroit —
`app/[locale]/products/[slug]/ProductPhotos.tsx:24-25` :

    priority={index === 0}
    loading={index === 0 ? undefined : "lazy"}

avec renvoi à `docs/specs/04-gestion-images.md §8`. Lis cette section : la règle y est écrite,
reprends-la plutôt que de la redériver. Ni `CatalogBrowser.tsx:98` ni
`EstablishmentDetailView.tsx:144` ne la respectent (ce dernier n'a même pas de `sizes`).

**Ajoute une prop OBLIGATOIRE :**

    loading: "lazy" | "priority";

⚠️ **Obligatoire, pas un `priority?: boolean` optionnel.** Même raisonnement que pour `alt` et
`sizes`, et il est validé par les faits : `sizes` a été oublié dans `EstablishmentDetailView`
précisément parce qu'il était facultatif. L'atome ne peut pas savoir ce qui est au-dessus de la
ligne de flottaison — la page, si.

Trois points à vérifier plutôt qu'à supposer :
- `priority` et `loading="lazy"` sont contradictoires côté `next/image`. Regarde comment
  `ProductPhotos` s'y prend, et vérifie ce que ça produit dans le DOM RENDU.
- Le cas `src === null` ne charge rien : la prop n'a alors aucun effet, mais reste exigée — c'est
  ce qui garde le contrat lisible.
- ⚠️ Il est établi que `next/image` jette `sizes` ET `srcset` sur une source SVG. Vérifie si
  `priority` subit le même sort, et fige le résultat dans un test.

## 3. PhotoStrip — la galerie

Remplaçant de `ProductPhotos.tsx`, qui branche le `Carousel` partagé sur `next/image` via
`renderSlide`. Lis-le : il est court et contient déjà les bonnes décisions.

⚠️ `Carousel` vit dans `packages/ui/src/components/carousel.tsx` (Embla) et reste
**volontairement indépendant de Next.js** — c'est écrit dans son en-tête, et c'est pour ça qu'il
expose `renderSlide` au lieu de rendre les images lui-même. **Tu ne le modifies pas.**

Ce que `PhotoStrip` apporte par-dessus `ProductPhotos` :
- il rend ses slides avec **l'atome `Image`**, jamais `next/image` en direct — donc `alt` et
  `sizes` obligatoires par le type, et le substitut quand une photo manque ;
- ⚠️ **`loading="priority"` sur le premier slide uniquement**, `"lazy"` pour les suivants. C'est
  exactement ce que la prop du §2 existe pour rendre impossible à oublier : sans elle, régression
  LCP silencieuse, parce qu'Embla monte les slides suivants hors écran.

Le `Carousel` masque déjà ses flèches et ses points quand il n'y a qu'un slide (règle §8 du spec,
comportement legacy conservé) — ne le refais pas par-dessus.

`"use client"` obligatoire : le `Carousel` est un composant client.

## 4. Stories

`Image` : une story qui montre la différence entre les deux valeurs, ou au minimum la prop dans
les contrôles. `PhotoStrip` : une photo, plusieurs, aucune, et une photo au format inattendu (très
large ou très haute). Noms d'exports en français.

## 5. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run components

Puis au rendu, gabarits Mobile 390 et Desktop 1280 : panneau a11y sans violation, aucun
défilement horizontal — ⚠️ une galerie est l'endroit où il apparaît le plus facilement.

## 6. Ton rapport

1. Les fichiers créés ou modifiés.
2. Ce que `priority` produit RÉELLEMENT dans le DOM rendu, et son comportement sur une source SVG
   — mesuré, pas supposé.
3. Comment `PhotoStrip` garantit que seul le premier slide est prioritaire.
4. Ce que tu as constaté sans corriger (`EstablishmentDetailView.tsx:144` n'a pas de `sizes` — ne
   le corrige pas, c'est une page).
5. Le résultat exact des commandes du §5. Si quelque chose échoue, dis-le.

Tu ne commites pas.
```
