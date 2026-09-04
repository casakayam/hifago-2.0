# Vague 8 — les deux filtres du bloc de recherche (dates, nombre de personnes)

Tu travailles dans `hifago/apps/web`. Lis `hifago/CLAUDE.md` et
`apps/web/components/README.md` avant d'écrire une ligne. Réponds en français, commentaires en
français, **noms de composants et de props en anglais** comme tout le reste du dossier
(`SearchBarProps`, `ImageProps`, `PhotoStripProps`…).

Un seul agent sur ce lot. La raison : les deux filtres partagent **le même déclencheur à popover**.
Deux agents en parallèle en écriraient deux versions divergentes — c'est exactement la faute que le
découpage en vagues existe pour éviter.

---

## 1. Ce que tu construis, et rien d'autre

Trois familles de fichiers, **tous neufs** :

    apps/web/components/molecules/DateRangeField.{tsx,stories.tsx,test.tsx}
    apps/web/components/molecules/PeopleField.{tsx,stories.tsx,test.tsx}
    apps/web/components/organisms/SearchPanel.{tsx,stories.tsx,test.tsx}

`SearchPanel` assemble la barre de recherche existante et les deux filtres. Il n'y a **aucune page
à créer, aucune page à modifier, aucune requête à écrire**. Ce lot vit entièrement dans Storybook.

### Fichiers interdits — tu n'y touches pas, même « juste un peu »

- `apps/web/components/organisms/SearchBar.tsx` — livré hier, tu le **consommes tel quel**.
- `apps/web/components/molecules/Calendar.tsx` — livré hier, tu le **consommes tel quel**.
  ⚠️ Ses props sont en français (`jours`, `aujourdIso`, `libelles`) là où tout le reste du dossier
  est en anglais. C'est une incohérence connue, elle sera traitée séparément par le coordinateur :
  **tu ne la corriges pas**, tu t'y conformes au point de jonction.
- `packages/ui/**` — `Calendar` et la brique `DayPickerCalendar` sont aussi utilisés par
  `apps/admin`.
- `apps/web/messages/**` — voir §6 : ce lot n'ajoute **aucune clé de traduction**. C'est ce qui le
  rend sans collision avec n'importe quel autre agent.
- `package.json`, `package-lock.json` — aucune dépendance nouvelle. Tout est déjà là.
- `app/**`, `packages/ui/src/styles/globals.css`, `scripts/check-design-system.sh`, `CLAUDE.md`,
  le journal.

---

## 2. La disposition — tranchée par Jérôme, ne la rediscute pas

Les filtres se placent **sous la barre**, pas dans la pilule.

    DESKTOP (1280)
    ┌───────────────────────────────────────────────┐
    │ 🔍  ¿Adónde vas?              ( Buscar )      │
    └───────────────────────────────────────────────┘
      [ 📅 Fechas        ▾ ]  [ 👤 2 personas  ▾ ]

    MOBILE (390)
    ┌──────────────────────────┐
    │ 🔍  ¿Adónde vas?         │
    └──────────────────────────┘
     [ 📅 Fechas ▾ ] [ 👤 2 ▾ ]

Conséquence directe et voulue : **`SearchBar.tsx` n'est pas rouvert**. Les deux filtres sont ses
frères dans le bloc, pas des segments dans sa pilule.

Sur mobile la barre n'a pas de bouton « Rechercher » (décision de la vague 7 : la touche de
validation du clavier virtuel le remplace, d'où son `enterkeyhint="search"`). Les deux filtres,
eux, restent visibles aux deux gabarits — ce sont des contrôles, pas du contenu, et il n'y a aucune
raison d'en masquer un.

---

## 3. Le calendrier — tu réutilises celui qui existe

⚠️ **Décision prise, argumentée, non négociable dans ce lot :** `DateRangeField` **enveloppe**
`molecules/Calendar` en `mode="range"`. Tu n'écris **pas** une seconde grille, et tu n'emploies
**pas** `RangeCalendar` / `DateRangePicker` / `DatePicker` de HeroUI.

Trois raisons, dans l'ordre de force :

1. `CLAUDE.md` §2 point 2 : le calendrier react-aria/HeroUI a été évalué **deux fois** (2026-08-17,
   2026-08-29) et écarté sur le fond — le domaine est en nuits à sortie exclusive. Un filtre qui
   choisit une arrivée et un départ a exactement cette sémantique. Sujet clos.
2. `Calendar` a déjà payé ses corrections **mesurées** : cases remontées de 28 à 44 px, double
   opacité qui affichait le numéro d'un jour à 25 % (0,5 × 0,5 sur deux éléments emboîtés), et les
   libellés « Today, » / « , selected » que react-day-picker écrit **en anglais en dur** dans le nom
   accessible de chaque jour quelle que soit la locale. Une seconde grille les réintroduirait
   toutes, non mesurées.
3. Un seul langage visuel de calendrier sur le site.

Ce que Jérôme veut dire par « il faut que le calendrier soit différent de l'autre » est un
**usage** différent, pas un dessin différent : celui-ci ne connaît aucune disponibilité, il choisit
une date ou une plage. C'est précisément le contrat que `Calendar` expose déjà.

### 3a. Les deux manques réels de `Calendar`, et ce que tu en fais

**Les dates passées doivent être insélectionnables.** `Calendar` n'a pas de notion de date
plancher — et ce n'est pas un oubli : son en-tête dit qu'il ne connaît **aucune** règle métier, et
que c'est l'appelant qui déclare l'état de chaque jour. Interdire le passé est donc une règle
d'appelant, et l'enveloppe est l'appelant. Tu la tiens en deux gestes :

- `premierMoisIso = aujourdIso`, pour que la navigation ne puisse pas remonter avant le mois
  courant. ⚠️ **Vérifie que c'est vrai** — cette prop descend sur le `startMonth` de
  react-day-picker, et il faut constater que le bouton « mois précédent » est bien désactivé, pas
  le supposer.
- les jours du mois courant antérieurs à `aujourdIso`, énumérés dans `jours` avec
  `etat: "desactive"`. Trente entrées au maximum, calculées à partir de `aujourdIso`.

**Un seul mois affiché.** Une plage se choisit souvent sur deux mois côte à côte ; `Calendar` est
figé à un mois (`w-full max-w-sm`, `[--cell-size:2.75rem]`). **Hors périmètre de ce lot** : tu
restes à un mois, comme le calendrier de réservation, et tu le signales dans ton rapport comme
suite possible. Tu n'ajoutes pas de prop à `Calendar` pour ça.

### 3b. ⚠️ Le piège de largeur, à mesurer avant d'écrire les stories

`Calendar` vaut `max-w-sm`, soit **384 px**. Un gabarit mobile fait **390 px**. Une fois le padding
du popover ajouté, la grille **dépasse l'écran**. Le `w-full` de `Calendar` se résout contre le
popover, dont la largeur est dictée par son contenu : il n'y a donc personne pour la contraindre
si tu ne le fais pas.

Tu poses une largeur explicite sur le contenu du popover et tu **vérifies au rendu à 390 px qu'il
n'y a aucun défilement horizontal** — c'est le symptôme n°1 d'une largeur en dur, et le README
l'interdit.

---

## 4. Le popover — ce qui est déjà su, et ce qui reste à mesurer

`Popover` de `@hifago/ui` existe et se décline en `Popover.Trigger`, `Popover.Content`,
`Popover.Dialog`, `Popover.Heading`. C'est le `DialogTrigger` de react-aria.

⚠️ **Le précédent qui ne s'applique PAS ici, et qu'il faut donc désamorcer.**
`organisms/LanguageSwitcher.tsx` refuse délibérément `Dropdown`/`Popover` de HeroUI : mesuré en
rendu serveur le 2026-09-02, un popover fermé ne contient **aucun** de ses enfants dans le HTML
servi, et ce sélecteur-là contient des **liens** que Googlebot doit voir. Un filtre de recherche ne
contient aucun contenu indexable et aucun lien : le popover est donc parfaitement légitime ici.
**Écris cette distinction dans ton commentaire d'en-tête**, sinon le prochain agent « corrigera »
une décision en croyant appliquer la règle.

⚠️ **Le piège de contexte, déjà rencontré dans ce même bloc.** La vague 7 a mesuré que le `ComboBox`
de react-aria fournit un `ButtonContext` à **tout son sous-arbre** : le bouton « Buscar » placé
dedans devenait son déclencheur, avec `aria-label="Show suggestions"` et `tabindex="-1"`.
`Popover.Trigger` procède du même mécanisme — il injecte des props de pression dans son enfant.
**Mesure** ce que reçoit réellement l'atome que tu y places (`Button` ? `IconButton` ? un bouton
nu ?) : nom accessible, `aria-expanded`, `aria-haspopup`, présence dans l'ordre de tabulation. Si
l'atome n'accepte pas ces props, dis-le plutôt que de le contourner en silence.

À mesurer aussi, et à rapporter : `Échap` ferme-t-il ? le focus revient-il sur le déclencheur ? le
clic à l'extérieur ferme-t-il ? Tout cela est censé être gratuit avec react-aria — c'est justement
la contrepartie que `LanguageSwitcher` a dû écrire à la main. Constate-le.

---

## 5. Les trois contrats

Types en anglais, `"use client"` en **ligne 1** de chaque fichier qui importe `@hifago/ui`
(`CLAUDE.md` §11.16, et `scripts/check-design-system.sh` le vérifie désormais).

### `DateRangeField`

    export type DateRangeFieldProps = {
      /** La plage choisie. Réutilise le type exporté par Calendar — une seule forme de plage
       *  dans toute l'app. `fin` vaut `debut` au premier clic (acquis du 2026-08-29). */
      value: PlageCalendrier | null;
      onChange: (value: PlageCalendrier | null) => void;
      /** REQUIS. `todayInBogota()`, jamais l'heure du navigateur — même raison que Calendar. */
      aujourdIso: string;
      /** Ce qu'affiche le déclencheur quand aucune date n'est choisie. Déjà traduit. */
      placeholderLabel: string;
      /** Les libellés que Calendar exige (complet / selectionne / aujourdhui). Déjà traduits. */
      calendarLabels: CalendarLibelles;
      /** Locale date-fns, passée telle quelle à Calendar. Voir §5c. */
      locale?: …;
      isDisabled?: boolean;
      testId?: string;
    };

⚠️ `aujourdIso` est **requis**, exactement comme sur `Calendar`, et pour la même raison mesurée :
sans lui react-day-picker prend `new Date()` du **navigateur** — le bug du lot fuseau du 2026-08-28,
qu'aucune règle eslint ne peut voir puisqu'il vit dans une dépendance.

### `PeopleField`

Bâti sur `NumberField` de `@hifago/ui`, qui fournit `NumberField.Group`, `NumberField.Input`,
`NumberField.IncrementButton`, `NumberField.DecrementButton` — donc les boutons `−` / `+` sans les
écrire.

    export type PeopleFieldProps = {
      value: number | null;
      onChange: (value: number | null) => void;
      /** Défaut 1 : une recherche à zéro personne ne veut rien dire. */
      min?: number;
      max?: number;
      /** Ce qu'affiche le déclencheur quand aucun nombre n'est choisi. Déjà traduit. */
      placeholderLabel: string;
      /** Ce qu'il affiche quand un nombre l'est. Déjà traduit ET DÉJÀ ACCORDÉ — voir §6. */
      valueLabel?: string;
      /** Le libellé du champ DANS le popover. Déjà traduit. */
      fieldLabel: string;
      isDisabled?: boolean;
      testId?: string;
    };

Un popover pour celui-là aussi, alors qu'un pas-à-pas visible dans la rangée suffirait : c'est le
prix de la cohérence des deux déclencheurs que Jérôme a choisis (même forme, même chevron). Note
honnêtement dans ton rapport le clic supplémentaire que ça coûte — c'est à lui d'arbitrer s'il veut
revenir dessus.

⚠️ Mesure ce que `NumberField` rend vraiment : les deux boutons ont-ils un nom accessible ? font-ils
44 px ? que produit une saisie au clavier de `abc`, de `0`, d'un nombre au-dessus de `max` ? Le
`NumberField` de react-aria analyse les nombres **selon la locale** — vérifie qu'il se comporte bien
en `es` comme en `en`.

### `SearchPanel`

    export type SearchCriteria = {
      query: string;
      dates: PlageCalendrier | null;
      people: number | null;
    };

    export type SearchPanelProps = {
      criteria: SearchCriteria;
      onCriteriaChange: (criteria: SearchCriteria) => void;
      /** Reçoit TOUS les critères, pas seulement le texte. */
      onSubmit: (criteria: SearchCriteria) => void;
      suggestions: SearchSuggestion[];
      onSuggestionSelect: (suggestion: SearchSuggestion) => void;
      aujourdIso: string;
      labels: { … };
      testId?: string;
    };

⚠️ **Un objet de critères, pas trois props.** Un quatrième filtre (le type d'activité, déjà présent
dans `CatalogBrowser`, et dont Jérôme a dit qu'il aurait son propre lot) s'ajoute alors **dans le
type**, sans toucher aux signatures. C'est ce qui évite de rouvrir le composant à chaque filtre.

⚠️ **La jonction qui compte.** `SearchBar.onSubmit` reçoit **le texte tapé**, pas les critères : la
vague 7 a mesuré que `Entrée` seul ne déclenche rien dans un `ComboBox` et a écrit six lignes pour
que `Entrée` vaille « Rechercher ». `SearchPanel` reçoit donc ce texte et **le recombine** avec son
propre état de filtres avant d'appeler son `onSubmit`. Vérifie dans une story interactive que
`Entrée` au clavier soumet bien les **trois** critères, et pas seulement le texte.

⚠️ **Une conséquence à écrire, pas à découvrir.** `onSuggestionSelect` active une suggestion, qui
peut être un vrai `<a href>` (la vague 7 l'a prévu). Cette navigation **emporte le texte, pas les
dates ni le nombre de personnes** : atterrir sur une fiche produit perd les filtres. C'est assumé
pour ce lot — il n'y a pas encore de route de recherche — mais dis-le dans ton en-tête et dans ton
rapport.

### 5c. Le piège de locale, à ne pas mélanger

Deux notions de locale se croisent ici, et les confondre produit un bug silencieux :

- `Calendar` attend une locale **date-fns** (un objet) et n'en lit que `.code` pour ses libellés.
- Le formatage de la plage affichée sur le déclencheur veut une étiquette **BCP-47** (une chaîne).

Une seule prop, donc : la locale date-fns, dont tu tires `locale.code` pour le formatage. Vérifie
aussi ce qui se passe **quand elle est absente** (elle est optionnelle sur `Calendar`) et rapporte-le.

---

## 6. Zéro clé de traduction — et le seul cas qui résiste

Tous les libellés arrivent **déjà traduits en props**, comme sur `SearchBar`, `Calendar` et
`PhotoStrip`. Aucun fichier de `messages/` n'est touché : c'est ce qui rend ce lot compatible avec
n'importe quel autre agent en vol. Les stories fournissent leurs chaînes à la main.

⚠️ **Le pluriel ne peut pas être une chaîne.** « 1 persona » / « 2 personas » n'est pas du formatage,
c'est de la traduction accordée : seul `next-intl` sait le faire (`t("people", {count})`), et il vit
chez l'appelant. D'où `valueLabel` sur `PeopleField` : **l'appelant** le calcule, et il le peut sans
effort puisque l'état est contrôlé — il se recalcule à chaque changement.

⚠️ **La plage de dates, elle, est du formatage pur** — et il existe pour ça un outil exact :
`Intl.DateTimeFormat(locale.code, {…}).formatRange(debut, fin)`. Il rend « 3–7 de sept. » en
espagnol et « Sep 3 – 7 » en anglais, séparateur et ordre compris, sans qu'aucune chaîne ne
traverse les messages. **Mesure sa sortie réelle dans les deux locales et cite-la dans ton
rapport** — c'est ce qui sera affiché sur le composant le plus visible du site.

---

## 7. Accessibilité — les points non négociables

- ⚠️ **Le nom accessible d'un déclencheur inclut sa valeur courante.** « Fechas » seul ne dit pas à
  un lecteur d'écran que le 3 au 7 septembre sont déjà choisis : il faut « Fechas : 3–7 de sept. ».
  C'est la faute classique du motif déclencheur-plus-popover.
- Cibles tactiles ≥ 44 px : les deux déclencheurs, les deux boutons du pas-à-pas, chaque case du
  calendrier (`Calendar` s'en occupe déjà — vérifie que le popover ne la comprime pas).
- Le champ dans le popover « personnes » a un libellé **visible**.
- Navigation entièrement au clavier : atteindre chaque déclencheur par tabulation, ouvrir, parcourir,
  choisir, fermer, et retrouver le focus sur le déclencheur.
- Le panneau a11y de Storybook ne remonte **aucune violation** sur les stories livrées. S'il en
  remonte une qui vient des jetons du thème par défaut, c'est un résultat à **rapporter**, pas à
  masquer.

---

## 8. Les stories

Pour chaque composant : au repos, avec valeur, **popover ouvert**, désactivé, et le cas limite qui
lui est propre.

- `DateRangeField` : aucune date · une seule date choisie (`fin === debut`) · une plage · une plage
  qui enjambe deux mois · le mois courant avec ses jours passés éteints.
- `PeopleField` : vide · au minimum · au maximum · au-delà du maximum tenté au clavier.
- `SearchPanel` : vide · tout rempli · une story **interactive** qui affiche à l'écran les critères
  soumis — c'est le seul moyen pour Jérôme de vérifier de ses yeux que `Entrée` emporte bien les
  trois.
- Des libellés **longs en espagnol** (20 à 25 % de plus que l'anglais : c'est lui qui fait déborder).
- Les gabarits **390** et **1280**, les deux modes **clair/sombre**, et les cinq pistes visuelles.

---

## 9. Les deux pièges de test de ce dépôt

1. `CLAUDE.md` §11 point 7 : sur un `ComboBox` HeroUI, cliquer une option d'une liste **non
   filtrée** échoue par intermittence à committer la sélection (constaté le 2026-08-14). La parade
   vérifiée : **taper une requête d'abord**, puis cliquer l'option par son nom. `SearchPanel`
   contient un `ComboBox` : applique-la.
2. Le contenu d'un popover fermé **n'est pas dans le DOM** (§4). Tout test qui vise une case de
   calendrier ou un bouton de pas-à-pas doit **ouvrir le popover d'abord** — sinon il passe au vert
   en n'ayant rien vérifié, ce qui est pire qu'un échec.

---

## 10. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run

Puis, depuis `hifago/` :

    bash scripts/check-design-system.sh

Et au rendu réel : panneau a11y propre, parcours clavier complet, **aucun défilement horizontal à
390 px**.

---

## 11. Ton rapport

1. Les fichiers créés.
2. **Ce que `Popover.Trigger` injecte réellement** dans l'atome que tu y as mis — nom accessible,
   `aria-expanded`, `aria-haspopup`, ordre de tabulation. Mesuré, pas supposé.
3. `Échap`, clic extérieur, retour du focus : ce que react-aria a donné gratuitement, et ce que tu
   as dû écrire.
4. La largeur retenue pour le popover du calendrier à 390 px, et **la mesure** qui prouve l'absence
   de défilement horizontal.
5. Comment tu as éteint les dates passées, et **la constatation** que la navigation vers le mois
   précédent est bien bloquée.
6. La sortie exacte de `formatRange` en `es` et en `en`, et ce qui se passe sans locale.
7. Ce que `NumberField` rend : noms accessibles des deux boutons, taille tactile mesurée,
   comportement sur `abc`, sur `0`, au-delà de `max`, en `es` et en `en`.
8. Ce que le panneau a11y remonte, y compris ce qui vient du thème et que tu n'as pas corrigé.
9. Ce que tu as constaté sans corriger — en particulier tout ce qui appartient à `SearchBar.tsx` ou
   à `Calendar.tsx`, que tu n'as pas le droit de toucher.
10. Le résultat exact des commandes du §10.

Tu ne commites pas.
