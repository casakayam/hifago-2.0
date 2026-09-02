# Vague 1 — Agent B : données affichées

> Bloc à coller tel quel dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-01 par l'agent coordinateur. Agent A tourne **en même temps** sur trois autres
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
3. `hifago/CLAUDE.md` §2 (dont §2.1) et §11.16.

## 1. Ton périmètre exclusif — tu crées EXACTEMENT ces 9 fichiers, et rien d'autre

apps/web/components/atoms/Price.tsx
apps/web/components/atoms/Price.stories.tsx
apps/web/components/atoms/Price.test.tsx
apps/web/components/atoms/TypeBadge.tsx
apps/web/components/atoms/TypeBadge.stories.tsx
apps/web/components/atoms/TypeBadge.test.tsx
apps/web/components/atoms/Image.tsx
apps/web/components/atoms/Image.stories.tsx
apps/web/components/atoms/Image.test.tsx

## 2. Ce que tu ne fais PAS — lis cette section deux fois

- ⚠️ **Tu ne migres AUCUNE page existante.** Tu crées les atomes ; tu ne remplaces pas le code des
  pages qui les utiliseront. C'est précisément ce qui permet à deux agents de tourner en même
  temps : `app/[locale]/page.tsx` a besoin de composants venant des DEUX périmètres, donc le
  migrer serait le seul vrai point de collision. La migration est faite après, par le
  coordinateur, en une passe.
- **Tu ne crées aucun autre atome.** `PageShell`, `Title` et `BackLink` appartiennent à l'agent A
  et sont en cours d'écriture pendant que tu lis ceci. Si tu penses en avoir besoin, tu ne les
  crées pas : tu composes localement dans ta story et tu le signales dans ton rapport.
- ⚠️ **Tu ne touches pas à `packages/`.** Ni `@hifago/domain`, ni `@hifago/ui`. Le §3.2 explique le
  cas précis où tu vas être tenté — n'y cède pas, c'est une décision du coordinateur.
- **Aucun `index.ts` de réexport (barrel)** dans `components/`. C'est volontaire et documenté.
- **Aucune dépendance ajoutée** : ni `package.json`, ni le lockfile, ni `npm install`.
- **Aucune clé i18n, aucun fichier `messages/`.** Un atome ne traduit rien : il reçoit ses libellés
  déjà traduits en props.
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

### 3.1 Price — un montant en pesos colombiens

```tsx
export type PriceProps = {
  amountCop: number;
  /** "es" | "en" — le formatage monétaire dépend de la langue, pas l'atome. */
  locale: string;
  testId?: string;
};
```

⚠️ **Le formatage existe déjà : `formatCop` de `@hifago/domain`**
(`packages/domain/src/format/formatCop.ts`, mémoïsé par locale, 0 décimale). Il est déjà appelé
41 fois côté admin et 3 fois côté web. **Tu l'importes, tu ne réécris pas `Intl.NumberFormat`** —
un second point de vérité sur le formatage monétaire est exactement le genre de duplication que ce
lot doit supprimer, pas créer.

Rend un `<span>`. C'est tout : pas de label, pas de suffixe « / nuit », pas de prix barré. Ces
compositions appartiennent à `PriceBlock` (molecule, vague 2, agent C).

⚠️ **Tu ne gères PAS le cas `evento`.** Un evento porte un `price_label` en texte libre affiché tel
quel, jamais formaté en COP — c'est une règle métier (cahier des charges admin §3c), et
l'aiguillage vit déjà dans `app/[locale]/products/[slug]/page.tsx:234-237`, commenté. `Price`
formate des nombres, point. Ne lui ajoute pas de branche texte libre : elle déplacerait une
décision métier dans un atome de présentation.

Stories : `Defaut` (80 000), `Zero`, `GrandMontant` (12 500 000 — celui qui déborde), et une story
qui montre le même montant en `es` et en `en` côte à côte.

Test : que `Price` produit bien la sortie de `formatCop` pour la locale donnée. N'écris pas dans le
test la chaîne attendue en dur avec ses espaces insécables — l'implémentation d'`Intl` varie selon
la version de Node. Compare à `formatCop(...)`.

### 3.2 TypeBadge — le type d'un produit, lisible

```tsx
export type TypeBadgeProps = {
  /** Volontairement `string` et non une union — voir l'avertissement ci-dessous. */
  type: string;
  /** Déjà traduit — un atome ne traduit rien. */
  label: string;
  testId?: string;
};
```

**C'est le seul des six atomes qui n'extrait rien** : aucun badge de type n'existe aujourd'hui. Le
type d'un produit ne sert actuellement qu'à filtrer le catalogue, jamais à s'afficher sur une
carte. Tu le crées vraiment.

Construis-le sur **`Chip` de `@hifago/ui`** (HeroUI v3 ; rend un `<span>`, expose `color`, `size`,
`variant`). N'écris pas un `<span>` stylé à la main.

Les cinq types réels, relevés dans `app/[locale]/CatalogBrowser.tsx:27` (eux-mêmes tirés du CHECK
de `supabase/migrations/20260817160000_calendar_tranche0_fixes.sql`) :
`lodging`, `activity`, `transport`, `camp`, `evento`.

⚠️ **Pourquoi `type: string` et pas une union typée.** Cette union existe déjà **deux fois** dans le
dépôt : `apps/admin/lib/products/productTypeGating.ts:24` et la const `PRODUCT_TYPES` de
`CatalogBrowser.tsx`. En écrire une troisième aggrave le problème ; la remonter dans
`@hifago/domain` est peut-être la bonne réponse, mais c'est une décision d'architecture
(`CLAUDE.md` §2.1 : un module ne monte dans `packages/` que si sa double consommation est
**prouvée**), elle touche `packages/` que tu n'as pas le droit de modifier, et elle est réservée au
coordinateur. Donc : `type: string`, une table de correspondance type → couleur **dans ton fichier**,
et **un repli neutre pour tout type inconnu**. Un type ajouté en base ne doit jamais faire planter
une page publique.

⚠️ **Le libellé est toujours rendu, en toutes lettres.** La couleur est décorative et ne porte
jamais l'information à elle seule (README, accessibilité) : un badge qui ne serait qu'une pastille
verte est illisible pour un daltonien, un lecteur d'écran et un moteur d'indexation.

Stories : `Defaut`, `TousLesTypes` (les 5 côte à côte), `TypeInconnu` (prouve le repli),
`TexteLong` (un libellé espagnol long — l'espagnol fait 20 à 25 % de plus que l'anglais, c'est lui
qui fait déborder).

### 3.3 Image — `alt` et `sizes` rendus obligatoires par le type

```tsx
export type ImageProps = {
  /** `null` = pas de visuel : l'atome rend un substitut, jamais un trou. */
  src: string | null;
  /** REQUIS. "" est licite pour une image purement décorative — mais c'est un choix explicite. */
  alt: string;
  /** REQUIS. Sans lui, next/image sert l'image la plus grande à un téléphone. */
  sizes: string;
  ratio?: "4/3" | "16/9" | "1/1";
  testId?: string;
};
```

**Sa raison d'être tient dans deux mots-clés : `alt` et `sizes` non optionnels.** Le README exige
les deux ; tant qu'ils sont optionnels dans `next/image`, la règle n'est qu'un vœu. Ici le
compilateur la fait respecter. C'est le seul mécanisme du lot qui transforme une règle écrite en
règle vérifiée.

- À l'intérieur : `import NextImage from "next/image"` (renommé, sinon collision avec le nom du
  composant).
- **Mode `fill` uniquement**, dans un conteneur `relative` au ratio demandé (défaut `4/3`) —
  c'est le seul mode employé par les deux usages existants (`CatalogBrowser.tsx:98`,
  `EstablishmentDetailView.tsx`). ⚠️ **N'ajoute pas de mode `width`/`height` intrinsèque** :
  personne n'en a besoin aujourd'hui, et le README interdit d'anticiper.
- `src === null` → un bloc neutre au même ratio, pas un vide. Les deux appelants actuels écrivent
  chacun leur `product.imageUrl ? … : null` : centraliser ce substitut ici est la moitié de la
  valeur de l'atome.
- Le conteneur ne fixe **aucune largeur en dur** : `w-full`, il s'adapte à son parent.

Stories : `Defaut`, `SansImage` (`src: null`), `Carre`, `Panoramique`, et une story où l'image est
placée dans un conteneur étroit pour vérifier qu'elle ne déborde pas.

Test : que `src: null` rend le substitut et **aucune balise `<img>`**.

## 4. Rappels d'anatomie (le README fait foi, ceci est le condensé)

- `export function` nommé, **jamais** `export default`. Type de props nommé et exporté.
- ⚠️ **Pas de prop `className`** : zéro composant du dépôt n'en expose.
- Pas de `forwardRef`, pas de `React.FC`, pas de `displayName`.
- `testId?: string` → `data-testid={testId}`.
- Commentaire d'en-tête qui dit **pourquoi**, daté, avec renvoi à la décision.
- `cn` s'importe de `@hifago/ui`. **Jamais de `tv()` écrit à la main** : dans ce projet les
  variantes sont des classes BEM stylées par les tokens `[data-theme]`, pas des compositions
  Tailwind.
- HeroUI s'importe **uniquement** depuis `@hifago/ui`, jamais `@heroui/react` (ESLint + un
  garde-fou bloquant).
- Dans un test : `@testing-library/jest-dom` **n'existe pas** dans ce monorepo — assertions DOM
  natives uniquement.
- Story avec accent dans le `title` → ajouter un `id` explicite sans accent dans le `meta`.

## 5. Vérification avant de rendre

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components/atoms
    npx vitest run components/atoms

Puis, aux gabarits **Mobile 390** et **Desktop 1280** de Storybook : tes 3 composants rendent
stylés, le panneau **a11y** ne remonte aucune violation critique, et **aucune story ne provoque de
défilement horizontal**.

⚠️ Un point à regarder pour de vrai, pas à supposer : **le thème `vitrine` ne définit aucun token**
(le thème `admin` en définit ~37), donc `Chip` tourne sur les défauts HeroUI. Bascule le thème dans
la barre d'outils Storybook et dis-moi si les couleurs de `TypeBadge` tiennent le contraste en
vitrine. Si elles ne le tiennent pas, c'est un résultat à rapporter, pas à masquer.

## 6. Ce que tu me rends

Un rapport court, en français :
1. Les 9 fichiers créés.
2. Toute divergence par rapport aux contrats du §3, avec la raison. Ne corrige pas un contrat en
   silence.
3. Les atomes du périmètre de l'agent A qui t'ont manqué (`PageShell`, `Title`, `BackLink`) et
   comment tu as composé sans eux.
4. Ce que le panneau a11y remonte sur `TypeBadge` en thème vitrine.
5. Ce que tu as constaté et pas corrigé : les surprises du dépôt valent plus que le code.
6. Le résultat exact des commandes du §5, sorties à l'appui. Si quelque chose échoue, dis-le — un
   rapport qui annonce vert sur du rouge coûte plus cher que l'échec lui-même.

Tu ne commites pas.
```
