# Vague 2 — Agent B : le thème de la vitrine, clair et sombre

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-01. Agent A tourne en même temps sur le Button : périmètres disjoints.

---

```
Tu donnes une identité visuelle à la vitrine hifago (apps/web), en clair ET en sombre, et tu rends
les deux basculables dans Storybook.

UN AUTRE AGENT TRAVAILLE EN CE MOMENT MÊME dans le même répertoire de travail, sur
`apps/web/components/atoms/Button.tsx`. Il n'y a pas de merge git entre vous : si vous écrivez dans
le même fichier, vous vous écrasez en direct. Tu ne touches à AUCUN composant.

## 0. Le problème, en une phrase

⚠️ **Le thème `vitrine` ne définit AUCUN jeton.** Vérifié : `packages/ui/src/styles/globals.css`
contient un bloc `[data-theme="admin"]` d'une centaine de lignes (~37 jetons, palette « Argile »
tranchée par Jérôme le 2026-08-15, documentée dans `docs/specs/09-design-system-admin.md`) — et
**rien du tout pour `vitrine`**, qui tourne donc sur les défauts de HeroUI. Le commentaire en tête
du fichier dit « valeurs par défaut de HeroUI conservées » : c'était un choix par omission, jamais
une décision.

Il n'existe par ailleurs **aucun mode sombre nulle part** : `color-scheme: light` est la seule
mention de la question dans tout le dépôt.

## 1. À lire avant d'écrire la première ligne

1. `hifago/AGENTS-PARALLELES.md` — les deux blocs.
2. `hifago/docs/specs/09-design-system-admin.md` — **le précédent qui fait méthode**. Trois pistes
   visuelles avaient été comparées puis tranchées par Jérôme. Tu reproduis la démarche, pas la
   palette : l'admin est un back-office dense en terracotta sur beige, la vitrine vend des
   activités à Guatapé. ⚠️ Jérôme a dit explicitement : « oublie l'admin, c'est juste pour le web ».
3. `hifago/packages/ui/src/styles/globals.css` — le bloc admin, comme modèle de STRUCTURE (quels
   jetons existent, comment ils sont commentés et justifiés).
4. `hifago/apps/web/components/playground/Tokens.stories.tsx` — la story qui lit les custom
   properties réellement calculées. C'est ton instrument de mesure et ta preuve.

## 2. Ton périmètre exclusif

packages/ui/src/styles/globals.css        ← tu AJOUTES des blocs, tu ne touches pas à l'existant
apps/web/.storybook/preview.tsx           ← la bascule clair/sombre dans la barre d'outils

Plus, si tu en as besoin pour montrer ton travail :
apps/web/components/playground/Palette.stories.tsx   ← une story de comparaison (nouvelle)

## 3. Ce que tu ne fais PAS

- ⚠️ **Tu ne touches à AUCUN composant** — ni `apps/web/components/atoms/**` (l'agent A y écrit en
  ce moment), ni `packages/ui/src/components/**`. Ton travail est entièrement dans les jetons : si
  tu as besoin de modifier un composant pour que ta palette rende bien, c'est le signe que la
  palette est fausse, pas le composant.
- ⚠️ **Tu ne casses pas l'admin.** Le bloc `[data-theme="admin"]` reste intact, au jeton près.
  `apps/admin` est en préprod et tourne. Vérifie-le explicitement avant de rendre.
- **Aucune dépendance ajoutée.**
- **Pas de `components/README.md`, pas de `CLAUDE.md`, pas de journal.**
- **Tu ne lances aucun serveur.** 3100 et 6006 tournent chez Jérôme. Besoin d'un rendu :
  `npx storybook dev -p 6007`, arrêté en partant.
- **Tu ne commites pas.**

## 4. Le travail

### 4.1 Décider de la direction visuelle — en proposant, pas en imposant

Jérôme n'a pas donné de direction. **Ne choisis donc pas à sa place : propose-lui à voir.** Monte
**trois pistes** cohérentes et réellement différentes, sur les mêmes composants, exactement comme
ça avait été fait pour l'admin. Il tranche à l'œil, dans Storybook.

Ce que tu sais du contexte, et qui doit nourrir les trois pistes : une vitrine publique qui vend des
activités, hébergements, transports et événements à Guatapé (Colombie) ; l'objectif est la
conversion ; la clientèle est hispanophone et anglophone ; **on réserve depuis un téléphone**.

### 4.2 Le mode sombre — la vraie demande

Chaque piste doit exister en **clair et en sombre**. Ce n'est pas un habillage : c'est ce que Jérôme
a demandé à pouvoir tester.

Questions à trancher et à documenter (pas à laisser implicites) :
- Par quel mécanisme ? Un `[data-theme="vitrine-dark"]`, un `.dark` en plus de `[data-theme]`, ou
  `prefers-color-scheme` ? ⚠️ Le sélecteur retenu doit fonctionner **à la fois** en production (le
  thème est posé sur `<html>` par `app/[locale]/layout.tsx`) **et** dans Storybook, où c'est
  `withThemeByDataAttribute` qui pose l'attribut. Regarde comment `preview.tsx` s'y prend
  aujourd'hui avant de choisir.
- `color-scheme` doit suivre, sinon les contrôles natifs du navigateur (barres de défilement,
  sélecteurs de date) restent clairs sur fond sombre.
- ⚠️ **Un mode sombre n'est pas un mode clair inversé.** Les aplats saturés qui portent bien un
  texte sur fond blanc deviennent souvent illisibles sur fond sombre, et les ombres n'y servent à
  rien — c'est la profondeur des surfaces qui prend le relais.

### 4.3 Mesurer, pas juger à l'œil

⚠️ C'est la partie qui rend ton travail vérifiable plutôt qu'opinable. Sur chaque piste et **dans
les deux modes**, mesure les contrastes WCAG des couples qui comptent : texte sur fond de page,
texte sur carte, texte discret (`--muted`), bordures de champ, et le texte de chaque couleur
d'accent sur son propre aplat. Seuil : **4.5:1** pour le texte, **3:1** pour un élément d'interface.

Le précédent est instructif : sur la vague 1, une combinaison à **4.17:1** paraissait parfaitement
correcte à l'œil et a été écartée à la mesure. Rapporte les chiffres, y compris ceux qui t'ont fait
écarter un choix.

### 4.4 Deux défauts connus, à traiter si c'est ton périmètre

- ⚠️ **Les polices Geist ne sont pas appliquées** — `app/[locale]/layout.tsx` définit
  `--font-geist-sans`/`--font-geist-mono`, alors que HeroUI et Tailwind consomment `--font-sans` et
  `--font-mono`. Les noms ne se rejoignent nulle part : la vitrine tourne en pile système depuis
  toujours. C'est un bug de jetons, donc ton périmètre — mais il touche `layout.tsx`. **Signale-le
  et propose le correctif, ne l'applique pas sans le dire** : un changement de police change tout
  le rendu, et Jérôme doit le voir venir.
- La typographie fait partie de l'identité au même titre que la couleur : si une piste appelle une
  autre police, dis-le. Rappel : le thème n'a pas de dépendance à ajouter, `next/font` est déjà là.

## 5. La story de comparaison — c'est le livrable que Jérôme regarde

Il doit pouvoir, **sans lire une ligne de CSS** : voir les trois pistes sur les mêmes éléments,
basculer clair/sombre, et trancher.

- Les trois pistes côte à côte, ou basculables, sur un échantillon représentatif : fond de page,
  carte, titre, texte courant, texte discret, boutons, champ de formulaire, badge.
- La bascule **clair/sombre** opérante dans la barre d'outils, pour chaque piste.
- Les jetons réellement calculés, avec leur contraste mesuré affiché à côté — `Tokens.stories.tsx`
  fait déjà la lecture, appuie-toi dessus.
- ⚠️ **Le rendu mobile compte autant** : gabarit Mobile 390 par défaut, on réserve au téléphone.

## 6. Vérification avant de rendre

Depuis `hifago/` :

    npm run typecheck --workspaces
    npm run lint --workspaces
    npm run test --workspaces
    npm run build --workspace=apps/web
    npm run build --workspace=apps/admin      ← ⚠️ celui-ci prouve que tu n'as pas cassé l'admin
    bash scripts/check-design-system.sh

Puis au rendu réel : les trois pistes, en clair et en sombre, aux gabarits Mobile 390 et
Desktop 1280, panneau **a11y** sans violation, et **le thème admin visuellement inchangé**.

## 7. Ce que tu me rends

1. Les fichiers touchés, et pour `globals.css`, ce que tu as AJOUTÉ (rien ne doit avoir été modifié
   dans le bloc admin — montre-le).
2. **Les trois pistes** : le parti pris de chacune en une phrase, et ce que chacune sacrifie.
3. **Le mécanisme retenu pour le mode sombre**, et pourquoi celui-là plutôt que les autres.
4. **Tous les contrastes mesurés**, dans les deux modes, y compris ceux qui t'ont fait reculer.
5. Ta recommandation sur les polices Geist, non appliquée.
6. Ce que tu as constaté sans corriger.
7. Le résultat exact des commandes du §6, sorties à l'appui.

Tu ne commites pas.
```
