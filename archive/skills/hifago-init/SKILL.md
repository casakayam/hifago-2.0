---
name: hifago-init
description: Scaffold initial complet du monorepo Hifago (npm workspaces, deux apps Next.js App Router web/admin + Supabase) — HeroUI v3, next-intl, TanStack Table, config Vitest/Playwright, workflow CI — à lancer une seule fois en tout début de chantier. Usage — /hifago-init
---

# /hifago-init — scaffold initial du monorepo Hifago

> Exception assumée à la longueur habituelle des skills courts (cf. `hifago/CLAUDE.md`) : un vrai
> démarrage de monorepo Next.js+Supabase ne tient pas en 40 lignes. Ce skill ne s'exécute
> normalement **qu'une seule fois**, avant toute autre tâche `hifago-*`.

Toutes les décisions ci-dessous sont déjà tranchées dans `hifago/docs/04-architecture-cible.md` et
`hifago/CLAUDE.md` — ce skill les **applique**, il ne les redécide jamais. Si une étape semble en
contradiction avec ces deux fichiers, s'arrêter et signaler à Jérôme plutôt que d'improviser.

> Historique : le premier passage de ce skill (2026-08-13) a scaffoldé une app unique avec route
> groups `(public)`/`(app)` et shadcn/ui. La restructuration du 2026-08-14 (cf. `hifago/CLAUDE.md`
> § 12) a fait évoluer la cible vers le monorepo à deux apps + HeroUI décrit ci-dessous — cette
> version du skill reflète l'état actuel, à utiliser si ce projet devait être re-scaffoldé.

## Pré-requis à vérifier avant de commencer
- `hifago/` ne contient pas déjà un projet initialisé (`hifago/package.json` absent) — si présent,
  ce skill s'arrête : ne jamais écraser un scaffold existant sans confirmation explicite.
- Docker installé et démarré (`docker info` sans erreur) — nécessaire pour Supabase local.
- Node ≥ 20, `npx` disponible.

## Procédure

1. **Monorepo** — depuis `hifago/`, poser le `package.json` racine (nom `hifago-monorepo`,
   `"workspaces": ["apps/*", "packages/*"]`, scripts fan-out `dev`/`build`/`lint`/`typecheck`/
   `test`/`test:e2e` en `--workspaces --if-present`, `dev:web`/`dev:admin` séparés via
   `concurrently`) avant tout scaffold d'app — cf. `docs/04-architecture-cible.md` § Web.

2. **Next.js — deux apps**, chacune avec son propre `package.json`/`next.config.ts`/`tsconfig.json` :
   ```
   npx create-next-app@latest apps/web --typescript --tailwind --app --no-src-dir --import-alias "@/*"
   npx create-next-app@latest apps/admin --typescript --tailwind --app --no-src-dir --import-alias "@/*"
   ```
   Répondre "non" à toute question ESLint custom non déjà tranchée ailleurs. `apps/web` sert la
   vitrine (port 3100), `apps/admin` sert admin+socio ensemble (port 3101, sessions Supabase
   indépendantes d'`apps/web` — pas de cookie partagé). Chaque `next.config.ts` pointe
   `turbopack.root` sur `hifago/` (deux niveaux au-dessus) pour éviter que Turbopack ne remonte au
   mauvais `package-lock.json` (celui de l'app legacy à la racine du dépôt).

3. **HeroUI v3** (socle de composants unique, cf. `hifago/CLAUDE.md` § 2) — **une seule fois**,
   dans `packages/ui/`, jamais dans une app :
   ```
   npm install @heroui/react @heroui/styles tailwind-variants @react-aria/i18n @react-aria/ssr @react-aria/utils react-aria react-aria-components --workspace=packages/ui
   ```
   Poser `packages/ui/src/styles/globals.css` (`@import "tailwindcss";` puis
   `@import "@heroui/styles";` — ordre imposé) avec les tokens communs + les deux thèmes nommés
   (`[data-theme="vitrine"]`, `[data-theme="admin"]`). Réexporter via
   `packages/ui/src/index.ts` (`export * from "@heroui/react";`). Les apps importent
   uniquement depuis `@hifago/ui`, jamais `@heroui/react` directement.

4. **Bibliothèques déjà tranchées** (jamais d'alternative sans arbitrage — voir `hifago/CLAUDE.md`
   § 2), triées par app selon l'usage réel :
   ```
   npm install next-intl react-day-picker --workspace=apps/web
   npm install recharts @tanstack/react-table @fullcalendar/react @fullcalendar/daygrid @fullcalendar/interaction qrcode --workspace=apps/admin
   npm install @supabase/ssr --workspace=apps/web --workspace=apps/admin
   npm install @supabase/supabase-js @supabase/ssr --workspace=packages/supabase
   ```
   `react-day-picker` est en réalité une dépendance de `packages/ui` (réexporté sous
   `DayPickerCalendar`), pas d'`apps/web` directement — voir étape 3.

5. **Structure de dossiers** — deux apps, pas de route groups partagés :
   ```
   apps/
     web/app/[locale]/       # vitrine — SEO, ISR, next-intl, pas d'auth requise
     admin/app/               # admin (français en dur) + partner (espagnol en dur), non localisé
       admin/
       partner/
       login/                 # login partagé admin+socio, sessions indépendantes d'apps/web
   packages/
     ui/                      # HeroUI v3 + 2 thèmes
     supabase/                # client browser/server + database.types.ts, généré par /hifago-migration
     domain/                  # logique métier prouvée partagée (grep, jamais anticipée)
     e2e-support/             # helpers e2e communs (db.ts, signInAndCollectCookies)
   ```

6. **next-intl** (interface ES/EN routée sur `apps/web` uniquement, cf. `hifago/CLAUDE.md` § 5) :
   configurer `apps/web/proxy.ts` + `apps/web/i18n/routing.ts` avec `locales: ['es', 'en']`,
   `defaultLocale: 'es'`. `apps/admin` n'a pas next-intl — `apps/admin/proxy.ts` se limite au
   refresh de session Supabase. Ne pas ajouter d'autre langue d'interface sans accord de Jérôme (le
   contenu multilingue partenaire, lui, n'est PAS géré ici — c'est du JSONB en base, cf.
   `04-architecture-cible.md`).

7. **Supabase** — un seul projet pour les deux apps, jamais dupliqué :
   ```
   npx supabase init
   ```
   depuis `hifago/` (racine du monorepo). Ne pas lancer `supabase start` automatiquement à la fin
   de ce skill — laisser `/hifago-dev` s'en charger, pour garder les responsabilités séparées.

8. **Tests** (cf. `hifago/CLAUDE.md` § 6 — Playwright + Vitest, jamais Cypress/Jest) — par app :
   ```
   npm install -D vitest @vitejs/plugin-react @testing-library/react --workspace=apps/web --workspace=apps/admin
   npx playwright install --with-deps
   ```
   Créer un `vitest.config.ts` et un `playwright.config.ts` par app (`baseURL`/port distincts,
   3100 pour `apps/web`, 3101 pour `apps/admin`) ; pas de test réel à ce stade (rien à tester tant
   qu'aucune fonctionnalité n'existe).

9. **Workflow CI** — créer `.github/workflows/hifago-ci.yml` (à la racine du dépôt, pas dans
   `hifago/`) reproduisant l'ordre décrit dans `04-architecture-cible.md` § Tests et CI/CD :
   lint/typecheck/unitaire en parallèle (`--workspaces --if-present`) → intégration (stack
   Supabase locale du runner) → build (`--workspaces --if-present`) → déploiement preview → E2E
   Playwright contre le preview réel. **Ne pas** brancher ce workflow sur un vrai déploiement
   Vercel/staging tant que ces ressources n'existent pas (`hifago-provision-cloud`, hors périmètre
   actuel).

10. **`.env.example`** — un par app (`apps/web/.env.example`, `apps/admin/.env.example`),
    variables nommées mais **valeurs vides**, jamais de vrai secret :
    `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (les
    deux apps pointent sur le même projet Supabase, mêmes valeurs). `apps/admin/.env.example`
    ajoute `NEXT_PUBLIC_WEB_APP_URL` (origine publique d'`apps/web`, pour les liens cross-app —
    ex. parrainage `/r/[code]`, qui vit dans `apps/web`).

11. **Vérification finale** : `npm run build --workspaces --if-present` doit passer sans erreur
    pour les deux apps. Ne pas commit avant d'avoir confirmé le succès du build.

## Ce que ce skill NE fait PAS
- Ne crée aucune ressource cloud réelle (Supabase, Vercel) — cf. `hifago/CLAUDE.md` § 8, toute
  ressource cloud nécessite une confirmation explicite de Jérôme.
- Ne redécide aucune brique déjà tranchée — si une dépendance semble manquante ou discutable,
  signaler plutôt que d'improviser une alternative.
- Ne configure pas de migration Supabase (délégué à `/hifago-migration`).
- N'adopte pas Turborepo — `npm run build --workspaces --if-present` suffit à cette échelle (2
  apps + quelques packages, équipe de 1). Réévaluer seulement si le nombre de packages dépasse
  ~5-6 ou si le temps CI dépasse ~10-15 min à cause de rebuilds non filtrés.
