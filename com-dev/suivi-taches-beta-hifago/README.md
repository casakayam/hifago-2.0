# Suivi des tâches — Hifago 2.0 vs prototype mobile v2

Fork de `com-dev/grille-beta-test-hifago/` (2026-09-15) ajoutant le suivi d'exécution : qui fait
quoi, et si c'est fait. Sert Gabriel et Jérôme directement — pas un outil pour Claude, distinct de
`docs/backlog.md`.

- **Artefact publié** : https://claude.ai/code/artifact/c431c888-47ba-4f77-977a-28249b79afe0 — privé par défaut ; à partager à Jérôme depuis le menu Share de la page pour qu'il puisse cocher/attribuer lui aussi.
- **Fork de** : `com-dev/grille-beta-test-hifago/` (contenu `window.GRILLE` repris à l'identique,
  100 lignes, 17 sections) — voir ce dossier pour la méthode d'analyse complète.
- **Human check** (Validé/Invalidé/À revoir + commentaire) : hérité du fork, toujours modifiable
  ici, mais **indépendant** de l'artifact Claude.ai d'origine de Jérôme — les deux ne se
  synchronisent plus entre eux après le fork. Jérôme peut continuer à checker les lignes
  restantes ici ou sur son artifact d'origine, mais plus les deux à la fois.
- **Nouveau : Fait / Attribué** — partie vivante de ce document, pensée pour durer.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | La grille interactive : Human check hérité + colonnes **Fait** et **Attribué à** (Gabriel/Jérôme) ajoutées. S'ouvre directement dans un navigateur ; les modifications faites hors de claude.ai restent dans ce navigateur. |
| `review.json` | Les checks Human check bruts : `s` = statut (`ok` validé, `ko` invalidé, `rev` à revoir, vide = non tranché), `c` = commentaire, `t` = horodatage (ms). Seedé depuis le snapshot du 2026-09-15. |
| `taches.json` | Le suivi d'exécution : `done` = fait (bool), `who` = attribué à (`gabriel`/`jerome`/vide), `t` = horodatage (ms). Vide au départ. |
| `README.md` | Ce résumé. |

Filtres disponibles : Check (Human check), Verdict (structurant/notable/détail/équivalent/en plus/
à arbitrer), **Attribué** (Gabriel/Jérôme/non assigné) et **Avancement** (à faire/fait) — les deux
derniers combinables avec les précédents.
