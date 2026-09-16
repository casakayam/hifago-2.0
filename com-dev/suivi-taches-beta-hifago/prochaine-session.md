# Tâches à traiter — grille de suivi Hifago 2.0

On attaque les tâches suivantes de la grille de suivi partagée (Fait/Attribué) :

- `<id-1>` — <rappel court optionnel, ex. "nav basse mobile">
- `<id-2>` — <rappel court optionnel>

<!-- Remplace les deux lignes ci-dessus par les vrais ids (visibles sous chaque ligne dans
l'interface, ex. cmp-4, pay-2) avant de coller ce fichier dans une nouvelle conversation. Ajoute
ou retire des lignes selon le nombre de tâches. -->

## Pour Claude

- **Ne lis pas toute la grille.** Pour le contenu de chaque tâche (Prototype vs réel, Verdict),
  cible juste sa ligne :
  `grep -A6 '"id-1"' "com-dev/suivi-taches-beta-hifago/index.html"` (remplacer `id-1` par chaque
  id ci-dessus, un grep par id).
- Contexte du projet et conventions : `com-dev/suivi-taches-beta-hifago/README.md`.
- Implémente le correctif dans le code normalement (specs/backlog/journal comme d'habitude).
- Une fois corrigé et vérifié : marque la ligne comme faite (et attribuée à qui l'a fait) via le
  skill `hifago-suivi-taches`, procédure B — donne-lui juste l'id, il ne relit ni le code source
  du fork ni les autres lignes.
