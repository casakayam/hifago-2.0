# À coller en tête du prompt d'un agent lancé en parallèle d'autres

Ce texte n'est lu par aucun agent automatiquement — c'est un bloc que Jérôme colle à la main au
début du prompt de CHAQUE agent, quand plusieurs tournent en même temps sur des specs séparées
dans `hifago/`. Objectif : que l'agent sache qu'il n'est pas seul avant de commencer, pas après
avoir cassé le travail d'un autre.

---

## Bloc à coller (copier tel quel, puis enchaîner avec la tâche réelle)

```
Tu n'es pas seul sur ce dépôt. D'autres agents travaillent peut-être EN CE MOMENT MÊME sur
d'autres specs, dans le même répertoire de travail hifago/, avec la même instance Supabase locale.
Avant de commencer, et à chaque fois que quelque chose semble incohérent avec ce que tu attendais :

1. Lire `hifago/CLAUDE.md` §12 (Curseur) puis, si besoin de plus de contexte, le dernier fichier de
   `hifago/docs/journal/` — une autre session a peut-être livré quelque chose depuis ta dernière
   lecture du repo.
2. Avant de créer une migration : `ls supabase/migrations/ | tail -5` pour repérer un timestamp
   très récent posé par une autre session en cours, et éviter toute collision de nom/ordre.
3. Ne JAMAIS lancer `supabase db reset` (ou `/hifago-test` sans argument, qui le fait aussi via la
   suite complète) sans te demander si une autre session a des données en cours sur cette même
   instance locale — un reset efface tout, y compris son travail. En cas de doute, préférer
   `/hifago-test <fichier(s) que tu touches>` (mode ciblé) plutôt que la suite complète.
4. Avant d'éditer un fichier transverse (nav, layout, composant partagé dans `packages/ui`, page
   d'accueil, un formulaire déjà réutilisé ailleurs) : `git status`/`git diff` d'abord — vérifier
   qu'une autre session n'a pas déjà une modification en cours dessus. Une double-édition
   concurrente le même jour sur le même fichier est déjà arrivée sur ce projet
   (`hifago/docs/journal/2026-08.md`, specs 03/04).
5. Dans un test, ne jamais sélectionner un enregistrement seedé PARTAGÉ par son nom affiché à
   l'écran — une autre session peut le renommer en testant sa propre spec au même moment (déjà
   arrivé : contamination croisée entre `admin-product-price-tiers.spec.ts` et
   `admin-establishment-edit.spec.ts`, cf. le journal). Créer une fixture dédiée à ton propre test.
6. Si ta tâche touche une fonction/un chokepoint centralisé (`is_admin()`, `has_capability()`, un
   garde d'authentification partagé, une policy RLS générique) : le rayon d'effet dépasse ta seule
   spec — ça peut casser les tests ou l'accès d'une autre session en cours. Le signaler avant de
   modifier, ne pas supposer que ça n'affecte que toi (un rollout de 2FA a déjà bloqué une autre
   session en cours de vérification sur ce projet).
7. Si `npm install`/le typecheck échoue sur une dépendance qui te semble absente : lancer
   `npm install` (le lockfile fait foi) avant de suspecter ta propre spec — une autre session a
   probablement ajouté une dépendance entre-temps.
8. En fin de tâche, si tu as croisé un aléa de concurrence (fichier modifié sous toi, test cassé
   par un autre lot, reset qui t'a fait perdre du travail) : le consigner explicitement dans ton
   entrée de journal, jamais le passer sous silence — ça évite à la session suivante de le
   redécouvrir à l'aveugle.

Tâche réelle à partir d'ici :
```

## Pourquoi ce fichier existe

Le journal de session (`hifago/docs/journal/2026-08.md`) documente déjà plusieurs collisions
réelles entre sessions concurrentes sur ce dépôt (édition simultanée de
`NewEstablishmentForm.tsx`, désynchronisation `node_modules`/`package-lock.json`, rollout 2FA
cassant les tests d'une autre session, contamination croisée entre deux specs partageant un
établissement seedé). Ce ne sont pas des cas isolés : lancer plusieurs agents en parallèle sur ce
repo est un mode de travail normal ici, donc chaque agent doit démarrer en le sachant, au lieu de
le découvrir en marchant sur le travail d'un autre.
