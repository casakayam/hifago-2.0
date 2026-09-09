---
paths:
  - "**/*"
---

# Cadrage d'une tâche — quelle forme, quel effort (décidé le 2026-09-08)

⚠️ Cette règle est chargée à CHAQUE tour (`paths: **/*`) : la garder courte est une règle en soi.
Le récit qui l'a produite — les mesures des 2026-09-07/08, les budgets, les taux de réfutation —
est au journal, `docs/journal/2026-09.md` (entrée « corpus d'instructions dégraissé »).

**À CHAQUE nouvelle tâche, avant de commencer : annoncer en UNE ligne la forme retenue et l'effort,
et pourquoi.** Exemple : « Reconnaissance en parallèle (4 agents) puis j'écris seul — je ne sais pas
encore ce que porte `lib/reservas/`. » Si la forme change en cours de route, le dire aussi.

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

`max` est réservé aux situations où se tromper coûte une **survente réelle** (`CLAUDE.md` §4), pas
un écran mal affiché. Rien du chantier front n'y entre.

## Quatre choses à ne pas oublier

1. **L'effort ANNONCÉ n'est pas l'effort APPLIQUÉ** — en changer demande `/effort` côté Jérôme.
   L'annonce dit ce que la tâche mérite : une intention, pas une mesure. Le dire plutôt que
   laisser croire le contraire.
2. **Monter l'effort ne remplace jamais une vérification exécutée.** Ce qui attrape les défauts :
   la règle posée AVANT d'écrire, la mutation exécutée contre la vraie base, l'impression du rendu
   réel au lieu de sa supposition, le lint. Pas le niveau d'effort.
3. **Je ne peux pas changer l'effort de la session en cours**, seulement le recommander une fois —
   et le fixer pour les sous-agents que je lance (`effort` sur `agent()`).
4. **Ultracode ne s'allume pas d'ici** : Jérôme écrit « ultracode », ou le règle dans `/config`.
   Sans lui, pas de workflow sans demande explicite.

⚠️ **Aucune vérification mécanique** ne peut constater qu'une phrase de cadrage a été écrite — le
seul contrôle est humain, l'annonce étant visible en tête de réponse. Si elle commence à manquer,
c'est le signal que la règle est morte, pas qu'elle est respectée (`CLAUDE.md` §11.20).
