---
name: hifago-test
description: Lance les tests du nouveau stack Hifago — Vitest (unitaire), Playwright E2E, et la suite de concurrence anti-survente à barrière de synchronisation — toujours contre la stack Supabase locale, jamais un projet cloud partagé. Usage — /hifago-test (complet), /hifago-test unit, /hifago-test e2e, /hifago-test concurrence
---

# /hifago-test — lancer les tests du nouveau stack

⚠️ **Toutes les commandes de ce skill s'exécutent depuis `hifago/`**, racine du monorepo (dépôt
git séparé). Ce n'est pas une commodité : `test:db` et `test` existent AUSSI dans le
`package.json` de la racine, où ils lancent la suite de l'app **legacy**. Lancés du mauvais
répertoire, ils passent au vert en ayant testé autre chose.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| *(vide)* | pgTAP + Unitaire (en parallèle, aucune dépendance entre les deux) puis E2E, puis concurrence — réservé à la fin d'une feature/session |
| `unit` | Vitest seul |
| `e2e` | Playwright seul (contre un serveur Next.js local déjà démarré, cf. `/hifago-dev`) |
| `concurrence` | Suite de tests de concurrence sur toutes les RPC critiques existantes |
| `<fichier ou motif>` | Lance uniquement ce(s) fichier(s) — `vitest run <motif>` si `.test.ts(x)`, `playwright test <motif>` sinon (les deux outils supportent nativement un filtre par chemin/nom). **Pendant le développement d'une feature, préférer ce mode** à la suite complète (cf. `.claude/rules/tests.md`, proportionnalité du test) |

## Règle non négociable (`CLAUDE.md` §6.4)
Stack de test locale par défaut, jamais un projet cloud partagé. La seule exception documentée est
un job nocturne dédié
(`pms-nightly-contract-check`, spec 21) qui frappe le **compte réel Casa Kayam en lecture seule**
(`GET /rooms`/`GET /available-rooms`, jamais d'écriture) — **aucun sandbox LobbyPMS n'existe**
(confirmé, spec 21 §10 point 1 : LobbyPMS ne propose qu'un essai commercial de 15 jours, pas de
bac à sable API pérenne) — jamais par défaut, jamais en CI/en test (tout test automatisé de ce
connecteur passe par un serveur de fixtures local, cf.
`packages/e2e-support/src/pmsFixtureServer.ts` et `tests/pms-integration/`, jamais le vrai
LobbyPMS).

## Procédure

Étapes 0 et 1 n'ont aucune dépendance entre elles (Vitest ne touche aucune base, pgTAP annule
toujours ses transactions) — les lancer **en parallèle**, comme le fait déjà `hifago-init` pour
son lint/typecheck/unitaire de CI. Étapes 2 et 3, elles, écrivent de vraies lignes dans la même
base locale et doivent rester séquentielles après les deux premières.

0. **Base de données (pgTAP)** : `npm run test:db` (`supabase test db`) — policies RLS,
   contraintes, logique séquentielle (48 fichiers dans `supabase/tests/database/`, cf.
   `supabase/tests/database/README.md`). Ne remplace **jamais** un test de concurrence (point 3
   ci-dessous, cf. `CLAUDE.md` §6) : chaque fichier `pg_prove` tourne dans une transaction
   annulée en rollback, structurellement incapable de simuler une vraie concurrence.

1. **Unitaire (Vitest)** : `npm test` (= `npm run test --workspaces --if-present`). Le moteur
   de commission et toute logique métier
   dense doit être testé en fonction pure, sans mock Supabase — si un test unitaire dépend d'un
   mock du client `supabase-js`, c'est probablement un test d'intégration mal classé.

2. **E2E (Playwright)** : `npm run test:e2e`. Auth en test : jamais le vrai écran Google OAuth —
   login programmatique via l'API REST Supabase, session réutilisée en `storageState.json` par
   rôle (client/socio/admin). MFA/TOTP admin généré via `otplib`, jamais un vrai téléphone.

3. **Concurrence** : pour chaque RPC critique existante (celles créées via
   `/hifago-rpc-critique`), relancer son test de barrière de synchronisation. Même raison qu'au
   point 0 : jamais pgTAP pour cette catégorie de test.

## Ce qui est normal, ne pas le signaler comme un problème
- Un test E2E plus lent que les unitaires — normal, c'est un vrai navigateur piloté.
- La stack Supabase locale prend quelques secondes à démarrer au premier `npx supabase start` de
  la session — normal (téléchargement d'images Docker au tout premier lancement uniquement).
