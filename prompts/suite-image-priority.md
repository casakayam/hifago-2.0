# Suite — l'atome Image : rendre le chargement explicite

> Petit lot pour l'agent qui a écrit `Image` (vague 1, lot « données affichées »).
> Bloc à coller dans son chat, il connaît déjà le fichier.

---

```
Reprends TON atome apps/web/components/atoms/Image.tsx. Une seule chose à ajouter, et elle est
gratuite aujourd'hui parce qu'aucune page ne consomme encore ce composant.

## Le constat

Le lazy loading n'est pas ce qui manque : `next/image` le fait par DÉFAUT depuis Next 11. Ton atome
charge donc déjà tout en lazy, et `EstablishmentDetailView.tsx:144` écrit un `loading="lazy"`
explicite qui ne change rien.

⚠️ **Ce qui manque, c'est l'inverse : `priority`.** L'image au-dessus de la ligne de flottaison ne
doit surtout PAS être lazy — c'est elle le LCP, et le navigateur ne la découvre qu'après avoir
calculé la mise en page. En lazy, elle part avec un train de retard. Le LCP est un Core Web Vital,
donc un critère de classement : ça touche directement le lot SEO livré ce matin.

La règle existe déjà dans ce dépôt, et n'est appliquée qu'à UN endroit —
`app/[locale]/products/[slug]/ProductPhotos.tsx:24-25` :

    priority={index === 0}
    loading={index === 0 ? undefined : "lazy"}

avec renvoi à `docs/specs/04-gestion-images.md §8`. Ni la grille du catalogue
(`CatalogBrowser.tsx:98`) ni la vignette d'établissement (`EstablishmentDetailView.tsx:144`) ne la
respectent. Si les pages migraient vers ton atome tel quel, la première carte du catalogue
deviendrait lazy : une régression de LCP.

## Ce qu'on te demande

Une prop **obligatoire** :

    loading: "lazy" | "priority";

⚠️ **Obligatoire, pas un `priority?: boolean` optionnel.** C'est le même raisonnement que pour `alt`
et `sizes`, et il est validé par les faits : `sizes` a été oublié dans `EstablishmentDetailView`
précisément parce qu'il était facultatif. L'atome ne peut pas savoir ce qui est au-dessus de la
ligne de flottaison — la page, si. La prop force la page à le dire.

Lis d'abord `docs/specs/04-gestion-images.md §8` : la règle y est déjà écrite, reprends-la plutôt
que de la redériver.

Points d'attention :
- ⚠️ `priority` et `loading="lazy"` sont contradictoires côté `next/image` — regarde comment
  `ProductPhotos` s'y prend (il passe `loading={undefined}` quand `priority` est vrai) et vérifie
  ce que ça produit vraiment dans le DOM rendu, ne le suppose pas.
- Le cas `src === null` ne charge rien : la prop n'a alors aucun effet, mais reste exigée — c'est ce
  qui garde le contrat lisible.
- ⚠️ Tu avais constaté que `next/image` jette `sizes` et `srcset` sur une source SVG. Vérifie si
  `priority` subit le même sort, et fige le résultat dans un test comme tu l'as fait pour `sizes`.

Mets à jour la story (une story qui montre la différence, ou au minimum la prop visible dans les
contrôles) et le test.

## Ce que tu ne fais PAS

- ⚠️ **Tu ne migres AUCUNE page.** Ni CatalogBrowser, ni EstablishmentDetailView, ni ProductPhotos.
  On corrigera leurs défauts (`sizes` manquant, `priority` absent) à la passe de migration.
- **Tu ne touches à aucun autre fichier** que `Image.tsx`, `Image.stories.tsx`, `Image.test.tsx`.
  Deux autres agents travaillent EN CE MOMENT dans le même répertoire de travail — l'un sur
  `components/atoms/Button.*`, l'autre sur `packages/ui/src/styles/globals.css` et
  `.storybook/preview.tsx`. Aucun merge git entre vous : vous vous écraseriez en direct.
- **Aucune dépendance**, aucun serveur lancé (3100 et 6006 sont pris ; `-p 6007` si besoin).
- **Tu ne commites pas.**

## Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components/atoms
    npx vitest run components/atoms/Image.test.tsx

## Ton rapport

Ce que tu as changé, ce que `priority` produit réellement dans le DOM (mesuré, pas supposé), le
comportement sur une source SVG, et le résultat exact des commandes.
```
