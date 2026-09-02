# Vague 3 — Agent A : les champs de saisie

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-02. D'autres agents tournent en même temps : périmètres disjoints.

---

```
Tu construis les champs de saisie de la vitrine hifago (apps/web) : une surcouche au-dessus des
primitives de formulaire de HeroUI v3.

D'AUTRES AGENTS TRAVAILLENT EN CE MOMENT MÊME dans le même répertoire de travail — l'un sur les
cartes et la galerie photo (`components/atoms/Card.*`, `LinkButton.*`, `PhotoStrip.*`), un autre
sur le thème (`packages/ui/src/styles/globals.css`, `.storybook/`). Il n'y a pas de merge git entre
vous : si vous écrivez dans le même fichier, vous vous écrasez en direct.

## 0. À lire avant d'écrire la première ligne

1. `hifago/AGENTS-PARALLELES.md` — les deux blocs.
2. `hifago/apps/web/components/README.md` — les conventions font foi.
3. ⚠️ `hifago/apps/web/components/atoms/Button.tsx` — **lis-le en entier avant de concevoir.** Il
   a été livré hier et il fixe le vocabulaire de cette surcouche : deux axes séparés, l'axe couleur
   obtenu en reposant les custom properties de HeroUI, `"use client"` obligatoire, pas de prop
   `className`, un défaut de taille aligné sur la cible tactile de 44 px. Tes champs doivent
   s'accorder avec lui, pas inventer une deuxième grammaire.

## 1. Ton périmètre exclusif

apps/web/components/atoms/Field.tsx        + .stories.tsx + .test.tsx
apps/web/components/atoms/Textarea.tsx     + .stories.tsx + .test.tsx
apps/web/components/atoms/Select.tsx       + .stories.tsx + .test.tsx
apps/web/components/atoms/Checkbox.tsx     + .stories.tsx + .test.tsx

## 2. Ce que tu ne fais PAS

- ⚠️ **Tu ne migres AUCUNE page.** Les formulaires existants restent tels quels. C'est ce qui rend
  le travail en parallèle possible.
- **Tu ne touches à aucun autre composant** — ni `Button.tsx`/`IconButton.tsx` (livrés, en lecture
  seule pour toi), ni `Card`/`LinkButton`/`PhotoStrip` (un autre agent les écrit en ce moment).
- ⚠️ **Tu ne touches pas `packages/ui/src/styles/globals.css` ni `apps/web/.storybook/**`** :
  l'agent thème y travaille en ce moment.
- **Aucune dépendance ajoutée**, aucune clé i18n (un atome ne traduit rien, il reçoit ses libellés).
- **Pas de barrel `index.ts`**, pas de `components/README.md`, pas de `CLAUDE.md`, pas de journal.
- **Tu ne lances aucun serveur** : 3100 et 6006 sont pris. `npx storybook dev -p 6007` si besoin,
  arrêté en partant.
- **Tu ne commites pas.**

## 3. Ce que chaque composant doit absorber — relevé dans le code, pas imaginé

### 3.1 Field — le plus rentable des quatre

`TextField` + `Label` + `Input` voyagent **toujours ensemble**, cinq fois, jamais l'un sans les
autres. Aujourd'hui, un champ s'écrit :

    <TextField name="email" value={email} onChange={setEmail} isRequired>
      <Label>{t("email")}</Label>
      <Input type="email" autoComplete="email" />
    </TextField>

Ton `Field` doit ramener ça à une ligne. Les cinq sites :
`SignupForm.tsx:76,80,84` · `CheckoutForm.tsx:375` · `LoginForm.tsx` ·
`CatalogBrowser.tsx:46` (recherche) · `ReservationForm.tsx:166`,
`LodgingReservationForm.tsx:542`, `SlotReservationForm.tsx:252` (quantité).

⚠️ **Quatre de ces sites passent un `className`** (`min-w-48 flex-1`, `max-w-32` ×3) — interdit par
le README. C'est une prop sémantique qui doit porter ce besoin, comme `width` sur `Button`. Regarde
les valeurs réelles avant de choisir le jeu de valeurs : elles disent ce dont les écrans ont besoin.

⚠️ Les types réels employés : `email`, `password`, `search`, et du numérique de quantité. Prends-en
note pour ce que `Field` doit savoir faire (`autoComplete`, `minLength`, `inputMode`) — sans
anticiper au-delà.

### 3.2 Le message d'erreur — la moitié manquante

HeroUI fournit `error-message`, `field-error` et `description`. **Aucun n'est utilisé dans
`apps/web` aujourd'hui** : les formulaires affichent leurs erreurs à part, à la main.

Un champ doit pouvoir porter son erreur et son texte d'aide, correctement reliés au champ pour un
lecteur d'écran (`aria-describedby` / `aria-invalid`). C'est une des vraies raisons d'être de cette
surcouche : la relation est facile à écrire de travers, et invisible quand elle l'est.

### 3.3 ⚠️ `noValidate` — un bug vivant, pas une précaution théorique

`CLAUDE.md` §11 point 11 documente un défaut constaté en test réel : un champ `isRequired` fait
bloquer la soumission par la validation NATIVE du navigateur, **avant** que `onSubmit` React ne
s'exécute — donc ni message inline ni toast, quelle que soit la qualité du code derrière. La règle
du projet est de poser `noValidate` sur tout `<form>` contenant un champ requis.

Vérifié aujourd'hui dans le code : **seul `SignupForm.tsx:75` porte `noValidate`.**
`CheckoutForm.tsx:374` ne l'a pas, et contient pourtant un champ `isRequired` (`holder-name`,
ligne 375). `LoginForm.tsx:40` non plus.

À toi de décider **où** cette règle doit vivre pour cesser d'être oubliée. Un composant `Form` qui
pose `noValidate` par construction en fait partie des réponses possibles — mais ça élargit ton
périmètre, donc propose-le, ne l'ajoute pas de toi-même. ⚠️ **Tu ne corriges pas les formulaires
existants** (pas de migration) : tu signales, et tu fais en sorte que le prochain ne puisse plus
tomber dedans.

### 3.4 Select — 15 lignes qui doivent en devenir une

`CatalogBrowser.tsx:58-80` : le filtre par type de produit occupe **quinze lignes** de
`Select` + `Select.Trigger` + `Select.Value` + `Select.Indicator` + `Select.Popover` + `ListBox` +
`ListBox.Item` + `ListBox.ItemIndicator`. C'est l'API compound de HeroUI, et c'est le meilleur
exemple du dépôt de ce qu'une surcouche apporte.

Ton `Select` reçoit une liste d'options (valeur + libellé déjà traduit) et une valeur sélectionnée.
⚠️ Il doit couvrir l'option « toutes » que le catalogue utilise (une entrée de valeur vide) — ne la
traite pas comme un cas particulier de l'appelant.

⚠️ Piège de test connu (`CLAUDE.md` §11 points 2 et 3) : le trigger d'un `Select` HeroUI v3 porte
`role="button"`, jamais `role="combobox"` ; et son `<select>` natif caché contient le texte de
TOUTES les options, sélectionnées ou non — une assertion sur le composant entier matche n'importe
quoi. Scoper à `[data-slot="select-value"]`.

### 3.5 Checkbox — 8 lignes

`CheckoutForm.tsx:388-396` : `Checkbox` + `Checkbox.Content` + `Checkbox.Control` +
`Checkbox.Indicator`. Même traitement.

⚠️ Piège de test (`CLAUDE.md` §11 point 5) : cliquer le wrapper racine d'un `Checkbox` HeroUI
**laisse l'état inchangé sans lever d'erreur** — un piège silencieux. Seul un clic sur
`.locator("input")` fonctionne. Vaut pour tes tests.

### 3.6 Textarea

⚠️ **Aucun consommateur aujourd'hui** — c'est une demande explicite de Jérôme pour le design
system, pas une extraction. Dis-le dans ton commentaire d'en-tête plutôt que de laisser croire
qu'il remplace quelque chose. Garde-le minimal, et accorde-le à `Field` : mêmes props de libellé,
d'erreur et de largeur, sinon les deux divergeront dès le premier écran qui les met côte à côte.

## 4. Contraintes communes

- ⚠️ **`"use client"` en tête de chaque fichier** : ils importent le barrel `@hifago/ui`, dont le
  graphe fait planter `next build` dès qu'il atteint un Server Component (CLAUDE.md §11.16,
  invisible au typecheck et au lint).
- **Pas de prop `className`** — c'est le cœur de la surcouche.
- **Cible tactile ≥ 44 px** (README). ⚠️ Mesure la hauteur réelle de tes champs aux deux gabarits
  et rapporte-la : sur le bouton, seule la taille `lg` atteignait 44 px, et le défaut a dû être
  changé pour ça. Ne suppose pas que les champs sont mieux lotis.
- **Jamais de `tv()` écrit à la main**. Tu composes au-dessus des primitives HeroUI.
- `export function` nommé, type de props exporté, `testId?` → `data-testid`, commentaire d'en-tête
  qui dit **pourquoi**, daté.
- Tests : pas de `@testing-library/jest-dom` dans ce monorepo, assertions DOM natives.

## 5. Les stories

Pour chaque composant : l'état par défaut, **rempli**, **en erreur**, **désactivé**, **requis**,
avec texte d'aide, et `TexteLong` (l'espagnol fait 20 à 25 % de plus que l'anglais — c'est lui qui
fait déborder les libellés).

⚠️ Une story **formulaire complet** qui met tes quatre composants ensemble : c'est la seule qui
montre s'ils s'accordent — alignement des libellés, espacement, largeur, hauteur de champ. Un
champ isolé peut être parfait et le formulaire illisible.

Noms d'exports en français. La bascule clair/sombre arrive dans la barre d'outils pendant que tu
travailles (agent thème) : vérifie tes champs dans les deux dès qu'elle apparaît.

## 6. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components/atoms
    npx vitest run components/atoms

Puis au rendu : gabarits **Mobile 390** et **Desktop 1280**, panneau **a11y** sans violation,
aucun défilement horizontal.

## 7. Ton rapport

1. Les fichiers créés.
2. Ta réponse au §3.3 : où doit vivre `noValidate` pour ne plus être oublié, et ce que tu
   recommandes pour `CheckoutForm`/`LoginForm` (que tu ne corriges pas).
3. Les hauteurs de champ mesurées aux deux gabarits, face à la règle des 44 px.
4. Comment tu as relié erreur et texte d'aide au champ, et comment tu l'as vérifié.
5. Toute divergence avec le vocabulaire de `Button.tsx`, et pourquoi.
6. Ce que tu as constaté sans corriger.
7. Le résultat exact des commandes du §6. Si quelque chose échoue, dis-le.

Tu ne commites pas.
```
