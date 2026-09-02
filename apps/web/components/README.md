# Composants de la vitrine (`apps/web`)

Conventions du design system de la vitrine publique. **Elles n'existaient nulle part avant le
2026-09-01** — elles sont relevées du code déjà écrit, pas inventées. Quand une règle contredit un
fichier existant, c'est le fichier qui a tort ; quand ce document contredit `hifago/CLAUDE.md`,
c'est CLAUDE.md qui fait foi.

## Où va quoi

| Dossier | Contenu | Exemple |
|---|---|---|
| `atoms/` | Brique indivisible, sans logique métier, **ne traduit rien** | `Price`, `TypeBadge`, `Title` |
| `molecules/` | Composition de plusieurs atomes, liée à un écran | `ProductCard`, `CatalogFilters` |
| `organisms/` | Bloc autonome, souvent avec état ou navigation | `SiteHeader`, `CartSummary` |
| `seo/` | Pas de l'interface : données structurées | `JsonLd` |
| `playground/` | Stories de référence (socle, tokens, sémantique) | `Socle.stories.tsx` |

Un composant lié à **une seule route** reste colocalisé dans `app/[locale]/…` — c'est déjà le cas
des treize composants d'écran actuels. On ne remonte dans `components/` que ce qui sert **au moins
deux endroits**, jamais par anticipation (même esprit que `CLAUDE.md` §2.1 pour `packages/`).

⚠️ **Pas de `index.ts` de réexport (barrel).** Chaque composant s'importe par son chemin :
`import { Price } from "@/components/atoms/Price"`. Un barrel serait le fichier que tous les agents
éditeraient en même temps à chaque ajout — voir « Travailler à plusieurs » plus bas.

## Nommage

**PascalCase** pour le fichier et le composant : `ProductCard.tsx` → `ProductCard`.

*Le dépôt contient deux conventions historiques (`packages/ui` et `apps/admin/components` sont
majoritairement en kebab-case). `apps/web` est à 100 % PascalCase : y introduire du kebab créerait
une troisième convention dans la même app.*

Test colocalisé : `ProductCard.test.tsx`. Story colocalisée : `ProductCard.stories.tsx`.

## Anatomie d'un composant

```tsx
// Pourquoi ce composant existe, et quelle décision il applique (avec sa date).
export type PriceProps = {
  amountCop: number;
  /** Libellé déjà traduit — un atome ne traduit jamais lui-même. */
  suffix?: string;
  testId?: string;
};

export function Price({ amountCop, suffix, testId }: PriceProps) { … }
```

- `export function` nommé — **jamais** `export default`.
- Type de props **nommé et exporté**, `XxxProps`.
- **Pas de prop `className`.** Zéro composant du dépôt n'en expose : la composition passe par des
  props sémantiques (`variant`, `footer: ReactNode`, `renderSlide`), pas par override de classe.
  Un composant qui « aurait besoin » de `className` est presque toujours un composant trop rigide.
- Pas de `forwardRef`, pas de `React.FC`, pas de `displayName` — aucun n'existe dans ce dépôt.
- `testId?: string` → `data-testid={testId}`. Sur un composite, préfixer les enfants :
  `` data-testid={`${testId}-action`} ``.
- Commentaire d'en-tête qui dit **pourquoi**, daté, avec renvoi à la spec ou à la décision.
- `cn` s'importe de `@hifago/ui`. ⚠️ **Ne jamais écrire de `tv()` à la main** : dans ce projet les
  variantes ne sont pas des compositions Tailwind mais des classes BEM (`button--outline`) stylées
  par les tokens `[data-theme]`. `buttonVariants` de HeroUI en est le seul exemple.
- ⚠️ **`CLAUDE.md` §11.16 s'applique par TRANSITIVITÉ, et c'est ce qui décide de la forme d'un
  composant.** La règle est écrite pour `page.tsx`/`layout.tsx`, mais un composant sans
  `"use client"` importé PAR un Server Component fait entrer le barrel dans le même graphe de
  modules, avec le même `next build` cassé — invisible au typecheck et au lint. Deux formes valides,
  jamais autre chose :
  1. **N'importer rien de `@hifago/ui`** (ni `cn`) : suffisant dès que les variantes sont des
     chaînes de classes fixes, ce qui est le cas de cinq des six atomes.
  2. **Porter `"use client"` en tête**, quand le composant a réellement besoin d'une primitive
     HeroUI — c'est le cas de `TypeBadge`, qui s'appuie sur `Chip`.

  Corollaire pratique : n'importe `cn` que si tu as vraiment des classes à fusionner. Constaté le
  2026-09-01, les deux agents de la vague 1 y étant arrivés séparément.
- Au-delà de ~150 lignes, on découpe.

## SEO — la sémantique est une décision de composant

- **Un seul `<h1>` par page**, hiérarchie sans saut. Un composant de titre **reçoit son niveau en
  prop** (`as="h2"`), il ne le choisit jamais seul.
- **Les landmarks appartiennent à la coquille** : un seul `<main>`, un `<header>`, un `<footer>`,
  `<nav>` pour la navigation.
- **Toute image passe par `next/image`**, `alt` **requis** (jamais optionnel) et `sizes` renseigné.
- ⚠️ **Tout lien interne passe par le `Link` de `@/i18n/navigation`** — jamais `next/link` nu ni
  `<a href>` : lui seul conserve le préfixe de locale. Un `<a href="/products/x">` produit un lien
  cassé.
- **Le JSON-LD reste dans `page.tsx`** (Server Component), jamais dans un composant de présentation.
- Un composant ne masque jamais du contenu indexable derrière une interaction : un accordéon fermé
  garde son contenu dans le HTML.

## Traductions

- **Aucune chaîne ES/EN en dur.**
- ⚠️ **Un traducteur next-intl ne traverse pas la frontière RSC.** Donc : un composant **client**
  appelle `useTranslations()` lui-même ; un composant qui reçoit ses données d'un Server Component
  reçoit des **chaînes déjà résolues** (c'est pourquoi `ProductDetailView` reçoit
  `backToCatalogLabel`, pas un `t`).
- **Un atome ne traduit rien** — il reçoit son libellé. Seuls molecules et organisms appellent
  `useTranslations`.
- Les messages vivent dans `messages/<locale>/<Namespace>.json`, **un fichier par namespace**.
  Toute nouvelle clé va dans **es ET en** — `messages/parity.test.ts` échoue sinon. Un nouveau
  namespace doit être branché dans `messages/index.ts` (le test le vérifie aussi).

## Lisibilité et accessibilité

- Le panneau **a11y** de Storybook ne doit remonter aucune violation critique.
- Texte courant jamais sous 16 px sur mobile ; longueur de ligne bornée (~75 caractères).
- L'information n'est **jamais portée par la seule couleur** : un statut a un mot, pas qu'une
  pastille.
- Cible tactile ≥ 44 px. Le focus clavier reste visible — ne jamais retirer l'anneau de focus sans
  le remplacer.

## Responsive — mobile d'abord

- **Classes de base = mobile**, les variantes `sm:`/`md:`/`lg:` ajoutent pour les grands écrans.
- ⚠️ **Ne jamais masquer du contenu selon la largeur.** Google indexe la version **mobile** : un
  `hidden md:block` retire ce contenu de l'index. On réorganise, on ne supprime pas. `hidden` est
  réservé au décoratif.
- Un composant **ne fixe aucune largeur en dur** ; il s'adapte à son conteneur.
- **La page ne défile jamais horizontalement** : un contenu large défile dans son propre conteneur.
  ⚠️ **`overflow-x-auto` seul est une violation d'accessibilité sérieuse**, pas seulement une
  imperfection : une région qui défile et que rien ne rend focalisable est inatteignable au clavier
  (axe `scrollable-region-focusable`, WCAG 2.1.1). Si le conteneur **ne contient aucun élément déjà
  focalisable** (un tableau de texte, un bloc de code — par opposition à une liste de liens, qui se
  parcourt au clavier toute seule), il lui faut `tabIndex={0}` **et** un nom accessible :
  `role="region"` + `aria-label`. Ne le pose pas quand la région contient déjà des liens ou des
  boutons : ça ajouterait un arrêt de tabulation inutile. Constaté le 2026-09-01 en montant les
  atomes — la règle était écrite ici depuis la veille sans cette moitié, et tout reflow de liste
  dense de la vague 2 aurait reproduit le défaut.
- Pour une liste dense : **reflow en cartes sous `md`**, jamais un simple `overflow-x-auto` — rendre
  scrollable n'est pas rendre lisible. Pattern déjà validé côté admin, à reproduire.
- Breakpoint de référence : `md` = 768 px. Un composant n'est pas terminé tant qu'il n'a pas été vu
  à **390×844** et **1280×900**.

## Stories

Chaque composant a au minimum `Defaut`, plus les **états limites** qui le concernent : `Vide`,
`Chargement`, `Erreur`, `TexteLong`, `SansImage`. Ce sont eux qui cassent en production.

```tsx
const meta = { title: "Affichage/Price", component: Price } satisfies Meta<typeof Price>;
export default meta;
export const Defaut: StoryObj<typeof meta> = { args: { amountCop: 80000 } };
```

### ⚠️ Le `title` ne suit PAS le dossier

Le dossier dit ce qui est composable (`atoms` / `molecules` / `organisms`) ; le `title` sert à
**trouver** un composant dans la barre latérale. Ce ne sont pas le même besoin, et les faire
coïncider donnait quatorze entrées à plat où l'on cherchait un bouton entre un gabarit de page et
un prix. Cinq groupes, décidés le 2026-09-02 :

| Groupe | Contenu |
|---|---|
| `Actions/` | `Button`, `IconButton`, `LinkButton`, `BackLink` |
| `Saisie/` | `Field`, `Textarea`, `Select`, `Checkbox` |
| `Affichage/` | `Price`, `TypeBadge`, `Image`, `Title` |
| `Structure/` | `PageShell`, `Card` |
| `Playground/` | les stories de référence — jetons, palettes, sémantique |

Un nouveau composant rejoint le groupe qui décrit **ce qu'il fait**, quel que soit son dossier. Si
aucun ne convient, c'est une conversation, pas un sixième groupe créé au passage.

⚠️ Si le `title` contient un accent, ajouter un `id` explicite **sans accent** dans le `meta` :
Storybook dérive sinon l'identifiant du titre en conservant les accents, ce qui produit une URL
fragile.

Le playground se lance avec `npm run storybook` (port 6006) et **découvre les stories par glob** :
aucun fichier central à modifier. Le gabarit **Mobile 390 est actif par défaut**, et la barre
d'outils permet de basculer la langue (es/en) et le thème (vitrine/admin).

## Travailler à plusieurs agents

Voir `hifago/AGENTS-PARALLELES.md`, section « Agent qui crée des composants ». En résumé : un agent
= un dossier + un namespace i18n ; on ne crée jamais un atome qui n'est pas dans son périmètre ; on
n'ajoute aucune dépendance ; on ne lance pas son propre serveur sur les ports 3100 / 6006.

## Deux constats à connaître, non corrigés

- ⚠️ **Le thème `vitrine` ne définit aucun token.** Il tourne sur les défauts HeroUI (le thème
  `admin` en définit ~37). Voir la story `Playground/Tokens` pour ce qui est réellement en vigueur.
- ⚠️ **Les polices Geist ne sont pas appliquées.** `app/[locale]/layout.tsx` définit
  `--font-geist-sans`/`--font-geist-mono`, alors que HeroUI et Tailwind consomment `--font-sans` et
  `--font-mono` : les noms ne correspondent pas, la vitrine est en pile système. Constaté le
  2026-09-01, signalé, hors périmètre du lot.
