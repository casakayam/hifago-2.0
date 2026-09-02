# Vague 1 — Agent A : structure et navigation

> Bloc à coller tel quel dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-01 par l'agent coordinateur. Agent B tourne **en même temps** sur trois autres
> atomes ; vos périmètres sont disjoints par construction (voir §2).

---

```
Tu travailles sur hifago/apps/web (vitrine publique, Next 16 + HeroUI v3 + next-intl).

UN AUTRE AGENT TRAVAILLE EN CE MOMENT MÊME dans le même répertoire de travail, sur d'autres
composants. Il n'y a pas de merge git entre vous : si vous écrivez dans le même fichier, vous vous
écrasez en direct. Vos périmètres ont été rendus disjoints exprès — respecte le tien à la lettre.

## 0. À lire avant d'écrire la première ligne

1. `hifago/AGENTS-PARALLELES.md` — les DEUX blocs (le générique, et « agent qui crée des
   composants »). C'est court.
2. `hifago/apps/web/components/README.md` — les conventions font foi. Nommage, anatomie d'un
   composant, règles SEO/sémantique, i18n, accessibilité, responsive, états limites en story.
3. `hifago/CLAUDE.md` §2 et §11.16.

## 1. Ton périmètre exclusif — tu crées EXACTEMENT ces 9 fichiers, et rien d'autre

apps/web/components/atoms/PageShell.tsx
apps/web/components/atoms/PageShell.stories.tsx
apps/web/components/atoms/PageShell.test.tsx
apps/web/components/atoms/Title.tsx
apps/web/components/atoms/Title.stories.tsx
apps/web/components/atoms/Title.test.tsx
apps/web/components/atoms/BackLink.tsx
apps/web/components/atoms/BackLink.stories.tsx
apps/web/components/atoms/BackLink.test.tsx

## 2. Ce que tu ne fais PAS — lis cette section deux fois

- ⚠️ **Tu ne migres AUCUNE page existante.** Tu crées les atomes ; tu ne remplaces pas le code des
  8 pages qui les utiliseront. C'est précisément ce qui permet à deux agents de tourner en même
  temps : `app/[locale]/page.tsx` a besoin de composants venant des DEUX périmètres, donc le
  migrer serait le seul vrai point de collision. La migration est faite après, par le
  coordinateur, en une passe.
- **Tu ne crées aucun autre atome.** `Price`, `TypeBadge` et `Image` appartiennent à l'agent B et
  sont en cours d'écriture pendant que tu lis ceci. Si tu penses en avoir besoin, tu ne les crées
  pas : tu composes localement dans ta story et tu le signales dans ton rapport.
- **Aucun `index.ts` de réexport (barrel)** dans `components/`. C'est volontaire et documenté.
- **Aucune dépendance ajoutée** : ni `package.json`, ni le lockfile, ni `npm install`.
- **Aucune clé i18n, aucun fichier `messages/`.** Un atome ne traduit rien : il reçoit ses libellés
  déjà traduits en props. Les trois atomes ci-dessous n'ont donc aucune chaîne à traduire.
- **Aucun fichier partagé** : `.storybook/**`, `components/README.md`, `CLAUDE.md`,
  `docs/journal/`, `AGENTS-PARALLELES.md`. Le coordinateur s'en charge.
- **Tu ne lances aucun serveur.** `npm run dev` (3100) et Storybook (6006) tournent déjà chez
  Jérôme. Si tu as besoin d'un rendu : `npx storybook dev -p 6007` et tu l'arrêtes en partant.
- **Tu ne commites pas, tu ne pushes pas.** Le coordinateur relit et commite les deux lots.

## 3. Les contrats — déjà décidés, tu implémentes

Les signatures ci-dessous sont fixées par le coordinateur, pas des suggestions. Elles existent pour
que les six atomes de la vague forment un ensemble cohérent alors que deux agents les écrivent
séparément. Si l'une te paraît fausse, ne l'améliore pas en silence : implémente-la et dis-le dans
ton rapport.

**Langue** : code et noms de props en **anglais** (`size`, `label`, `testId`) ; commentaires en
**français** ; noms d'exports de stories en **français** (`Defaut`, `Vide`, `TexteLong`).

### 3.1 PageShell — la coquille de page

```tsx
export type PageShellProps = {
  children: ReactNode;
  /** Pas de valeur par défaut : chaque page choisit explicitement sa largeur. */
  variant: "large" | "narrow" | "centered";
  testId?: string;
};
```

Rend **un `<main>`**, et rien d'autre. Classes, relevées telles quelles dans le code existant :

| variant | classes | pages concernées aujourd'hui |
|---|---|---|
| `large` | `mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8` | accueil, établissement |
| `narrow` | `mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8` | fiche produit, checkout, commandes |
| `centered` | `flex flex-1 flex-col items-center justify-center gap-6 p-6 sm:p-8` | login, signup, verify-email |

Trois écarts assumés par rapport au copier-coller existant, à documenter dans le commentaire
d'en-tête du fichier :
- Le gabarit est copié 8 fois dans `app/[locale]/**` avec un `gap-4` sur deux pages et `gap-6` sur
  les six autres. C'est une dérive, pas une décision : **un seul `gap-6`**, et pas de prop `gap`
  (exposer une prop pour une dérive accidentelle, c'est la figer).
- `p-8` partout aujourd'hui, soit 64 px mangés sur un écran de 390 px. **`p-6 sm:p-8`** — mobile
  d'abord, comme l'exige le README.
- `verify-email` ajoute `text-center` : ce n'est pas la coquille, c'est l'alignement de son
  contenu. Ne l'intègre pas au variant `centered`.

⚠️ **PageShell ne rend NI `<h1>`, NI `<header>`, NI `<footer>`.** Un titre à l'intérieur d'une
coquille, c'est la faute classique qui produit trois `<h1>` par page — c'est `Title` qui porte le
niveau, et c'est la page qui décide. `<header>` et `<footer>` iront dans
`app/[locale]/layout.tsx` en vague 2, avec `SiteHeader`/`SiteFooter` : ne les anticipe pas ici, et
n'ajoute pas de props `header`/`footer` (le README interdit l'anticipation).

Stories : `Large`, `Narrow`, `Centered`, plus une story `ContenuLong` qui prouve qu'un contenu large
(un tableau, un bloc `<pre>`) **ne fait pas défiler la page horizontalement** à 390 px.

### 3.2 Title — le niveau est une décision de la page

```tsx
export type TitleProps = {
  /** Requis, jamais deviné : c'est ce qui garantit un seul <h1> et une hiérarchie sans saut. */
  as: "h1" | "h2" | "h3";
  children: ReactNode;
  /** Apparence, décorrélée du niveau. Défaut dérivé de `as`. */
  size?: "lg" | "md" | "sm";
  testId?: string;
};
```

Classes relevées dans le code existant, à reprendre :

| size | classes | où on le voit |
|---|---|---|
| `lg` | `text-2xl font-semibold` | les 6 `<h1>` de l'app, tous identiques |
| `md` | `text-lg font-medium` | les `<h2>` de `EstablishmentDetailView` |
| `sm` | `text-sm font-medium` | les `<h2>` « availabilityTitle » des 3 formulaires |

Défaut : `h1`→`lg`, `h2`→`md`, `h3`→`sm`.

⚠️ **Pourquoi `size` est décorrélé de `as`** : trois `<h2>` de l'app sont en `text-sm`. Sans cette
séparation, un développeur pressé écrira `<h3>` pour obtenir du petit texte et cassera la hiérarchie
— exactement ce que la règle SEO cherche à empêcher. Le niveau est sémantique, la taille est
visuelle, et elles ne sont pas la même décision.

Stories : `Defaut`, `TousLesNiveaux` (h1/h2/h3 empilés), `PetitH2` (le cas `as="h2" size="sm"`),
`TexteLong` (un titre de 120 caractères, pour voir la césure à 390 px).

Test : que `as="h2"` produit bien un `<h2>` dans le DOM, et que `size` ne change pas la balise.

### 3.3 BackLink — le lien de retour, localisé

```tsx
export type BackLinkProps = {
  href: string;
  /** Déjà traduit — un atome ne traduit rien. */
  label: string;
  testId?: string;
};
```

Remplace ce motif, écrit deux fois à l'identique (`ProductDetailView.tsx:113`,
`EstablishmentDetailView.tsx:59`) :

```tsx
<Link href="/" className="text-sm text-muted hover:underline">{label}</Link>
```

Deux exigences que l'atome ajoute, et c'est sa raison d'être :
- ⚠️ **`Link` de `@/i18n/navigation`**, jamais `next/link` ni `<a href>` : lui seul conserve le
  préfixe de locale. C'est la règle la plus facile à violer sans que rien ne le signale.
- **Cible tactile ≥ 44 px** (README) : le lien actuel est une ligne de texte de 14 px, impossible à
  viser au pouce. Ajoute `inline-flex min-h-11 items-center` (`min-h-11` = 44 px).

Si tu ajoutes une flèche décorative, elle doit être `aria-hidden` **et** le libellé doit rester
compréhensible sans elle (règle : jamais d'information portée par le seul visuel).

Stories : `Defaut`, `TexteLong`. Le rendu du `Link` localisé sous Storybook est déjà prouvé par
`app/[locale]/CatalogBrowser.stories.tsx` — regarde-la si quelque chose résiste.

## 4. Rappels d'anatomie (le README fait foi, ceci est le condensé)

- `export function` nommé, **jamais** `export default`. Type de props nommé et exporté.
- ⚠️ **Pas de prop `className`** : zéro composant du dépôt n'en expose.
- Pas de `forwardRef`, pas de `React.FC`, pas de `displayName`.
- `testId?: string` → `data-testid={testId}`.
- Commentaire d'en-tête qui dit **pourquoi**, daté, avec renvoi à la décision.
- `cn` s'importe de `@hifago/ui`. **Jamais de `tv()` écrit à la main.**
- HeroUI s'importe **uniquement** depuis `@hifago/ui`, jamais `@heroui/react` (ESLint + un
  garde-fou bloquant).
- Dans un test : `@testing-library/jest-dom` **n'existe pas** dans ce monorepo — assertions DOM
  natives uniquement. Et `@/i18n/navigation` doit être mocké, motif exact dans
  `app/[locale]/products/[slug]/ProductDetailView.test.tsx:13-19`.
- Story avec accent dans le `title` → ajouter un `id` explicite sans accent dans le `meta`.

## 5. Vérification avant de rendre

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components/atoms
    npx vitest run components/atoms

Puis, aux gabarits **Mobile 390** et **Desktop 1280** de Storybook : tes 3 composants rendent
stylés, le panneau **a11y** ne remonte aucune violation critique, et **aucune story ne provoque de
défilement horizontal**.

## 6. Ce que tu me rends

Un rapport court, en français :
1. Les 9 fichiers créés.
2. Toute divergence par rapport aux contrats du §3, avec la raison. Ne corrige pas un contrat en
   silence.
3. Les atomes du périmètre de l'agent B qui t'ont manqué (`Price`, `TypeBadge`, `Image`) et comment
   tu as composé sans eux.
4. Ce que tu as constaté et pas corrigé : les surprises du dépôt valent plus que le code.
5. Le résultat exact des commandes du §5, sorties à l'appui. Si quelque chose échoue, dis-le — un
   rapport qui annonce vert sur du rouge coûte plus cher que l'échec lui-même.

Tu ne commites pas.
```
