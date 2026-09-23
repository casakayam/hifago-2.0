---
id: pieges-empiriques
titre: "Pièges empiriques hifago — index numéroté"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-22
resume: >
  Les 22 pièges empiriques numérotés du chantier hifago. Déportés de CLAUDE.md §11 le 2026-09-09
  pour alléger le corpus chargé à chaque tour ; la numérotation fait foi et ne bouge pas, parce que
  le code, les migrations, les specs et le journal citent « CLAUDE.md §11.N ».
mots_cles: [pieges, index, heroui, playwright, supabase, numerotation]
repond_a:
  - "Que dit CLAUDE.md §11.N ?"
  - "Quel est le piège numéro N ?"
---
# Pièges empiriques — index numéroté

> **Cet index est la cible de `CLAUDE.md` §11.** La numérotation est FIGÉE : le code, les
> migrations, les scripts, `docs/specs/` et `docs/journal/` citent `CLAUDE.md §11.N`. Ne jamais
> renuméroter, ne jamais réutiliser un numéro libéré — ajouter à la suite.
>
> Chaque piège vit, **en prescription**, dans la règle `.claude/rules/*` chargée quand on touche les
> fichiers concernés : cet index dit où, il ne remplace pas la règle. Le récit complet est dans
> `docs/journal/`. Texte d'origine intégral : `git show f598a2d:CLAUDE.md` (l. 242-478).

1. Grants par défaut restrictifs (rôle `postgres`) → `.claude/rules/supabase.md`
2. `Select` HeroUI = `role="button"`, jamais `combobox` → `.claude/rules/tests.md`
3. `<select>` natif caché contient toutes les options → `.claude/rules/tests.md`
4. `Switch` : cibler l'`input`, `{ force: true }` → `.claude/rules/tests.md`
5. `Checkbox` : seul `.locator("input")` change l'état → `.claude/rules/tests.md`
6. Recharts : `"use client"` dans le fichier qui construit le graphique → `.claude/rules/apps.md`
7. `ComboBox` e2e : taper la requête avant de cliquer → `.claude/rules/tests.md`
8. `waitForLoadState("networkidle")` après navigation vers un écran client-heavy → `.claude/rules/tests.md`
9. `Toast.Provider` en sibling, jamais en wrapper → `.claude/rules/apps.md`
10. Dev server partagé instable ≠ régression : isoler via `next build` + `next start` → `.claude/rules/tests.md`
11. `noValidate` sur tout `<form>` avec champ requis → `.claude/rules/apps.md`
12. `db reset` ne recharge pas `[auth]` de `config.toml` : `stop` + `start` → `.claude/rules/supabase.md`
13. `[auth.email].enable_signup` désactive le provider entier → `.claude/rules/supabase.md`
14. Un flag GoTrue global ne voit pas un jeton d'invitation ; garde écran par écran → `.claude/rules/supabase.md`
15. `SimpleTable`/composant client construit dans un Server Component → `.claude/rules/apps.md`
16. Importer `@hifago/ui` depuis `page.tsx`/`layout.tsx` casse `next build` → `.claude/rules/apps.md`
17. `supabase db push --include-seed` n'a pas les droits de `postgres` → `/hifago-seed`
18. `projects api-keys` affiche `service_role` en clair → `CLAUDE.md` §8.4
19. Signature HMAC Mercado Pago valide au simulateur, pas en livraison réelle — **RÉSOLU le
    2026-09-20** : MP signe avec la clé de l'APPLICATION QUI ENCAISSE. Le token appartenait à un
    compte vendeur de test (`user_id` 3627131944) tandis que la clé venait du panneau du compte de
    développement (225649476) ; le simulateur, lui, signe avec la clé du compte connecté — d'où
    « simulateur OK, réel KO ». Discriminant : comparer le `user_id` du corps de la notification au
    suffixe du token `APP_USR-…-<userId>` → énigme `docs/journal/2026-08.md` (2026-08-24),
    résolution `docs/journal/2026-09.md` (2026-09-20)
20. **Une règle documentée que rien ne vérifie n'est pas une règle : c'est un souhait** (2026-08-28,
    fuseau — `"America/Bogota"` n'existait dans aucun code, dix sites calculaient « aujourd'hui »
    en UTC, et les tests portaient la même faute). Toute règle de ce projet qui peut être vérifiée
    mécaniquement l'est (`eslint.rules.mjs`, `scripts/check-*.sh`, CI) — détail : `.claude/rules/tests.md`.
21. **Deux fonctions qui touchent `orders` ET `payments` dans des ordres inverses s'interbloquent**
    (2026-09-20 : `apply_payment_webhook` verrouillait `payments` puis écrivait `orders`, le cron
    l'inverse — 4 `40P01` sur 12 webhooks concurrents reproduits par mutation, et un paiement
    encaissé sans aucune trace). `orders` d'abord, toujours → `.claude/rules/supabase.md` règle 8,
    prouvé par `tests/concurrency/apply_payment_webhook_vs_expiry.concurrency.mjs`
22. **Un `insert` dans une table fille prend un verrou de clé (`KEY SHARE`) sur la ligne parente**
    (2026-09-21, `modify_order_line` × `expire_payment_order` : 3 `40P01` sur 12 sans aucun
    `update orders` explicite — c'est l'`insert into order_lines` de la ligne de remplacement qui
    attendait `orders`, tenu en `FOR UPDATE` par l'expiration). Une RPC qui insère une ligne dans
    une commande existante verrouille donc `orders` d'abord, comme celles qui l'écrivent →
    `.claude/rules/supabase.md` règle 8, `20260921100200`
