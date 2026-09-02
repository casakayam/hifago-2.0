# Vague 2 — Agent A : le Button de la vitrine

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-01. Agent B tourne en même temps sur le thème light/dark : périmètres disjoints.

---

```
Tu construis LE bouton de la vitrine hifago (apps/web) : une surcouche au-dessus du Button de
HeroUI v3. C'est le premier composant du design system, celui sur lequel Jérôme jugera tous les
autres. Il doit être exhaustif et regardable dans Storybook.

UN AUTRE AGENT TRAVAILLE EN CE MOMENT MÊME dans le même répertoire de travail, sur le thème
light/dark (packages/ui/src/styles/ et .storybook/). Il n'y a pas de merge git entre vous : si vous
écrivez dans le même fichier, vous vous écrasez en direct. Tu ne touches NI aux styles partagés, NI
à la configuration Storybook.

## 0. À lire avant d'écrire la première ligne

1. `hifago/AGENTS-PARALLELES.md` — les deux blocs.
2. `hifago/apps/web/components/README.md` — les conventions font foi.
3. `hifago/apps/web/components/atoms/` — les six atomes de la vague 1, livrés ce matin. Lis-en deux
   (`TypeBadge.tsx`, `PageShell.tsx`) : ils montrent le ton attendu pour les commentaires, la façon
   de justifier une décision, et le traitement du piège §11.16.

## 1. Ton périmètre exclusif — 3 fichiers

apps/web/components/atoms/Button.tsx
apps/web/components/atoms/Button.stories.tsx
apps/web/components/atoms/Button.test.tsx

Si tu conclus qu'un bouton circulaire mérite son propre composant plutôt qu'une prop (voir §3.5),
tu peux ajouter `IconButton.tsx` + ses deux fichiers. C'est la SEULE extension autorisée, et tu la
justifies dans ton rapport.

## 2. Ce que tu ne fais PAS

- ⚠️ **Tu ne migres AUCUNE page.** Les huit `<Button>` de `app/[locale]/**` restent tels quels.
  C'est ce qui permet à deux agents de tourner en parallèle. La bascule viendra après, quand
  Jérôme aura validé le composant.
- ⚠️ **Tu ne touches pas `packages/ui/src/styles/globals.css`.** C'est le fichier de l'agent B,
  qui y définit le thème light/dark PENDANT que tu travailles. Si tu as besoin de CSS, tu
  l'écris en classes Tailwind dans TON fichier — jamais dans les styles partagés.
- ⚠️ **Tu ne touches pas `apps/web/.storybook/**`.** Même raison : c'est l'agent B qui y ajoute la
  bascule light/dark.
- **Aucune dépendance ajoutée.** ⚠️ Piège vérifié : `lucide-react` est présent dans
  `node_modules` mais déclaré par `packages/ui`, PAS par `apps/web`. L'importer ici créerait une
  dépendance fantôme — exactement ce qui a cassé le build Vercel le 2026-08-23 (le hoisting npm
  local la masque, l'install scopée de Vercel la révèle). Voir §3.4 pour la parade.
- **Aucune clé i18n** : un atome ne traduit rien, il reçoit ses libellés.
- **Pas de barrel `index.ts`**, pas de `components/README.md`, pas de `CLAUDE.md`, pas de journal.
- **Tu ne lances aucun serveur.** `npm run dev` (3100) et Storybook (6006) tournent chez Jérôme.
  Si tu as besoin d'un rendu : `npx storybook dev -p 6007`, et tu l'arrêtes en partant.
- **Tu ne commites pas.**

## 3. Le composant

### 3.0 La trouvaille qui rend tout ça possible — lis-la avant de concevoir

Le `Button` de HeroUI v3 **n'a PAS d'axe couleur** : `buttonVariants` n'expose qu'un `variant` à
7 valeurs qui mélange forme et couleur (`primary`, `secondary`, `tertiary`, `outline`, `ghost`,
`danger`, `danger-soft`). Tel quel, « outline en vert » est impossible.

⚠️ **Mais son CSS passe par une indirection**, et c'est la clé de ce composant. Vérifié dans
`node_modules/@heroui/styles/dist/components/button.css` : chaque variante ne fait que poser quatre
custom properties, que la classe `.button` consomme ensuite.

```css
.button--outline { --button-bg: transparent; --button-bg-hover: var(--default);
                   --button-bg-pressed: var(--default); --button-fg: var(--default-foreground); }
.button--danger  { --button-bg: var(--danger); --button-bg-hover: var(--danger-hover);
                   --button-bg-pressed: var(--danger-hover); --button-fg: var(--danger-foreground); }
```

Donc **deux axes indépendants sont atteignables sans réécrire le bouton de HeroUI** : on garde sa
classe de base et on repose ces quatre variables selon la couleur demandée. À toi de vérifier par
quel mécanisme (classes Tailwind arbitraires, `style` inline sur les custom properties, ou classes
dédiées) — mesure, ne suppose pas.

Les familles de jetons qui existent : `--accent`, `--danger`, `--success`, `--warning`, `--default`,
chacune avec `-foreground`, `-hover`, et parfois `-soft` / `-soft-foreground`.

⚠️ **Tu ne définis AUCUN jeton toi-même** : l'agent B est en train de les poser pour light et dark.
Tu consommes `var(--accent)` & co, tu ne décides pas de leur valeur. C'est précisément ce qui fera
que ton bouton suivra le thème sans que tu y retouches.

### 3.1 Quatre types (la forme)

Décidés par Jérôme : quatre types visuels distincts, dans l'esprit `solid` / `outline` / `ghost` /
`soft`. Les noms exacts sont à toi, mais ils doivent décrire la FORME, jamais la couleur — c'est
tout l'intérêt de séparer les deux axes.

### 3.2 Les couleurs (l'axe que HeroUI n'a pas)

« X couleurs, à toi de voir » — décision déléguée. Prends celles qui ont un sens sur une vitrine qui
vend des activités, adossées aux familles de jetons listées ci-dessus. Justifie ton jeu dans le
commentaire d'en-tête : combien, lesquelles, et **pourquoi pas les autres**.

⚠️ **Mesure les contrastes, ne les choisis pas à l'œil.** L'agent B de la vague 1 a trouvé une
combinaison à 4.17:1 qui paraissait très bien — sous le seuil de 4.5:1. Toute combinaison
type × couleur que tu retiens doit passer, **texte comme bordure**, et tu rapportes les chiffres.

### 3.3 Trois ou quatre tailles

HeroUI en fournit trois : `sm` = `h-9` (36 px, `md:h-8` soit 32 px sur desktop), `lg` = `h-11`
(44 px, `md:h-10` soit 40 px), et `md` par défaut entre les deux.

⚠️ **Constat à traiter, pas à ignorer** : `components/README.md` exige une cible tactile ≥ 44 px, et
**seul `lg` l'atteint, uniquement sur mobile**. Mesure les trois hauteurs réelles aux deux gabarits,
dis ce que ça donne, et propose — soit une taille par défaut qui respecte la règle, soit une
exception argumentée. Ne corrige pas en silence et n'invente pas une quatrième taille juste pour
faire le compte : quatre seulement si tu peux dire à quoi elle sert.

### 3.4 L'icône

Le bouton doit pouvoir en porter une (avant, après, ou seule).

⚠️ **N'importe PAS `lucide-react`** (dépendance fantôme, cf. §2). La parade : le bouton reçoit
l'icône en prop `ReactNode` — c'est l'appelant qui fournit le glyphe. Tes stories utilisent des
`<svg>` inline. Le composant reste ainsi sans aucune dépendance d'icônes.

Une icône décorative accompagnée d'un libellé est `aria-hidden`. Un bouton **sans** libellé exige un
nom accessible : rends-le impossible à oublier par le type (`aria-label` requis dans ce cas), comme
`Image` de la vague 1 rend `alt` obligatoire. C'est le genre de contrainte qui fait la valeur d'une
surcouche.

### 3.5 Le bouton circulaire

Jérôme : « pouvoir le mettre en circle button, ou si c'est un autre composant en créer un autre ».
HeroUI fournit `isIconOnly` (classe `button--icon-only`), mais pas la forme ronde.

À toi de trancher : une prop `shape` sur `Button`, ou un `IconButton` séparé. **Choisis en fonction
de ce que ça coûte à l'appelant**, pas de l'élégance interne — un bouton rond sans libellé n'a ni
les mêmes exigences d'accessibilité ni les mêmes proportions qu'un bouton texte, ce qui plaide pour
la séparation ; mais deux composants à maintenir pour une différence de border-radius plaide contre.
Décide, argumente en une phrase dans ton rapport.

### 3.6 Les états — c'est ce que Jérôme veut voir

Défaut, survol, focus clavier, pressé, désactivé, et **en cours**.

⚠️ L'état « en cours » n'est pas décoratif, il absorbe une duplication réelle : quatre formulaires
d'`apps/web` (`CheckoutForm`, `LoginForm`, `SignupForm`, `OrdersList`) écrivent tous
`isDisabled={isSubmitting}` **plus** `{isSubmitting ? t("submitting") : t("submit")}`. Le composant
doit rendre ce couple inutile — une prop, et le libellé de remplacement reçu déjà traduit.

⚠️ Le focus clavier reste visible : ne retire jamais l'anneau de focus sans le remplacer.

## 4. La story — c'est le vrai livrable

C'est là-dessus que Jérôme juge. Elle doit lui montrer **tout**, d'un coup d'œil, sans qu'il ait à
manipuler des contrôles un par un :

- **La matrice complète** : chaque type × chaque couleur, en grille lisible et étiquetée.
- **Toutes les tailles**, côte à côte, avec leur hauteur réelle indiquée.
- **Tous les états** pour un type donné, y compris `désactivé` et `en cours`.
- **Avec icône** : avant, après, seule.
- **Le bouton rond**, si tu retiens cette forme.
- **Pleine largeur**, le cas mobile.
- ⚠️ **Une story cliquable** : Jérôme a demandé à « voir les actions ». Un bouton qui incrémente un
  compteur visible à l'écran suffit — il doit pouvoir constater que le clic atterrit, voir le survol,
  le focus au clavier et l'état pressé pour de vrai.

Noms d'exports en français (`Matrice`, `Tailles`, `Etats`, `AvecIcone`, `Actions`).

⚠️ **La bascule light/dark arrive dans la barre d'outils pendant que tu travailles** (agent B).
Vérifie ton rendu dans les deux dès qu'elle apparaît — un bouton qui ne tient qu'en clair n'est pas
fini. Si elle n'est pas encore là quand tu termines, dis-le et ne conclus rien sur le mode sombre.

## 5. Rappels d'anatomie

- `export function` nommé, jamais `export default`. Type de props nommé et exporté.
- ⚠️ **Pas de prop `className`** — c'est le cœur de la surcouche : les besoins passent par des props
  sémantiques. (`CheckoutForm.tsx:289` écrit aujourd'hui `className="w-fit"` sur un Button : c'est
  exactement le genre de chose qu'une prop doit remplacer.)
- ⚠️ **`"use client"` en tête, obligatoire** : ce fichier importe le barrel `@hifago/ui`, et un
  Server Component qui l'atteindrait ferait planter `next build` (CLAUDE.md §11.16, invisible au
  typecheck et au lint). Ton fichier devient le SEUL point d'entrée HeroUI du bouton pour toute
  l'app — c'est une des raisons d'être de cette surcouche.
- ⚠️ **Jamais de `tv()` écrit à la main** (README). Tu composes au-dessus de `buttonVariants` de
  HeroUI, tu ne le réimplémentes pas.
- `testId?: string` → `data-testid={testId}`. Commentaire d'en-tête qui dit **pourquoi**, daté.
- HeroUI s'importe uniquement depuis `@hifago/ui`, jamais `@heroui/react`.
- Dans les tests : pas de `@testing-library/jest-dom` dans ce monorepo, assertions DOM natives.
- ⚠️ Le bouton de HeroUI est un bouton react-aria : c'est `onPress`, pas `onClick`.

## 6. Vérification avant de rendre

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components/atoms
    npx vitest run components/atoms

Puis, au rendu réel : gabarits **Mobile 390** et **Desktop 1280**, modes clair et sombre si la
bascule existe, panneau **a11y** sans violation, aucun défilement horizontal.

## 7. Ce que tu me rends

1. Les fichiers créés.
2. **Tes trois décisions déléguées** : les quatre types et leurs noms ; le jeu de couleurs (combien,
   lesquelles, pourquoi pas les autres) ; prop `shape` ou `IconButton` séparé.
3. **Les contrastes mesurés**, chiffres à l'appui, et les combinaisons que tu as écartées.
4. **Les hauteurs réelles des tailles** aux deux gabarits, et ce que tu proposes face à la règle des
   44 px.
5. Par quel mécanisme tu as obtenu l'axe couleur, et ce que ça coûte.
6. Ce que tu as constaté sans corriger.
7. Le résultat exact des commandes du §6. Si quelque chose échoue, dis-le : un rapport qui annonce
   vert sur du rouge coûte plus cher que l'échec.

Tu ne commites pas.
```
