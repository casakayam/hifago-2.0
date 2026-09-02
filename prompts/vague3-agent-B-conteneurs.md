# Vague 3 — Agent B : conteneurs et médias

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-02. D'autres agents tournent en même temps : périmètres disjoints.

---

```
Tu construis les conteneurs et la galerie photo de la vitrine hifago (apps/web).

D'AUTRES AGENTS TRAVAILLENT EN CE MOMENT MÊME dans le même répertoire de travail — l'un sur les
champs de saisie (`components/atoms/Field.*`, `Textarea.*`, `Select.*`, `Checkbox.*`), un autre sur
le thème (`packages/ui/src/styles/globals.css`, `.storybook/`). Il n'y a pas de merge git entre
vous : si vous écrivez dans le même fichier, vous vous écrasez en direct.

## 0. À lire avant d'écrire la première ligne

1. `hifago/AGENTS-PARALLELES.md` — les deux blocs.
2. `hifago/apps/web/components/README.md` — les conventions font foi.
3. ⚠️ `hifago/apps/web/components/atoms/Button.tsx` — **lis-le en entier avant de concevoir.**
   Livré hier, il fixe le vocabulaire de cette surcouche : deux axes séparés (`variant` = la forme,
   `color` = le rôle), l'axe couleur obtenu en reposant les custom properties de HeroUI,
   `"use client"` obligatoire, pas de prop `className`, le rayon repris de `var(--radius)`. Ton
   `LinkButton` doit s'accorder avec lui au pixel près, pas inventer une deuxième grammaire.
4. `hifago/apps/web/components/atoms/Image.tsx` — tu vas le composer.

## 1. Ton périmètre exclusif

apps/web/components/atoms/Card.tsx           + .stories.tsx + .test.tsx
apps/web/components/atoms/LinkButton.tsx     + .stories.tsx + .test.tsx
apps/web/components/molecules/PhotoStrip.tsx + .stories.tsx + .test.tsx

⚠️ `PhotoStrip` va dans `molecules/`, pas `atoms/` : il compose l'atome `Image` avec le `Carousel`
partagé. Le dossier existe déjà et est vide.

## 2. Ce que tu ne fais PAS

- ⚠️ **Tu ne migres AUCUNE page.** `ProductPhotos.tsx`, `CatalogBrowser.tsx` et
  `ProductDetailView.tsx` restent tels quels — tu construis leur remplaçant, tu ne les remplaces
  pas. C'est ce qui rend le travail en parallèle possible.
- **Tu ne touches à aucun composant hors de ton périmètre** : `Button`/`IconButton`/`Image` sont
  livrés et en LECTURE SEULE pour toi ; `Field`/`Textarea`/`Select`/`Checkbox` sont en cours
  d'écriture par un autre agent en ce moment même.
- ⚠️ **Tu ne touches pas `packages/ui/`** — ni le `Carousel`, ni les styles. Le `Carousel` reste
  volontairement indépendant de Next.js (c'est écrit dans son commentaire d'en-tête), et l'agent
  thème écrit dans `globals.css` en ce moment.
- ⚠️ **Tu ne touches pas `apps/web/.storybook/**`** : agent thème.
- **Aucune dépendance ajoutée**, aucune clé i18n.
- **Pas de barrel `index.ts`**, pas de doc partagée, pas de journal.
- **Tu ne lances aucun serveur** : 3100 et 6006 sont pris. `-p 6007` si besoin, arrêté en partant.
- **Tu ne commites pas.**

## 3. Les trois composants

### 3.1 Card — cinq usages, et un piège de sémantique

L'API compound de HeroUI (`Card.Header`, `Card.Title`, `Card.Description`, `Card.Content`) est
employée cinq fois : `CatalogBrowser.tsx:95`, `ProductDetailView.tsx:116` et `:207`,
`EstablishmentDetailView.tsx:63` et `:140`.

⚠️ **Le cas qui compte est la carte CLIQUABLE.** `CatalogBrowser.tsx:94` enveloppe la carte entière
dans un `<Link>`, et `EstablishmentDetailView.tsx:139` fait pareil. C'est le motif le plus courant
d'un catalogue, et le plus facile à rendre inaccessible :
- une carte contenant un titre, une description et une image, le tout dans un seul lien, s'annonce
  au lecteur d'écran comme un seul libellé interminable ;
- et si un jour la carte contient un second élément interactif, on obtient un lien dans un lien —
  du HTML invalide.

À toi de trancher comment la surcouche l'exprime proprement. ⚠️ **Le lien doit rester un vrai
lien** (ouvrable dans un nouvel onglet, copiable) : ne remplace pas la navigation par un
`onClick` sur la carte. Et il passe par le `Link` de `@/i18n/navigation`, jamais `next/link` nu
(règle du README : lui seul conserve le préfixe de locale).

⚠️ Trois des cinq usages passent un `className` (`h-full overflow-hidden`, `flex flex-col gap-6`,
`text-lg`) — interdit par le README. Regarde ce que ces valeurs cherchent à obtenir et donne-leur
des props sémantiques.

### 3.2 LinkButton — un trou laissé ouvert par le lot Button

`ProductDetailView.tsx:158-167` : le lien de réservation externe d'un evento est un `<a>` habillé
en bouton —

    <a href={externalBookingUrl} target="_blank" rel="noopener noreferrer"
       className={buttonVariants({ variant: "primary" })}>

⚠️ **Un lien n'est pas un bouton.** Il navigue, s'ouvre dans un onglet, se copie, et s'annonce
« lien » et non « bouton ». Le `Button` livré par le lot précédent ne couvre pas ce cas, et l'habiller avec
`buttonVariants` à la main est précisément ce que la surcouche doit supprimer.

Deux cas à couvrir, et ils ne sont pas les mêmes :
- **lien interne** → le `Link` de `@/i18n/navigation` (préfixe de locale conservé) ;
- **lien externe** → un `<a>` avec `target="_blank"` et `rel="noopener noreferrer"`. ⚠️ `rel` ne
  doit pas pouvoir être oublié : rends-le impossible à omettre par construction, pas par vigilance.
  Et un lien qui ouvre un onglet devrait le dire à un lecteur d'écran.

⚠️ **L'apparence doit être identique à celle de `Button`**, pas « ressemblante » : réutilise
`buttonToneClasses`, `HEROUI_VARIANT` et `RADIUS_CLASS`, qui sont exportés par `Button.tsx`
exactement pour ça. Deux tables de couleurs qui divergent, c'est le défaut classique de ce genre de
paire.

### 3.3 PhotoStrip — la galerie

Remplaçant de `ProductPhotos.tsx`, qui branche le `Carousel` partagé sur `next/image` via
`renderSlide`. Lis-le : il est court et il contient déjà les bonnes décisions.

Ce que `PhotoStrip` apporte par-dessus :
- il rend les slides avec **l'atome `Image`**, pas `next/image` en direct — donc `alt` et `sizes`
  obligatoires par le type, et le substitut quand une photo manque ;
- ⚠️ **`priority` sur le premier slide uniquement**, les suivants en lazy. La règle est écrite
  (`docs/specs/04-gestion-images.md §8`) et déjà appliquée dans `ProductPhotos.tsx:24` : sans elle,
  régression LCP silencieuse, parce qu'Embla monte les slides suivants hors écran.

⚠️ **DÉPENDANCE, à vérifier AVANT de commencer** : l'atome `Image` doit exposer une prop
`loading: "lazy" | "priority"`. Un autre agent est chargé de l'ajouter. Ouvre `Image.tsx` et
regarde. **Si la prop n'y est pas encore : ne la contourne pas en silence et n'écris pas de
`next/image` en parallèle.** Signale-le, fais le reste (`Card`, `LinkButton`), et reviens sur
`PhotoStrip` ensuite. Contourner l'atome ferait exactement le défaut qu'il existe pour empêcher.

Le `Carousel` masque ses flèches et ses points quand il n'y a qu'un slide (règle §8 du spec,
comportement legacy conservé) — ne le refais pas par-dessus.

## 4. Contraintes communes

- ⚠️ **`"use client"` en tête** de `Card.tsx` et `LinkButton.tsx` (barrel `@hifago/ui`,
  CLAUDE.md §11.16). `PhotoStrip` en a besoin aussi : le `Carousel` est un composant client.
- **Pas de prop `className`.**
- **Cible tactile ≥ 44 px** sur tout ce qui se clique (README).
- **Jamais de `tv()` écrit à la main.**
- `export function` nommé, type de props exporté, `testId?` → `data-testid`, commentaire d'en-tête
  qui dit **pourquoi**, daté.
- Tests : pas de `@testing-library/jest-dom`, assertions DOM natives. `@/i18n/navigation` doit être
  mocké — motif exact dans `components/atoms/BackLink.test.tsx`, qui pose en plus un attribut pour
  prouver que c'est bien le Link localisé et pas un `<a>` nu. Reprends ce geste pour `LinkButton`.

## 5. Les stories

- `Card` : simple, **cliquable**, avec image, sans image, texte long, et **une grille de plusieurs
  cartes** — c'est la grille qui révèle les hauteurs inégales, pas la carte isolée.
- `LinkButton` : interne, externe, à côté d'un `Button` de même `variant`/`color` pour **prouver
  visuellement que les deux sont identiques**.
- `PhotoStrip` : une photo, plusieurs photos, aucune photo, une photo au format inattendu (très
  large ou très haute).

Noms d'exports en français. La bascule clair/sombre arrive dans la barre d'outils pendant que tu
travailles : vérifie dans les deux modes dès qu'elle apparaît.

## 6. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run components

Puis au rendu : gabarits **Mobile 390** et **Desktop 1280**, panneau **a11y** sans violation,
aucun défilement horizontal — ⚠️ la grille de cartes et la galerie sont les deux endroits du lot
où il apparaît le plus facilement.

## 7. Ton rapport

1. Les fichiers créés.
2. **Comment tu as résolu la carte cliquable**, et ce que ça donne au lecteur d'écran (vérifié,
   pas supposé).
3. La preuve que `LinkButton` et `Button` rendent à l'identique.
4. L'état de la dépendance `Image.loading` : présente ou non, et ce que tu en as fait.
5. Ce que tu as constaté sans corriger.
6. Le résultat exact des commandes du §6. Si quelque chose échoue, dis-le.

Tu ne commites pas.
```
