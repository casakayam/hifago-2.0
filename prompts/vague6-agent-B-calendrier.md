# Vague 6 — Agent B : le calendrier

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.

---

```
Tu fais entrer le calendrier dans le design system de la vitrine hifago (apps/web).

UN AUTRE AGENT TRAVAILLE EN CE MOMENT sur les toasts (`components/organisms/SiteToaster.*`,
`packages/ui/src/styles/globals.css`). Périmètres disjoints — n'y touche pas.

## 0. ⚠️ CE QUE CE LOT N'EST PAS — lis-le avant tout le reste

Le calendrier de réservation existe déjà, et il n'est PAS à refaire.
`app/[locale]/products/[slug]/LodgingReservationForm.tsx` fait ~600 lignes et porte des règles
MÉTIER, pas de l'interface : nuits à check-out **exclusif**, `min_stay` ancré sur la nuit
d'arrivée, `lead_days` qui relève le plancher, interdiction d'enjamber une nuit pleine. Ces règles
ont coûté cher (journal des 2026-08-28 et 2026-08-29) et l'anti-survente en dépend.

⚠️ **Tu ne les déplaces pas, tu ne les recopies pas, tu ne les « généralises » pas.** Ce lot ne
touche à aucun formulaire de réservation.

⚠️ **Tu ne changes pas de bibliothèque.** `CLAUDE.md` §2 point 2 : le calendrier react-aria/HeroUI
a été évalué DEUX FOIS sur prototype réel (2026-08-17 puis 2026-08-29) et écarté, pour une raison
de fond — le domaine est en nuits à sortie exclusive, et aucune des deux bibliothèques ne sait
l'exprimer. Ne rouvre pas ce sujet.

**Ce que ce lot EST** : rendre le calendrier regardable dans Storybook, avec tous ses états
visuels, pour que Jérôme puisse le juger et le voir tenir dans les cinq pistes de thème. Aujourd'hui
c'est le seul élément d'interface important de la vitrine qu'on ne peut voir qu'en montant un
tunnel de réservation complet.

## 1. Ton périmètre exclusif

apps/web/components/molecules/Calendar.tsx + .stories.tsx + .test.tsx

`molecules/` existe déjà. Story sous `"Saisie/Calendar"` — le `title` ne suit PAS le dossier, c'est
la convention écrite dans `components/README.md`.

## 2. À lire d'abord

1. `packages/ui/src/components/legacy-calendar.tsx` — **la brique existante**, en entier. Elle
   exporte `DayPickerCalendar` et `DayPickerCalendarDayButton`, réexportés par `@hifago/ui`. Son
   en-tête explique pourquoi elle est indépendante de HeroUI.
2. `app/[locale]/products/[slug]/LodgingReservationForm.tsx` — **en lecture seule**, pour voir
   comment le calendrier est réellement habillé aujourd'hui : les modificateurs posés sur les jours,
   le `DayButton` personnalisé qui affiche les places restantes, les classes d'état.
3. `hifago/apps/web/components/README.md` — les conventions.

## 3. Le composant

Une surcouche mince au-dessus de `DayPickerCalendar`, qui expose les **états visuels** d'un jour
sans rien connaître du métier :

- disponible · **complet** · sélectionné · dans la plage sélectionnée · désactivé · aujourd'hui ·
  hors du mois affiché ;
- le mode plage (`range`) et le mode jour unique, puisque les deux existent dans l'app
  (`LodgingReservationForm` est en plage, les deux autres formulaires ne le sont pas) ;
- l'information portée par un jour au-delà de sa date — aujourd'hui les places restantes.

⚠️ **L'appelant décide de l'état de chaque jour**, le composant ne le calcule jamais. C'est ce qui
garantit que les règles métier restent où elles sont. Une prop du genre « pour cette date, voici son
état et son étiquette » plutôt qu'une prop « voici les disponibilités, débrouille-toi ».

⚠️ **L'information n'est jamais portée par la seule couleur** (README) : une nuit complète doit être
reconnaissable autrement que par un gris — un mot, un chiffre, un motif. C'est déjà le cas dans le
formulaire existant (les places restantes s'affichent), garde ce principe.

⚠️ Cible tactile ≥ 44 px sur chaque jour cliquable. **Mesure-la à 390 px** : une grille de sept
colonnes sur un écran étroit est exactement l'endroit où cette règle casse. Rapporte le chiffre.

`"use client"` obligatoire : react-day-picker est un composant client, et l'import passe par le
barrel `@hifago/ui` (CLAUDE.md §11.16).

## 4. Deux pièges vérifiés de ce dépôt

⚠️ **Le modificateur d'un jour s'applique au `<td>`, pas au `<button>`.** Constaté le 2026-08-21 :
un test qui cherchait la classe « nuit pleine » sur le bouton ne la trouvait jamais. Ça vaut pour
tes tests et pour tes sélecteurs.

⚠️ **`legacy-calendar` importe `lucide-react`** — déclaré par `packages/ui`, pas par `apps/web`.
Tu passes donc par `@hifago/ui` et **tu n'importes jamais `lucide-react` directement** dans
`apps/web` : ce serait une dépendance fantôme, celle qui a cassé le build Vercel le 2026-08-23.

## 5. Ce que tu ne fais PAS

- ⚠️ **Aucune modification de `packages/ui/src/components/legacy-calendar.tsx`.** Si tu penses qu'il
  lui manque quelque chose, dis-le : c'est un composant partagé, et `apps/admin` l'utilise aussi.
- **Aucune modification d'un formulaire de réservation**, ni d'aucune page.
- **Aucune dépendance ajoutée**, aucune clé i18n (une molecule reçoit ses libellés en props).
- **Tu ne lances aucun serveur** : 3100 et 6006 sont pris. `-p 6007` si besoin, arrêté en partant.
- **Tu ne commites pas.**

## 6. Les stories — c'est le livrable que Jérôme regarde

- Un mois **avec tous les états représentés d'un coup** : c'est la story qui sert à juger.
- Une plage sélectionnée qui enjambe deux mois.
- Un mois **entièrement complet** (le cas limite le plus laid), et un mois entièrement libre.
- Les places restantes affichées sur les jours.
- ⚠️ Les gabarits **390 et 1280**, les deux modes **clair/sombre**, et les **cinq pistes** — un
  calendrier est une grille dense, c'est l'élément qui souffre le plus d'un contraste faible ou d'un
  rayon inadapté. Si une piste le rend illisible, c'est un résultat à rapporter, pas à masquer.
- Une story **dans un `PageShell`**, pas isolée : c'est là qu'on voit s'il tient dans la largeur.

Noms d'exports en français.

## 7. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run

Puis au rendu : panneau **a11y** sans violation — ⚠️ un calendrier est piégeux là-dessus (rôle de
grille, navigation au clavier, en-têtes de colonnes) — et aucun défilement horizontal à 390 px.

## 8. Ton rapport

1. Les fichiers créés.
2. **La forme d'API retenue** pour que l'appelant décide de l'état d'un jour, et pourquoi celle-là.
3. **La taille réelle d'une cellule à 390 px**, face à la règle des 44 px.
4. Ce que le panneau a11y remonte sur une grille de calendrier, et ce que tu en as fait.
5. Ce qui manque à `legacy-calendar` pour ce travail, si quelque chose manque — sans le modifier.
6. Quelle piste rend le calendrier le plus lisible, et laquelle le moins.
7. Le résultat exact des commandes du §7.

Tu ne commites pas.
```
