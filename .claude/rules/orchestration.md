---
paths:
  - "**/*"
---

# Cadrage d'une tâche — quelle forme, quel effort (décidé le 2026-09-08)

**À CHAQUE nouvelle tâche, avant de commencer : annoncer en UNE ligne la forme retenue et l'effort,
et pourquoi.** Exemple : « Reconnaissance en parallèle (4 agents) puis j'écris seul — je ne sais pas
encore ce que porte `lib/reservas/`. » Si la forme change en cours de route, le dire aussi.

## Pourquoi cette règle existe

Mesuré sur la session du 2026-09-07/08 : **170 agents** lancés en sept workflows. Deux constats.

- Les deux gros audits ont tué **60 % de leurs propres trouvailles** à la vérification (15 confirmées
  sur 40, puis 14 sur 24). Le mécanisme adversarial fonctionne — mais une bonne part du budget sert
  à fabriquer du bruit puis à le détruire.
- La construction de l'accueil à **7 agents** (3,2 Mo de transcript) écrivait du code dont *tous* les
  contrats de props étaient déjà figés : les agents exécutaient, ils ne décidaient rien. Et **les deux
  vrais défauts du lot ont été trouvés après coup, pas par eux** (le pluriel `valueLabel` qui ne
  pouvait pas venir de la page ; la resynchronisation du panneau sur l'URL qu'exigeait la spec).

À l'inverse, la **reconnaissance à 5 agents** (1,4 Mo, le plus petit budget de la journée) a trouvé
trois choses qui ont changé le plan avant la première ligne de code : aucune migration nécessaire,
deux modules déjà écrits, et un sixième fichier e2e concerné **dans l'autre app**.

## La table de décision

| La tâche | Forme | Effort |
|---|---|---|
| **Je ne sais pas ce qu'il y a dans le code** — balayer beaucoup de fichiers, ne garder que les conclusions | workflow de reconnaissance, 3-6 agents lecteurs, un par sous-système | `medium` |
| **Avant que Jérôme valide un lot** — revue adversariale, chercheurs puis réfuteurs payés pour détruire | workflow chercher → réfuter | chercheurs `high`, réfuteurs `xhigh` |
| **Conception, spec, arbitrage, diagnostic d'une panne** | seul | `xhigh` |
| **Écrire du code dont les contrats sont déjà fixés** | seul | `high` |
| **Mécanique** — lancer les tests, corriger un lint, mettre à jour le journal, committer | seul | `low` / `medium` |
| **Écrire une RPC anti-survente, diagnostiquer une race condition constatée** | seul | `max` |
| **Migration lourde, balayage répétitif sur des dizaines de fichiers disjoints** | workflow, un agent par fichier | `medium` |

**La règle courte** : orchestrer quand je ne sais pas encore ce qu'il y a dans le code, ou quand il
faut être sûr avant de valider. Jamais quand je sais déjà quoi écrire.

## Cinq niveaux, deux utilisés — et pourquoi (2026-09-08)

`low` · `medium` · `high` · `xhigh` · `max`. En pratique on se stabilise sur deux, pour une raison
mécanique : **changer d'effort demande une action de Jérôme** (`/effort`), donc personne ne bascule
six fois dans une session — on choisit un niveau en début de bloc et on y reste.

⚠️ **Conséquence à ne pas cacher : l'effort ANNONCÉ n'est pas toujours l'effort APPLIQUÉ.** Le
2026-09-08, la mise à jour du journal a été annoncée `medium` et a tourné à l'effort de la session.
L'annonce reste utile — elle dit ce que la tâche mérite — mais elle décrit une intention, pas une
mesure. Le dire plutôt que laisser croire le contraire.

`max` est réservé aux situations où se tromper coûte une **survente réelle**, pas un écran mal
affiché : une nouvelle RPC critique au sens de `CLAUDE.md` §4, ou une race condition constatée en
production. Rien du chantier front n'y entre.

## Ce qui attrape les défauts n'est pas l'effort (mesuré le 2026-09-08)

Sur la Tranche 1a de la spec 29 — une migration republiant une fonction de 300 lignes, faite à
`xhigh` —, **l'effort n'a rien trouvé**. Les défauts ont été attrapés par des méthodes :

- la règle posée AVANT d'écrire (« les 16 assertions existantes restent vertes sans être
  modifiées ») ;
- les **mutations exécutées** contre la vraie base : retirer la ligne corrigée fait rougir
  l'assertion attendue, et elle seule ;
- **imprimer le rendu réel** au lieu de le supposer (HeroUI rendait un `<ol>` sans `<nav>`) ;
- le **lint**, qui a refusé tout seul une écriture de ref pendant le rendu.

Le rendement marginal de l'effort est faible sur du code dont les contrats sont fixés ; celui de la
vérification est élevé à tous les niveaux. Monter l'effort ne remplace jamais une vérification
exécutée.

## Deux limites à dire franchement

1. **Je ne peux pas changer l'effort de la session en cours** — c'est `/effort` côté Jérôme. Je peux
   seulement le RECOMMANDER, et le fixer pour les sous-agents que je lance (`effort` sur `agent()`).
   Quand la table ci-dessus dit `xhigh` et que la session est plus bas, je le signale une fois.
2. **Ultracode** ne s'allume pas depuis ici non plus : Jérôme écrit « ultracode » dans sa demande, ou
   le règle dans `/config`. Sans lui, la règle par défaut du dépôt s'applique — pas de workflow sans
   demande explicite.

## Ce que cette règle n'a pas

⚠️ **Aucune vérification mécanique**, et c'est à dire plutôt qu'à cacher : le projet tient que « une
règle documentée que rien ne vérifie n'est pas une règle, c'est un souhait » (`CLAUDE.md` §11.20).
Aucun script ne peut constater qu'une phrase de cadrage a été écrite avant une tâche. Le seul
contrôle est **humain** : l'annonce est visible en tête de réponse, donc son absence se remarque.
Si elle commence à manquer, c'est le signal que la règle est morte — pas qu'elle est respectée.
