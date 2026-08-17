# Tests pgTAP — `supabase/tests/database/`

22 fichiers `*.test.sql`. 21 couvrent chacun un domaine précis (RLS, contraintes, logique
séquentielle des RPC) : policies RLS, invariants d'identité, audit log, cycle de vie des
propositions/commandes, disponibilité produit, réconciliation PMS, etc. Le 22ᵉ,
`rls_rpc_only_checklist.test.sql`, est différent : il interroge le catalogue système et vérifie un
invariant sur **tout** le schéma `public` d'un coup (aucune mise à jour requise à l'ajout d'une
nouvelle table/fonction conforme) — voir son en-tête pour le détail des 3 points couverts de la
checklist RLS/RPC-only de `.claude/skills/hifago-migration/SKILL.md`.

**Jamais utilisés pour la concurrence** (`create_order`, réservation) : chaque fichier `pg_prove`
tourne dans une transaction annulée en rollback, structurellement incapable de simuler une vraie
concurrence — voir `hifago/CLAUDE.md` §6 point 3. La suite de concurrence dédiée
(`tests/concurrency/*.concurrency.mjs`, barrière de synchronisation) reste le seul outil valide
pour ça.

## Lancer localement

```
npm run test:db
```

(depuis `hifago/`, alias de `supabase test db`). Nécessite la stack Supabase locale
(`npx supabase start` / `/hifago-dev`) — comme tout le reste de `/hifago-test`, jamais un projet
cloud partagé.

## Statut CI

**Pas encore branché.** `hifago/.github/workflows/hifago-ci.yml` échoue avant même de lancer
`supabase start` dans son job `integration` (préalable indépendant de cette suite) — brancher
`npm run test:db` en CI est bloqué par ce préalable, hors périmètre de la restructuration
doc/process qui a créé ce fichier.

## État constaté au branchement (2026-08-15)

Cette suite (les 21 fichiers historiques) existait déjà mais n'était référencée dans aucun script
npm, aucune étape CI, aucune étape de `/hifago-test` — jamais exécutée par rien d'automatisé.
Premier run réel effectué lors du branchement : **5 fichiers sur 21 échouent** (9 sous-tests en
échec sur 365 au total) :

- `admin_audit_log.test.sql` (3 échecs)
- `catalog_rls.test.sql` (2 échecs)
- `partner_offboarding_rpc.test.sql` (2 échecs + désaccord de plan « 25 tests annoncés, 24 exécutés »)
- `product_availability_rpc.test.sql` (1 échec)
- `set_product_availability_socio.test.sql` (1 échec)

Motif récurrent sur plusieurs échecs : une assertion attend **aucune** ligne `audit_log` créée par
un appel refusé (`want: 0`) mais en trouve 85 — signe probable d'un `count(*)` non filtré par
timestamp/scope entre deux assertions du même fichier, plutôt qu'un vrai bug applicatif (à
vérifier). **Non corrigé ici** : ce sont des tests dormants, jamais rejoués depuis leur écriture —
les corriger est un vrai chantier de diagnostic (bug de test ou bug applicatif réel à trancher
fichier par fichier), distinct de la restructuration doc/process qui a remis cette suite en
circulation. Signalé au backlog.

Le 22ᵉ fichier (`rls_rpc_only_checklist.test.sql`, ajouté par cette même restructuration) passe
intégralement contre le schéma actuel — vérifié aussi en négatif (fonction `SECURITY DEFINER` sans
`search_path=''` injectée temporairement dans une transaction annulée : le test la détecte bien).
