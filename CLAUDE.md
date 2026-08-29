# hifago/ — instructions projet (refonte Casa Kayam / Hifago)

> Ce fichier s'applique uniquement au travail DANS `hifago/`. Il ne remplace ni ne complète
> `.agents/rules/global-instructions.md` (entièrement dédié à l'app actuelle Express/Fly/SQLite) —
> les deux contextes ne se mélangent jamais. Répondre en français.

## Projet en une phrase
Refonte complète de Casa Kayam/Hifago : monorepo Next.js (App Router, npm workspaces) sur Vercel +
Supabase utilisé pleinement (Postgres+PostGIS, Auth, Storage, Realtime, Edge Functions/pg_cron),
sans Fly.io. Deux apps déployées séparément — `apps/web` (vitrine publique) et `apps/admin`
(admin+socio, sessions indépendantes d'apps/web) — plus des packages partagés (`packages/ui`,
`packages/supabase`, `packages/domain`, `packages/e2e-support`). L'app actuelle à la racine du
repo reste seule en production pendant tout ce chantier ; `hifago/` est un sous-projet Node isolé
(son propre `package-lock.json`), jamais mélangé au code/dépendances de la racine du dépôt.

## 1. Sources de vérité — à lire avant toute tâche

**Chercher un sujet précis** (une spec existante, un point du cahier des charges, une décision
d'architecture) : lire `hifago/docs/ai-index.json` (table `routage` en tête) et n'ouvrir QUE le
document désigné — jamais parcourir `hifago/docs/` en entier. Même mécanisme que celui du dépôt
racine (`AGENTS.md` point 2).

1. `hifago/docs/04-architecture-cible.md` fait foi pour toute décision technique déjà "confirmée"/
   "retenue" — ne jamais la rouvrir sans fait nouveau explicite présenté à Jérôme. En particulier :
   ne pas re-proposer Fly, Cypress, Jest, pgTAP pour tester une concurrence, Chakra/Mantine/Ant
   Design comme socle de composants, Neon/Convex/Clerk — déjà comparés et écartés avec raisons
   documentées. Deux décisions ont été rouvertes et retranchées le 2026-08-14 avec un historique
   conservé (pas écrasé) dans ce document : la séparation en deux apps (§2 point 1) et le socle de
   composants HeroUI (§2 point 2) — ne pas les rouvrir non plus sans fait nouveau.
2. `hifago/docs/00-03-*.md` (cahier des charges) fait foi pour le périmètre fonctionnel.
3. `hifago/docs/05-reference-technique.md` fait foi pour les patterns de code validés (RPC
   anti-survente, test de concurrence) — copier ce squelette, ne pas le redériver de la prose de
   l'architecture doc à chaque fois.
4. `hifago/README.md` § « Points volontairement non tranchés » liste ce qui est renvoyé au
   chiffrage — ne jamais trancher ces points dans du code ou une migration ; signaler à Jérôme et
   attendre son arbitrage.

## 2. Stack non négociable
1. Monorepo npm workspaces, deux apps Next.js (App Router) — `apps/web` (vitrine publique,
   next-intl) et `apps/admin` (admin+socio ensemble, non localisé) — sessions Supabase
   indépendantes entre les deux (pas de cookie partagé, un compte multi-rôles se reconnecte en
   changeant de site, assumé). Packages partagés : `packages/ui` (design system), `packages/
   supabase` (client/server + types), `packages/domain` (logique métier prouvée commune),
   `packages/e2e-support` (helpers de test partagés). Un module ne migre vers `packages/` que
   s'il est prouvé consommé par les deux apps aujourd'hui (grep, jamais anticipé). Décision
   révisée le 2026-08-14 — historique et raisons dans `docs/04-architecture-cible.md`.
2. HeroUI v3 (React Aria + Tailwind v4) = seul socle de composants, importé uniquement via
   `packages/ui` (jamais `@heroui/react` directement dans une app). Deux thèmes nommés sur le
   même design system : `data-theme="vitrine"` (apps/web) et `data-theme="admin"` (apps/admin),
   posés sur `<html>` — aucun composant dupliqué, seuls les tokens changent. Bibliothèques
   additionnelles uniquement pour leur usage précis déjà tranché : Recharts (graphiques),
   react-day-picker (sélecteur de dates client, réexporté par packages/ui — ⚠️ le calendrier
   react-aria/HeroUI A ÉTÉ ÉVALUÉ, deux fois, sur prototype réel : 2026-08-17 puis 2026-08-29.
   Ne pas rouvrir sur « HeroUI n'a pas encore été regardé », c'est faux. La raison est de fond :
   le domaine est en NUITS à check-out exclusif, et AUCUNE des deux bibliothèques ne sait
   l'exprimer gratuitement — `isInvalidSelection` de react-aria ne s'évalue qu'après commit de la
   plage, et `excludeDisabled` de react-day-picker passe par `rangeIncludesDate(…, excludeEnds =
   false)`, donc inclut le jour de sortie. Le prédicat conscient de l'ancre doit être écrit par
   l'app dans les deux mondes ; migrer n'achète aucune garantie. S'ajoute qu'un seul des trois
   formulaires est en `mode="range"`), FullCalendar
   (gestion de disponibilité admin/socio), TanStack Table (tables denses — pairé à une primitive
   `SimpleTable` locale à packages/ui, pas au `Table` compound HeroUI qui gère son propre état).
   Jamais de second design system complet en parallèle. Décision révisée le 2026-08-14 (HeroUI
   n'avait pas été évalué dans la comparaison initiale shadcn/ui vs Chakra/Mantine/Ant Design —
   fait nouveau, pas juste un changement d'avis) — historique dans `docs/04-architecture-cible.md`.
3. **`Table.Body`/`Table.Content` de HeroUI n'acceptent jamais d'enfant sous forme de fonction
   (`renderEmptyState`, children en render-prop) depuis un Server Component** — non sérialisable à
   travers la frontière RSC (`apps/admin` n'a pas `"use client"` par défaut sur une page). Deux
   idiomes valides seulement : (a) page Server Component qui fait le fetch et passe des **données
   déjà sérialisées** à un sous-composant `"use client"` dédié qui, lui, utilise
   `items`/`renderEmptyState`/children-en-fonction ; (b) page Server Component qui rend elle-même
   `Table.Body` mais avec des enfants JSX statiques (`.map()` classique, jamais `items=`/
   `renderEmptyState=`). Ne jamais mélanger les deux dans le même fichier.
4. Refine.dev uniquement comme bibliothèque de scaffolding pour les écrans CRUD purs (catalogue,
   registre partenaires) — jamais pour la logique métier, jamais son intégration MUI.
5. Vercel pour le web. Supabase pleinement (Postgres+PostGIS, Auth, Storage, Realtime, Edge
   Functions/pg_cron) pour tout le backend. Jamais de Fly.io, même pour un besoin ponctuel (relais
   réseau compris — utiliser un hébergeur minimal type Hetzner si un jour nécessaire, jamais Fly).
6. **Responsive obligatoire sur tout `apps/admin`, pas seulement `apps/web`** (décision Jérôme,
   2026-08-15) : admin et socio sont fusionnés dans la même app, et le socio consulte souvent
   depuis son téléphone. Une liste/tableau dense ne se contente jamais d'un simple
   `overflow-x-auto` (scrollable ≠ lisible) : reflow en cartes sous le breakpoint `md` (768px,
   défaut Tailwind v4) — pattern déjà validé côté legacy (portail socio) à reproduire, pas
   réinventer. Détail et procédure de vérification : `.claude/skills/hifago-ui/SKILL.md`, audité
   par `/hifago-review` (domaine design system).

## 3. Frontière RLS / RPC-only — checklist non négociable
1. **RPC-only (aucune policy RLS d'écriture, grants revoke)** : toute table portant un compteur de
   capacité/disponibilité (calendrier, cupos, stock), toute écriture nécessitant un audit
   nominatif, toute lecture exposant les données d'une autre identité (vue miroir admin), tout
   verrou optimiste multi-admin.
2. **RLS directe autorisée** : tout le reste (une identité sur ses propres données non
   capacitaires).
3. Toute fonction Postgres centralisée utilisée dans une policy RLS directe doit être `STABLE`
   (jamais `VOLATILE` par défaut) ; si elle lit une table elle-même sous RLS, `SECURITY DEFINER`
   avec `SET search_path = ''` obligatoire.
4. Toute policy RLS enveloppe `auth.uid()` en `(select auth.uid())`.
5. `service_role` (utilisé dans les Route Handlers pour les tables RPC-only) contourne RLS
   entièrement — ne jamais présenter ça comme un "filet de sécurité RLS" dans un commentaire ou
   une doc : le vrai filet est l'absence de policy d'écriture directe + les tests + la revue.

## 4. Invariant anti-survente
1. Toute opération critique (réservation, fermeture de date/créneau, décrément de capacité) = une
   seule fonction RPC Postgres (`SECURITY DEFINER`, `SET search_path=''`), un seul aller-retour
   réseau depuis la Route Handler — jamais orchestrée en plusieurs requêtes séparées côté app.
2. Verrouillage explicite `SELECT ... FOR UPDATE` sur la ligne concernée avant toute décision.
3. Reproduire le squelette exact de `hifago/docs/05-reference-technique.md` (validé par un test de
   concurrence réelle le 2026-08-12 : 9 exécutions propres, 20 tentatives concurrentes, exactement
   1 succès à chaque fois) pour toute nouvelle RPC critique — pas une réinvention.
4. Échec fermé partout : si un service dont dépend une réservation est indisponible (calendrier,
   relais réseau LobbyPMS), bloquer la réservation plutôt que risquer une incohérence.
5. Supabase Realtime n'est jamais la source de vérité au moment de valider une réservation — un
   confort d'affichage seulement.

## 5. i18n et SEO
1. Deux couches distinctes, jamais confondues : libellés d'interface (next-intl, ES/EN routés,
   jeu fermé) vs contenu partenaire (colonnes JSONB par champ, langues illimitées, repli
   obligatoire).
2. hreflang construit uniquement sur les locales d'interface routées, jamais sur la liste
   dynamique de langues de contenu.
3. Une fiche servie en repli JSONB sous une URL routée reste `noindex` + canonical vers la langue
   source tant qu'aucune traduction réelle n'existe — jamais indexée comme une page distincte.
4. Une langue de contenu sans locale d'interface routée (ex. contenu saisi en français) : canonical
   vers `x-default` (l'espagnol), jamais de route publique dédiée.
5. Un seul `sitemap.xml` dynamique avec `alternates.languages` par entrée — jamais un sitemap par
   langue.

## 6. Tests
1. E2E : Playwright, jamais Cypress (seul capable de piloter plusieurs `BrowserContext` isolés
   pour prouver l'invariant anti-survente sous vraie concurrence).
2. Unitaire/composant : Vitest, jamais Jest.
3. Pour tester une race condition : jamais pgTAP (chaque test tourne dans une transaction annulée
   en rollback — structurellement incapable de simuler une vraie concurrence). Utiliser le pattern
   à barrière de synchronisation de `hifago/docs/05-reference-technique.md`.
4. Toute stack de test tourne en local (`supabase start`, Docker) par défaut — jamais un projet
   Supabase cloud partagé entre tests, sauf job nocturne explicitement dédié et approuvé.
5. **Proportionnalité du test à écrire** — choisir le palier le plus léger qui prouve le
   comportement, jamais le plus lourd par défaut :
   - **Rien** (build/typecheck/lint suffisent) : affichage pur, sans état dérivé ni logique
     conditionnelle.
   - **Composant** (Vitest + `@testing-library/react`, déjà installée dans `apps/web`/`apps/admin`) :
     logique de rendu/état contenue dans un seul composant, testable sans navigateur ni session —
     validation de formulaire, calcul affiché, état dérivé, rendu conditionnel selon props. Fichier
     `*.test.tsx` à côté du composant.
   - **E2E** (Playwright) : parcours traversant plusieurs écrans, une vraie session, ou un
     aller-retour réseau/DB à prouver bout-en-bout.
   - **Règle par défaut pour un CRUD simple** (ex. un écran de gestion de catalogue trivial) :
     exactement **1** test E2E chemin heureux bout-en-bout, jamais une matrice de cas par variante
     — les variantes et validations de formulaire vont en test composant, pas en Playwright
     supplémentaire.
   - Pendant le développement, cibler `/hifago-test <fichier(s) touché(s)>` plutôt que la suite
     complète — voir `.claude/skills/hifago-test/SKILL.md`.

## 7. Environnements
1. Préprod = Vercel Custom Environment `staging` (domaine stable, pas juste un Preview éphémère)
   + un second projet Supabase dédié (jamais une branche persistante).
2. Promotion vers la prod toujours manuelle (revue de PR + approbateurs), jamais automatique sur
   simple push.
3. Données de préprod 100 % synthétiques via `supabase/seed.sql` — jamais une copie de données de
   production.

## 8. Sécurité opérationnelle — non négociable (leçon du 2026-08-12)
1. **Avant toute action touchant une ressource cloud réelle** (Supabase, Vercel, tout MCP),
   vérifier explicitement à quel compte/organisation l'outil/token est rattaché — ne jamais
   supposer. (Le 2026-08-12, le serveur MCP Supabase connecté à la session pointait sur un compte
   tiers, pas celui du projet — détecté avant toute action, à répéter systématiquement.)
2. Aucun token/secret n'est jamais écrit sur disque, même dans un scratchpad — au pire une variable
   d'environnement de session, jamais persistée.
3. Stack locale (Docker) par défaut pour toute expérimentation ou prototype. Toute ressource cloud
   réelle (projet Supabase, déploiement Vercel) nécessite une confirmation explicite de Jérôme à
   chaque fois — jamais une autorisation acquise une fois pour toutes.

## 9. Fournisseurs externes déjà tranchés (ne pas rouvrir)
360dialog (WhatsApp Business, mode API-only) · Google Routes API (itinéraire admin) · Resend ou
Postmark (email — choix final renvoyé au chiffrage, mais le principe "un fournisseur email dédié,
jamais le mailer Supabase Auth" est acquis) · un relais réseau minimal auto-hébergé (jamais Fly)
pour l'IP stable exigée par LobbyPMS — **Vultr retenu pour l'instance préprod** (région Miami,
substitué à l'hypothèse Hetzner initiale de `docs/04-architecture-cible.md` après avoir écarté
Oracle Cloud pour sa carte bancaire obligatoire ; Hetzner reste valide comme référence "ou
équivalent" pour un futur relais prod).

## 10. Hors périmètre — à ne jamais trancher sans Jérôme
Niveaux d'accès différenciés entre utilisateurs d'une même organisation partenaire · schéma exact
de la file de réconciliation/campagnes · fréquence du cron PMS et taille de lot · format de
l'export comptable/fiscal · fournisseur email final (Resend vs Postmark).

## 11. Pièges empiriques (à alimenter au fil du chantier)
1. **Grants par défaut restrictifs sur les tables créées par le rôle `postgres`** (constaté
   2026-08-13, Tranche 1 identité) — sur l'instance Supabase locale, les tables créées via les
   migrations (rôle `postgres`) n'héritent PAS des grants SELECT/INSERT/UPDATE/DELETE larges
   habituellement supposés par le modèle "grants + RLS comme seule vraie porte" (`pg_default_acl`
   du rôle `postgres` sur le schéma `public` ne contient que REFERENCES/TRIGGER/TRUNCATE/MAINTAIN
   pour `anon`/`authenticated` — contrairement à `supabase_admin`, qui lui a bien le grant large).
   Sans GRANT explicite, une requête échoue en `permission denied` **avant même que RLS ne
   s'applique** — facile à confondre avec un bug de policy. Correctif posé dans
   `supabase/migrations/20260813163456_identity_rls.sql` : `ALTER DEFAULT PRIVILEGES FOR ROLE
   postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated,
   service_role;` (couvre toute table future) + un `GRANT` explicite par table déjà créée (non
   rétroactif). Même logique pour les fonctions RPC : `EXECUTE` n'est pas non plus accordé par
   défaut, `grant execute on function ... to authenticated;` requis pour chaque RPC critique.
   **À vérifier avant tout déploiement staging/prod** : ce comportement n'a été observé que sur
   l'instance locale (Docker/CLI) — à confirmer contre un vrai projet Supabase cloud avant de
   supposer le correctif suffisant (le `ALTER DEFAULT PRIVILEGES` est per-rôle-créateur : si
   staging/prod provisionne différemment, refaire le constat plutôt que supposer identique).
2. **Trigger `Select` HeroUI v3 = `role="button"` + `aria-haspopup="listbox"`** (constaté
   2026-08-14, migration HeroUI), jamais `role="combobox"` (pattern de l'ancien socle base-ui) —
   un test/sélecteur qui cible `role="combobox"` ne trouvera jamais l'élément. Cibler par testid
   quand un existe, sinon par rôle "button" scopé.
3. **Le `<select>` natif caché du `Select` HeroUI (fallback accessibilité/formulaire) contient
   TOUJOURS le texte de toutes les options possibles**, sélectionnées ou non (constaté 2026-08-14)
   — une assertion `toContainText`/`hasText` sur la ligne/le composant entier matche n'importe
   quel statut. Scoper à `[data-slot="select-value"]` (la valeur réellement affichée) ; helper
   `selectValue()` dans `packages/e2e-support`.
4. **Le vrai `<input type="checkbox" role="switch">` d'un `Switch` HeroUI est visuellement masqué
   et niché dans un `<label>` piloté par `usePress` (react-aria)**, pas par le transfert natif
   label→input (constaté 2026-08-14) — `locator.isChecked()`/`toBeChecked()` exigent de cibler cet
   input directement (`.locator("input")`), et le clic doit passer par `{ force: true }`. Helpers
   `switchInput()`/`toggleSwitch()` dans `packages/e2e-support`.
5. **Le `Checkbox` HeroUI v3 a un piège distinct du `Switch` ci-dessus** (constaté 2026-08-14,
   feature 26 — admin-partner-create.spec.ts) : cliquer le wrapper racine du composant, même en
   `{ force: true }` (ce qui suffit pour un `Switch`), **laisse l'état inchangé sans lever
   d'erreur Playwright** — un piège silencieux, invisible si le test n'affirme pas l'état obtenu
   côté serveur après coup. Seul un clic ciblant `.locator("input")` fonctionne. Helpers
   `checkboxInput()`/`toggleCheckbox()` dans `packages/e2e-support` — toujours les préférer à un
   clic direct sur le testid racine d'un `Checkbox`.
6. **Un composant qui construit un graphique Recharts (`LineChart`, `BarChart`, `PieChart`...)
   doit porter `"use client"` lui-même** (constaté 2026-08-15, feature 27 — page d'accueil admin),
   pas seulement son wrapper englobant. Recharts appelle `createContext()` en interne dès
   l'évaluation du module : passer un élément Recharts en `children` d'un composant déjà
   `"use client"` (ex. `ChartCard`) ne suffit pas si le fichier qui CONSTRUIT cet élément (celui
   qui importe `LineChart` et écrit `<LineChart data={...}>`) est lui-même un Server Component —
   l'erreur (`createContext only works in Client Components`) ne se déclenche qu'à l'exécution
   réelle de la route, jamais au typecheck/lint. Chaque fichier qui importe directement depuis
   `"recharts"` pour composer un graphique porte `"use client"` en tête, systématiquement.
7. **`ComboBox` HeroUI v3 en e2e : cliquer une option d'une liste non filtrée (query vide) est
   moins fiable qu'après avoir tapé une requête** (constaté 2026-08-14, feature 28 — recherche
   partenaire/établissement) — un `.click()` sur le champ suivi d'un clic direct sur la première
   `option` d'une liste non filtrée a échoué de façon intermittente à committer la sélection
   (`onSelectionChange` semble ne pas toujours se déclencher), sans cause racine confirmée (piste :
   re-render du `ListBox` filtré déclenché par `onInputChange` pendant le geste de clic). Taper une
   requête correspondant à l'élément avant de cliquer dessus (`fill()` puis `getByRole("option",
   { name })`) s'est montré fiable à chaque run, y compris en parallèle — à préférer
   systématiquement pour tester un `ComboBox`, pas seulement pour ce composant précis. Composant
   partagé : `apps/admin/components/searchable-combobox.tsx`.
8. **Un écran client-heavy (galerie/crop, autocomplete Google Maps, éditeurs multi-champs) peut
   perdre la toute première interaction e2e après une navigation client-side** (constaté
   2026-08-15, spec 11 — `ProductForm`, nettement plus lourd à hydrater que l'ancien
   `NewProductForm`) — un `.fill()`/`.click()` immédiatement après un changement d'URL peut
   atteindre le DOM avant que React n'ait attaché ses gestionnaires : la valeur saisie se perd
   silencieusement (repli navigateur natif — l'URL se retrouve avec les champs en query string
   GET si c'est le bouton de soumission qui est touché) ou un `<Link>` cliqué ne navigue pas
   (aucune erreur Playwright, juste un timeout sur l'assertion suivante). `await
   page.waitForLoadState("networkidle")` juste après la navigation, avant la première interaction,
   corrige le problème — à poser systématiquement après tout `page.goto`/clic de navigation vers un
   écran client component conséquent, pas seulement pour ce formulaire précis.
9. **`Toast.Provider` de HeroUI v3 n'est PAS un provider classique qu'on enroule autour du contenu
   de l'app** (constaté 2026-08-17, spec 16 — notifications toast) — contrairement à `CartProvider`/
   `ThemeProvider` etc., son prop `children` est un render-prop consommé PAR TOAST à l'intérieur de
   `UNSTABLE_ToastRegion` (react-aria-components), jamais un slot pour le contenu de la page. Monter
   `<Toast.Provider>{children}</Toast.Provider>` dans le layout racine fait retourner `null` à toute
   la région — donc à toute l'app — tant qu'aucun toast n'existe (`visibleToasts.length === 0`) :
   page blanche totale, **aucune erreur console, aucune exception**, `npm run build`/`next start`
   compilent et démarrent sans le moindre avertissement (le bug ne se manifeste que dans un vrai
   navigateur). Monter `<Toast.Provider placement="..." />` en SIBLING de `{children}`, jamais en
   wrapper — comme `sonner`/`react-hot-toast`, pas comme un context provider React classique.
10. **Un dev server Turbopack partagé (`next dev`, port 3101/3100) peut devenir instable sous
    écritures concurrentes intenses** (constaté 2026-08-17, deux sessions actives simultanément —
    voir `hifago/docs/journal/2026-08.md`, entrées « grille de cartes » et « notifications toast ») :
    plusieurs redémarrages de process + lots e2e à 4 workers en parallèle d'un côté ont coïncidé avec
    un `deadlock detected` Postgres sur `auth.sessions` et des timeouts en cascade sur des écrans non
    touchés par l'autre session (reproduits sur des pages jamais modifiées). Symptôme distinctif
    d'une instabilité d'environnement plutôt qu'une vraie régression : des échecs sur des écrans hors
    du périmètre de la tâche en cours. À isoler via `next build` + `next start -p <port dédié>`
    (jamais 3100/3101, déjà utilisés) avant de conclure à un bug de code.
11. **Un champ `isRequired`/`required` (HeroUI `TextField`/`Input`, `type="number" min={...}`)
    bloque silencieusement la soumission d'un `<form>` via la validation NATIVE du navigateur, avant
    que `onSubmit` React ne s'exécute** (constaté 2026-08-17, retour direct de Jérôme après test
    réel de spec 16 — `product-form.tsx`, champ "Precio") — ni un message inline ni un toast ne se
    déclenchent dans ce cas, quelle que soit la qualité du code React derrière `handleSubmit` : le
    navigateur n'appelle jamais ce handler. Invisible au typecheck/lint/build, seul un clic réel
    dans un navigateur (ou Playwright) le révèle. `noValidate` sur la balise `<form>` élimine la
    classe de bug entière — la validation JS déjà en place prend alors systématiquement le relais.
    Poser `noValidate` par défaut sur tout nouveau `<form>` de ce projet dès qu'il contient un champ
    requis, pas seulement en réaction à un bug constaté.
12. **`npx supabase db reset` ne suffit PAS à appliquer un changement dans les sections `[auth]`/
    `[auth.email]`/`[auth.external.*]` de `supabase/config.toml`** (constaté 2026-08-19, Feature 31
    révision — bascule `enable_signup=false`) — `db reset` ne fait que drop/recréer/migrer/seed la
    base Postgres ; le conteneur GoTrue (auth), lui, lit ces clés comme variables d'environnement
    injectées **au démarrage du conteneur**, jamais relues à chaud. Symptôme trompeur : un test qui
    appelle directement `POST /auth/v1/signup` après un simple `db reset` continue de réussir
    (`ok()`/`user.id` présent) comme si `enable_signup=false` n'existait pas — aucune erreur, aucun
    avertissement, facile à confondre avec un flag mal posé ou un bug de test. Toujours `npx
    supabase stop` puis `npx supabase start` (redémarre réellement tous les conteneurs avec la
    config à jour) après avoir touché ces sections précises — un simple `db reset` reste suffisant
    pour tout le reste (migrations, seed).
13. **`[auth.email].enable_signup` ne veut PAS dire ce que son commentaire dit** (constaté
    2026-08-19, même session que le piège précédent — révélé en faisant tourner les e2e existants,
    pas en écrivant le code) : le commentaire du template Supabase CLI (« Allow/disallow new user
    signups via email ») laisse penser à un simple filtre sur les *nouvelles* inscriptions, symétrique
    de `[auth].enable_signup`. En réalité cette clé active/désactive le provider email **tout
    entier** côté GoTrue — connexion ET inscription confondues. Le passer à `false` (pour renforcer
    `[auth].enable_signup=false`, par souci de cohérence apparente) a cassé la CONNEXION de tous les
    comptes email/mot de passe déjà existants (`admin@hifago.test` y compris), avec un message qui
    ne mentionne même pas "signup" : `"Email logins are disabled"` — symptôme qui pointe vers un
    mauvais suspect si on ne se souvient pas d'avoir touché cette clé précise. `[auth].enable_signup`
    (racine, global, tous providers) est le SEUL verrou correct pour bloquer uniquement la création
    de nouveaux comptes sans toucher aux connexions existantes — ne jamais dupliquer la valeur dans
    `[auth.email]` "pour être sûr".
14. **Un flag GoTrue global (`enable_signup`, ou tout autre réglage serveur-wide) ne sait pas voir
    un jeton d'invitation valide dans l'URL** (constaté 2026-08-19, même session — `enable_signup=
    false` posé pour bloquer l'auto-inscription sur `/login`/`/signup` cassait AUSSI la
    consommation d'invitation via Google sur `/partner/join?token=...`, un chemin légitime :
    l'invitation vit uniquement côté frontend, jamais transmise à GoTrue pendant l'échange OAuth,
    et `consume_partner_invitation` ne s'exécute qu'après coup — GoTrue rejette la création avant
    même d'atteindre ce point). Confirmé en testant en conditions réelles par Jérôme, pas en CI.
    Un `before_user_created` Auth Hook ne résout pas ça non plus : il ne reçoit que l'objet `user`
    (email, `app_metadata.provider`), jamais le contexte de requête (query params, `redirect_to`).
    **Leçon générale** : quand le vrai besoin est « ne pas laisser un visiteur ordinaire croire
    qu'il peut s'auto-inscrire » (un problème d'ÉCRAN), préférer retirer le point d'entrée UI
    (bouton/lien) sur les écrans concernés plutôt que poser un verrou serveur global — un verrou
    global ne distingue jamais un contexte légitime (jeton, session déjà autorisée) d'un contexte
    anonyme, contrairement à une garde posée écran par écran.
15. **Un Server Component qui construit lui-même un `<SimpleTable>` (packages/ui) imbriquant des
    enfants `"use client"` (ex. `<StatusChip>`/`<Chip>`) plante à l'évaluation du module** (constaté
    2026-08-19, revue admin clientes — fiche détail client) : `TypeError: createContext is not a
    function`, reproduit uniquement par `next build` (« Collecting page data »), **invisible au
    typecheck/lint et même en dev tant que la route n'est pas réellement visitée**. Même classe de
    piège que le point 6 ci-dessus (Recharts) mais avec `SimpleTable` — jusqu'ici ses seuls
    consommateurs du repo étaient déjà `"use client"` (`room-availability-grid.tsx`,
    `slot-availability-grid.tsx`), jamais un Server Component ; `Chip`/`Table` (HeroUI) directement
    depuis un Server Component fonctionnent, eux, déjà ailleurs (`orders/[id]/page.tsx`) — la
    différence précise de root cause entre les deux cas n'a pas été creusée plus loin, seul le
    correctif a été vérifié empiriquement. Correctif : extraire tout le bloc qui CONSTRUIT le
    `<SimpleTable>` dans un composant `"use client"` dédié (ex. `ClientOrderCard.tsx`), le Server
    Component ne fait plus que fetch + résoudre les champs jsonb localisés et passe des props déjà
    sérialisables — jamais un `<SimpleTable>`/`<StatusChip>` construit inline dans un fichier sans
    `"use client"` en tête.
16. **Le piège du point 15 ne demande PAS que le Server Component nesting un `Chip`/composant
    client — importer N'IMPORTE QUEL nom depuis `@hifago/ui` suffit dès que le barrel
    (`packages/ui/src/index.ts`) exporte AUSSI un composant plus lourd** (constaté 2026-08-20,
    refonte responsive mobile — ajout d'`AppNavShell`, qui importe `lucide-react` +
    `Modal`/`useOverlayState` de react-aria-components, au barrel) : `import { SimpleTable } from
    "@hifago/ui"` directement dans un `page.tsx`/`layout.tsx` (Server Component) s'est mis à
    planter au build (`next build`, « Collecting page data », `(0, g.createContext) is not a
    function`) sur DEUX routes où ce même import fonctionnait auparavant (`establishments/[id]`,
    `establishments/[id]/resource`) — sans aucun `Chip` imbriqué, juste l'import lui-même.
    `export * from "@heroui/react"`/tout export local dans `packages/ui/src/index.ts` tire
    l'ENSEMBLE du graphe de modules du barrel pour n'importe quel consommateur, même celui qui n'a
    besoin que d'une seule primitive légère. Correctif identique au point 15 (extraire dans un
    sous-composant `"use client"` dédié, ex. `EstablishmentProductsTable.tsx`), mais le déclencheur
    est différent : ce n'est pas la structure du JSX qui compte, c'est la composition du barrel au
    moment du build. **Règle pratique retenue** : ne plus jamais `import ... from "@hifago/ui"`
    directement dans un `layout.tsx`/`page.tsx` (Server Component) de ce repo, quel que soit
    l'import demandé — toujours passer par un fichier `"use client"` dédié, même pour un composant
    a priori "sans état" comme `SimpleTable`. Racine exacte non creusée plus loin (lequel des
    nouveaux imports du barrel est en cause précisément) — seul le correctif est vérifié
    empiriquement, à re-tester si `app-nav-shell.tsx` est un jour retiré du barrel.
17. **`supabase db push --include-seed` sur Supabase Cloud n'exécute PAS `supabase/seed.sql` avec
    les mêmes privilèges qu'une connexion `postgres` directe** (constaté 2026-08-21, déblocage seed
    préprod) — le CLI provisionne, via l'API Management (`Initialising login role...` →
    `POST /cli/login-role`), un rôle éphémère `cli_login_postgres` (`rolinherit=false`, non
    superuser). Ce rôle affiche bien `current_user='postgres'` une fois connecté (vérifié par
    `raise exception` diagnostique), mais une opération DML pourtant couverte par les grants réels
    de `postgres` (`UPDATE partner_capabilities`, confirmé accordé — colonne par colonne — via
    `information_schema`) échoue quand même : `ERROR: permission denied for table
    partner_capabilities (SQLSTATE 42501)`. La même instruction, exécutée via une connexion
    `postgres` authentique (`mcp__supabase__execute_sql`, ou un `psql` direct comme en local),
    réussit sans erreur — mécanisme exact non percé à jour (la piste la plus probable : un rôle
    atteint via un mécanisme interne au CLI distinct d'un vrai `SET ROLE`/login direct ne porte pas
    les mêmes droits malgré un `current_user` identique en apparence), mais le contournement est
    vérifié empiriquement et suffisant : appliquer `seed.sql` via `mcp__supabase__execute_sql` (ou
    un `psql` direct authentifié `postgres`) plutôt que `db push --include-seed`, qui reste fiable
    pour les migrations (DDL) mais pas pour ce seed spécifique. Toujours tester d'abord en local
    (`psql` direct, jamais ce piège en local où `postgres` est superuser Docker) avant de rejouer
    sur le cloud.
18. **`npx supabase projects api-keys` affiche la clé `service_role` LEGACY (JWT) en clair même
    SANS `--reveal`** (reconstaté 2026-08-21, 3ᵉ occurrence après le 2026-08-12 et une première fois
    dans cette même session — `--reveal` ne masque que les clés du nouveau format `sb_secret_...`,
    pas les JWT legacy `anon`/`service_role`, qui n'ont pas de représentation partiellement
    masquable). Ne JAMAIS appeler cette commande brute : toujours rediriger vers un filtre qui capture
    la valeur sans l'afficher (`eval "$(... -o env | grep SERVICE_ROLE_KEY)"` dans un seul appel non
    échoïsant), ou au minimum passer par `sed -E 's/="[^"]*"/=<redacted>/'` avant toute lecture, même
    pour un simple diagnostic de nom de variable.
19. **Un secret webhook Mercado Pago confirmé identique entre `.env.local` et le panel développeur
    peut quand même échouer la vérification HMAC pour de VRAIES notifications Payment/Merchant
    order envoyées par Checkout Pro, alors que « Simular notificaciones » avec ce même secret valide
    sans problème** (constaté 2026-08-24, retest du paiement local). Diagnostic exhaustif avant de
    conclure : secret comparé caractère pour caractère (identique) ; 8 formats de manifest testés en
    parallèle (ordre des champs, avec/sans `request-id`, sans `;` final, `id` en minuscule...) —
    aucun ne correspond au hash reçu pour les vraies livraisons, alors que le format standard
    documenté (`id:...;request-id:...;ts:...;`) valide parfaitement via le simulateur avec le même
    secret. Root cause non élucidée côté Mercado Pago (probablement une clé pas propagée à leur
    pipeline de livraison réel pour ce type d'événement précis) — écarté comme bug hifago après
    cette vérification. Contournement sûr utilisé : une fois le paiement confirmé `approved` via la
    redirection Checkout Pro (`collection_status=approved` + `payment_id` réel dans l'URL de
    retour), rejouer manuellement le webhook avec une signature HMAC forgée localement (même secret,
    `crypto.createHmac('sha256', secret)`, manifest standard) — sûr car `apply_payment_webhook`
    n'écrit jamais rien sans que la route ait d'abord re-vérifié le paiement en direct via
    `GET /v1/payments/{id}` (jamais sur la seule foi du corps du webhook, cf. commentaire de tête de
    `apply_payment_webhook.sql`). **À surveiller avant tout passage en staging/prod** : si ce
    symptôme se reproduit sur un vrai déploiement, il n'y aura plus d'accès shell pour rejouer
    manuellement — contacter le support Mercado Pago proactivement plutôt que de découvrir le
    problème en prod.

20. **Une règle documentée que rien ne vérifie n'est pas une règle** (constaté 2026-08-28, lot
    fuseau). « Toutes les dates sont en heure de Colombie » était écrit dans la doc depuis des mois.
    Au moment de la vérifier, la chaîne `"America/Bogota"` n'apparaissait **nulle part dans le
    code** — dans trois commentaires, et rien d'autre — et **dix sites** calculaient « aujourd'hui »
    en UTC ou dans le fuseau du navigateur. Deux mécanismes expliquent une telle longévité, et tous
    deux sont généralisables : (a) **le bug n'est visible que 5 h par jour** (Guatapé est à UTC−5 :
    `new Date().toISOString().slice(0, 10)` ne se trompe qu'entre 19 h et minuit heure locale), donc
    aucune vérification manuelle de journée ne le rencontre ; (b) **les tests portaient la même
    faute** (`packages/e2e-support/src/date.ts` calculait sa date exactement comme le code testé),
    donc les deux côtés de l'assertion se trompaient ensemble et la suite restait verte. ⚠️ La
    machine de développement de ce projet est réglée sur `America/Bogota` et le serveur Vercel sur
    UTC : **un test qui ne force pas explicitement un troisième fuseau ne peut rien prouver ici**
    (cf. `LodgingReservationForm.timezone.test.tsx`, qui pose `process.env.TZ = "Europe/Paris"`).
    ⚠️ `timezoneId` dans `playwright.config.ts` ne couvre **que le navigateur** — le processus Node
    du runner et le serveur Next gardent le leur ; les deux gestes sont nécessaires et ne couvrent
    pas la même moitié. Outillage posé en conséquence, à ne pas retirer : `eslint.rules.mjs`
    (les deux apps) + `scripts/check-timezone.sh` (packages/, supabase/functions/, tests/, SQL),
    avec `packages/domain/src/time/` pour unique échappatoire.

## 12. Curseur — dernière session

En fin de feature/session : (1) *append* (jamais écraser) une entrée datée à
`hifago/docs/journal/<mois-en-cours>.md` — nouveau mois = nouveau fichier (`2026-09.md` le
1er septembre) ; (2) *remplacer* (pas ajouter) le paragraphe ci-dessous par le résumé de cette
nouvelle entrée.

*2026-08-28 (tâche 3, session parallèle au lot fuseau) — **le calendrier d'un logement coûtait
180 appels LobbyPMS par mois affiché, sous un plafond de 60 par minute. Il en coûte 1.** Deux
réductions indépendantes qui se composent. **R1** : le filtre `category_id` retiré du chemin de
réservation — `available-rooms` cote TOUT le catalogue d'un établissement en une réponse, donc
6 produits liés coûtent 1 appel par nuit au lieu de 6. Le cache passe donc à
`(établissement, mois)` et porte le catalogue brut ; ⚠️ `cuposPerUnit` reste appliqué PAR PRODUIT
APRÈS la lecture (deux produits sur la même catégorie peuvent avoir des `lodging_kind`/`capacity`
différents). **La plage** : sonde ajoutée à `pms-nightly-contract-check` en opt-in par le CORPS de
la requête (le cron poste `{}`, nominal inchangé — vérifié en réel), qui a mesuré trois choses sur
le compte de Casa Kayam. ⚠️ **`end_date` est INCLUSIF** (demandé J→J+5 : SIX enregistrements), alors
que la production supposait exclusif depuis le premier jour ; elle n'en a jamais souffert par
CHANCE, en ne lisant que `data[0]`. La plage EST honorée (`{data:[{date,categories}], meta}`) et
`records_per_page` vaut 100 — donc un mois tient dans un appel. Et la prémisse de R1 est confirmée :
disponibilité identique avec et sans `category_id`. ⚠️ **LE PIÈGE, fermé avant d'élargir quoi que
ce soit** : `data[0]` + étiquetage par la date DEMANDÉE aurait écrit la dispo du 1er jour sur
30 nuits sans rien casser de visible. La date d'une ligne vient désormais de la RÉPONSE
(`parseLobbyNightCatalog` + `alignLobbyCatalogEntries`, qui échoue bruyamment plutôt que de compter
les rangs) ; `parseLobbyNightAvailability` est SUPPRIMÉ pour qu'on ne puisse plus y revenir.
⚠️ **`pmsFixtureServer` IGNORAIT `end_date`** — un test « un appel pour 30 nuits » y aurait été
faussement vert ; prouvé en exécutant l'ancienne version, réécrit, et `endDateInclusive` mis à
`true` par défaut (une fixture plus complaisante que le vrai service ne teste rien). **Ni robot ni
table de cache** : à 1 appel par mois, le dossier est clos. **Reste ouvert** : sonde à un appel sur
`start_date == end_date` (la production envoie encore `dernière nuit + 1`, verrue sans conséquence
car la nuit en trop est écartée par sa date) ; `pms_category_not_quoted` devrait rejoindre
`connector_inactive` dans les motifs non retentables de `LodgingReservationForm.tsx`, laissé
intact parce qu'une autre session l'éditait. **Relu par une revue adversariale dédiée, qui a trouvé
huit défauts dont sept corrigés.** ⚠️ Le plus grave démentait ma propre documentation : la nuit
surnuméraire due à la borne inclusive avait un **droit de veto sur le mois entier** (validation
AVANT filtrage), or le 1er du mois suivant est exactement la borne où un PMS a le plus de raisons de
dévier — on écarte désormais avant de valider. ⚠️ Une disponibilité ILLISIBLE valait « complet »
(`Number("")` vaut 0) : elle vaut désormais « non cotée ». ⚠️ Le Route Handler n'était exercé par
AUCUN test (le e2e l'intercepte au niveau NAVIGATEUR) — `route.test.ts` le couvre, et ses invariants
sont vérifiés par MUTATION, pas seulement par des tests verts. **Non corrigé, signalé** :
`createTtlCache` ne purge jamais les entrées expirées (Map non bornée sur clés d'appelant), et
`addDaysIso` (`bogotaDates.ts:56`) porte le même débordement d'année que corrigé ici.*

*2026-08-29 — **le grief du 23-24 décembre est enfin clos : une plage ne peut plus ENJAMBER une nuit
pleine.** Le lot du 28/08 avait fermé le cas « nuits jamais récupérées » ; restait celui d'une nuit
RÉELLEMENT pleine qu'on enjambe — barrée mais cliquable, et la plage 20→27 décembre qui la traversait
n'était refusée qu'APRÈS coup, avec exactement le message du grief. Prouvé par sonde avant d'écrire
le correctif. ⚠️ **Ce chemin n'a aucun filet serveur** : `create_order` saute la validation nuit par
nuit ET le décrément pour un logement PMS-backed (migration `20260819130000`, l.379 et l.622) — sur
GUSTO, le calendrier client est la seule barrière synchrone. **NE PAS migrer vers HeroUI
RangeCalendar** : arbitrage du 17/08 relu puis soumis à contradiction indépendante, zéro objection
tenue. Une prémisse a pourtant expiré (« la seule barrière qui compte reste le serveur » est fausse
depuis le 19/08 côté PMS), mais le fait décisif est ailleurs et vaut pour les DEUX bibliothèques :
le domaine est en nuits à sortie **exclusive**, et leurs deux garde-fous intégrés ont une borne haute
**inclusive** — `excludeDisabled` de RDP passe par `rangeIncludesDate(…, excludeEnds = false)`,
`isInvalidSelection` de react-aria rejuge `value.end` APRÈS commit avec `anchorDate` à null. Sortir
le matin de la première nuit indisponible est légitime : **aucune des deux ne sait l'exprimer**, le
prédicat conscient de l'ancre doit être écrit par l'app dans les deux mondes. Le clamp react-aria
n'achète donc aucune garantie gratuite ici. **Correctif** : `reachableRangeWindow` (fonction pure,
`apps/web/lib/products/reservationRange.ts`) — depuis une ancre A, sont atteignables les dates de
`[L, U]`, U étant la première nuit non réservable **INCLUSE comme date de SORTIE, jamais comme
nuit**. ⚠️ **L'ancre est `range.from`, toujours** : RDP 10 pose `{from: X, to: X}` au PREMIER clic,
donc une détection par `!range.to` ne se déclenche JAMAIS (piège vérifié), et prendre `from` couvre
gratuitement le reclic sur plage complète que `addToRange` ré-étend. Seuil `< qty` jamais 0 ; bornes
`todayInBogota()`/`lastBookableDateIso()` ; une nuit pleine n'est plus une arrivée possible ; et
monter la quantité APRÈS une sélection replie la plage au lieu d'avertir — dernier chemin par lequel
`hasUnavailableNightInRange` pouvait encore parler. **480 tests verts** (domain 263, web 79, admin
138), lint, typecheck, 3 garde-fous, build. **Témoins sur le code livré** : 5 des 7 tests composant
tombent sans le correctif (les 2 autres sont des gardes de non-régression, dit explicitement) ; sur
la fonction pure, rendre la fin exclusive — le comportement des deux bibliothèques — fait tomber 5
tests sur 8. ⚠️ **Aléa** : le commit `437dbdf` (lot PMS parallèle) a emporté `reservationRange.ts`
en cours de rédaction — `reachableRangeWindow` est dans l'historique sous un message « feat(pms) »,
sans son test ni son appelant. À recoller au découpage par chemin.*

*2026-08-27 — journée en trois temps : connecteur LobbyPMS vérifié de bout en bout (spec 24), C2
livré et testé en réel (spec 25), puis **le modèle hébergement mené à son terme (T1 → T3)**.
**T3 : `products.type='hotel'` n'existe plus.** Étape 1 (38c1b55, −2 395 lignes) a retiré l'étage de
l'application ; étape 2 (`20260827220000`) l'a retiré de la BASE — 4 tables, `order_lines.
room_type_id`, `set_room_type_availability`, la valeur `'hotel'` de deux contraintes, et les branches
chambre de ONZE fonctions Postgres. **Méthode, qui était la condition posée le 24/08 pour toucher
`create_order`** : extraction vivante par `pg_get_functiondef` + remplacements exacts **vérifiés en
nombre d'occurrences** (une cible manquée = échec bruyant, jamais un silence). Le garde-fou a servi
4 fois. `resolve_date_price` perd `p_room_type_id` (surcharge + `drop` explicite : un `create or
replace` ne retire pas un paramètre). ⚠️ **Deux tests PORTÉS, pas supprimés** —
`date_range_booking.test.sql` et `create_order_date_range.concurrency.mjs` : ils couvraient la
réservation par PLAGE DE NUITS, que rien d'autre ne couvre, et la branche alojamiento partage le même
verrouillage nuit par nuit. ⚠️ **Leçon d'inventaire** : ma liste de tests venait d'un `grep
room_type` et ratait `create_manual_order_line.test.sql`, qui ne dit que `'hotel'` — c'est la suite
pgTAP complète qui l'a trouvé. ⚠️ **Échecs qui n'en sont pas** : 4 fichiers pgTAP et `partner-agenda`
tombaient sur la POLLUTION de la base locale (60 lignes d'`audit_log` accumulées, 3 réservations le
même jour) — prouvé en vidant les tables dans la transaction du test, pas supposé. **`partner-agenda`
ne nettoie pas derrière lui et se sabote au bout de quelques runs** : défaut réel, à traiter à part.
**T1 LIVRÉ** : `/[locale]/establishments/[slug]` présente le lieu et regroupe ses produits ;
`establishments` gagne `slug` (dérivé par trigger, jamais saisi), `check_in_time`/`check_out_time`
(propriété du LIEU) et `mode` (`rooms`|`whole_house`, repris de la v1 où Bania Travel se loue
entier). ⚠️ **Deux pièges à retenir** : `establishments` n'a PAS de grant SELECT global (révoqué pour
protéger `lobby_api_token`, ré-accordé COLONNE PAR COLONNE — une colonne neuve est illisible, et le
`permission denied` précède la RLS) ; et ne **pas** étendre `update_establishment`, qui remplace tous
ses champs et est appelée par trois chemins de modération — d'où `update_establishment_stay_details`,
étroite. **T2** : `unit_count`, `lodging_kind` (3 valeurs — `whole_house` est TOUJOURS manuel, Lobby
n'a que `privada`/`compartida`), `unit` étendue à `per_house` et enfin ÉCRIVABLE (C4). **T4 non
commencé.** **Connecteur** : une chambre PMS-backed n'était qu'un nom nu dans le catalogue ;
aujourd'hui `glamping` (préprod) affiche description es/en, 6 photos importées, capacité, et sa
dispo vient de Lobby en direct. **C1 RÉFUTÉ par la sonde puis ROUVERT par le test live** — CAMPER Van
(49823) refuse la création d'un booking là où GLAMPING (29376) réussit, même code : la distinction de
juillet est vraie, mais visible seulement par un booking réel, donc derrière `TESTLIVE`. **C5
répondu** : `restrictions` vaut `{0,0,0}` sur les six catégories. **Bonus** : `plans[].prices[]` a
autant d'entrées que la capacité d'une unité — les prix Lobby sont par niveau d'occupation, modèle
que hifago n'a pas. **C2 vérifié en réel** (spec 25) : booking créé puis annulé chez Casa Kayam. Le
test live a trouvé 3 défauts invisibles en local — le trigger enfilait sur `fulfilled`/`no_show`
(hifago aurait annulé des séjours EFFECTUÉS) ; `cancellation_reason` est un CODE fermé
(NS/RC/RE/TTC/CC/OTH) ; le succès de Lobby se lit **dans le corps**, jamais dans le statut HTTP — le
serveur de fixtures répondait 200 à tout, un faux Lobby plus poli que le vrai. **Infra, trois couches
de la même panne** : les Edge Functions n'avaient JAMAIS été déployées, les secrets Lobby n'ont
JAMAIS été posés côté Supabase (`supabase secrets list` ne renvoie que les 7 auto-provisionnées), et
le Vault était vide — les crons tournaient à vide en silence depuis le 19/08. Réglé ; `pms_service_
role_key` posée par une fonction jetable, sans transiter par un humain. ⚠️ Import Deno : un import
SANS extension `.ts` casse le boot, invisible au typecheck, au lint et aux 378 tests. **NON FAIT, à
reprendre** : (1) ⚠️ **`LOBBY_PMS_TOKEN` — révocation DIFFÉRÉE, décision explicite de Jérôme.**
Déclencheur : **la fin de la campagne de tests LobbyPMS**. C'est le seul secret exposé de la journée
qui n'a pas été tourné (celui du relais l'a été). (2) `RESEND_API_KEY` en attente de décision.
(3) `products.check_in_time` fait toujours doublon avec celui de l'établissement — décision de
modèle, pas un nettoyage. **Deux points de cette liste sont tombés le 27/08** : `reserve-nights`
journalise bien le motif d'échec depuis `8b78e03` (le curseur le disait encore ouvert, c'était faux
— vérifié dans l'arbre), et le garde-fou `capacity_exceeds_physical` est PORTÉ sur `products`
(`20260827230000`, dernière pièce de T2) : `dorm` → `unit_count × capacity`, `private`/`whole_house`
→ `unit_count`, et rien ne change pour un produit sans `unit_count`. (5) `alojamiento-pms-backed-
demo` est encore `sellable` en préprod alors qu'il est invendable. **Préprod ALIGNÉE en fin de session** : migration poussée
(`supabase db push`), commits poussés, **les deux apps redéployées** depuis un worktree isolé — la
base était en avance de 4 commits sur le code servi, Vercel n'étant pas branché sur Git. Vérifié
après : `/es` 200, les DEUX pages établissement 200, fiche produit 200, admin `/login` 200 et
`/admin`|`/partner` 307. ⚠️ **INCIDENT à ne pas rejouer** : lancé dans un répertoire SANS
`.vercel/project.json`, `vercel deploy --yes` ne s'arrête pas — **il CRÉE un projet** portant le nom
du répertoire courant et y déploie. Un projet `deploy-wt` est ainsi apparu dans l'équipe (build en
erreur, supprimé aussitôt). Cause : ma première tentative avait été refusée par le classifieur AVANT
d'avoir écrit le `project.json`, et je ne l'ai pas revérifié en réessayant. **Vérifier l'existence de
`.vercel/project.json` juste avant CHAQUE `vercel deploy`** — le mode d'échec n'est pas une erreur,
c'est une ressource créée en silence. Aussi : `vercel project rm` n'accepte pas `--yes`, et `yes |`
part en boucle infinie sur son prompt. **`vercel deploy` reste dangereux hors worktree isolé** (il
envoie le répertoire local TEL QUEL, non-commités compris) et doit partir de la RACINE du monorepo
(depuis `apps/web`, le CLI double le chemin). Le relais : `systemctl restart`, jamais `reload` —
systemd ne relit l'`EnvironmentFile` qu'au démarrage.*

*2026-08-24 (suite 3, session distincte) — spec 23 (`docs/specs/23-notifications-email-
transactionnelles.md`) écrite et implémentée intégralement, Tranche 1 + Tranche 2 (8 événements).
Premier fournisseur email du projet : **Resend** (tranché cette session — offre gratuite 3
000/mois vs 100/mois chez Postmark), file Postgres + journal d'envoi + Edge Function
`send-notification-emails`, sur le patron déjà validé du connecteur LobbyPMS. Tranche 1 (aucune RPC
de réservation/paiement touchée) : invitation partenaire par email, notification admin "nouvelle
proposition"/"exception de réconciliation" (triggers), notification partenaire "proposition
traitée". Tranche 2 (`create_order`/`apply_payment_webhook`, les 2 RPC les plus sensibles) :
commission attribuée, paiement effectué, confirmation client, blocage camp/evento.

**Workflow multi-agents de challenge lancé sur demande explicite** ("relance le challenge du
plan") : 78 agents, 6 dimensions, 11 findings confirmés. Deux corrections majeures : (1) erreur de
lecture du cahier des charges — un événement "rattachement établissement en attente" inventé
(le texte réel dit "demande d'ouverture prestataire en attente", parcours self-service jamais
construit en code) retiré, remplacé par un événement réellement décidé mais oublié (blocage
camp/evento). (2) isolation des échecs de notification renforcée : `query_canceled` (exclu par
`when others` en PL/pgSQL) + isolation PAR DESTINATAIRE (pas par boucle entière) + reprise des
lignes bloquées à `sending` (`Idempotency-Key` Resend) + revokes explicites + réponse HTTP agrégée
+ fault-injection réelle exigée plutôt qu'une supposition sur `exception when others`.

**2 régressions trouvées en testant, pas en écrivant le code** : trigger "nouvelle proposition"
perdait le nom d'une entité en cours de création (jointure sur `product_id`/`establishment_id`
NULL, kind='create' — corrigé) ; `create_partner_invitation` cassée par une surcharge de fonction
(`create or replace` avec un paramètre en plus ne remplace jamais une signature différente en
Postgres — corrigé en supprimant explicitement l'ancienne). `create_order`/`apply_payment_webhook`
modifiées via `pg_get_functiondef` (définition live extraite de la base, insertion programmatique)
plutôt que retapées à la main — 647/65 lignes, risque de transcription trop élevé pour les 2 RPC
les plus critiques du système (leçon tirée d'avoir déjà mal lu une version historique de
`moderate_product_proposal` plus tôt dans cette même session).

**Vérifié** : pgTAP complet 816/816 (4 fichiers pré-existants en échec, accumulation `audit_log`
déjà documentée, sans lien) ; 3 nouveaux fichiers pgTAP dédiés (44 cas dont la fault-injection sur
`apply_payment_webhook`, jugée le test le plus important de la spec) ; nouveau test de concurrence
`claim_notification_email_batch` (SKIP LOCKED) ; `create_order_camp.concurrency.mjs` existant
rejoué propre (5×20) après modification de `create_order` ; test d'intégration Edge Function
(fixtures Resend locales) vert ; e2e Tranche 1 + e2e paiement/camp existants rejoués (1 flake de
navigation confirmé environnemental à la reprise, cf. §11 point 10) ; typecheck/lint propres.

**Non fait, signalé, hors périmètre** : aucun envoi réel vérifié (pas de domaine Resend
disponible) ; gap `verify_jwt` des Edge Functions (déjà présent pour `pms-poll-bookings`, pas
introduit ici) ; 9 points laissés explicitement ouverts en spec §10 (langue, seuils de retry,
destinataire exact "paiement effectué", etc.) — aucun tranché en silence. **Aléa de concurrence
constaté sans y toucher** : deux autres sessions ont modifié ce même fichier CLAUDE.md et le journal
pendant cette session (entrées "agenda socio"/"retest Mercado Pago" ci-dessous, désormais empilées
sous celle-ci plutôt qu'écrasées) — aucune collision de fichier de code, seulement ce curseur commun.
Détail complet (tous les findings, tout le code, toutes les corrections) :
`hifago/docs/journal/2026-08.md` (2026-08-24, suite distincte). Rien commité, en attente d'une
demande explicite.*

*2026-08-24 (suite 2) — agenda socio (`/partner`) : bug trouvé par Jérôme en testant manuellement,
une réservation `Expirada` s'affichait dans le calendrier. Root cause : la requête `order_lines` de
`page.tsx` ne filtrait aucun statut (spec 20 §10 point 9, jamais câblé). Fix :
`.in("status", ["reserved", "fulfilled", "no_show"])`, excluant `cancelled_by_client`/
`cancelled_by_provider`/`expired`/`superseded` (ce dernier ajouté de ma propre initiative — doublon
fantôme laissé par `modify_order_line`). Extension `partner-agenda.spec.ts` (3 lignes basculées vers
ces statuts via `withDb`, confirmées absentes ; `no_show` confirmé toujours visible), 1/1 passe,
typecheck+lint clean. Détail : `hifago/docs/journal/2026-08.md` (2026-08-24, suite 2). Rien commité.*

*2026-08-24 (suite) — retest complet du paiement Mercado Pago en local, jusqu'à confirmation réelle
en base (`orders.payment_status='paid'`, `mp_payment_id` réel). Activité de test dédiée créée
(`test-pago-manual-20-cupos`, 20 cupos/jour), tunnels `cloudflared` relancés (les précédents étaient
morts). Trouvaille principale : les vraies notifications webhook Payment/Merchant order envoyées par
Checkout Pro échouent en `SignatureMismatch` malgré un secret confirmé identique et un code de
vérification prouvé correct (via `Simular notificaciones`, qui valide sans problème avec le même
secret) — 8 formats de manifest testés, aucun ne correspond ; root cause non élucidée côté Mercado
Pago, nouveau piège empirique §11 point 19. Contourné en rejouant le webhook avec une signature
forgée localement (sûr : `apply_payment_webhook` re-vérifie toujours le paiement en direct auprès de
l'API Mercado Pago avant de rien confirmer). **À surveiller avant tout déploiement staging/prod** —
pas de contournement shell possible à distance si le symptôme se reproduit. Détail complet :
`hifago/docs/journal/2026-08.md` (2026-08-24, suite). Rien commité (net zéro changement de code, le
debug temporaire a été retiré).*

*2026-08-24 — correction du bug `expire_stale_payment_orders` sur les réservations walk-in (ouvert
depuis le 2026-08-18, repris pendant que les chantiers LobbyPMS bloquants attendaient une action de
Jérôme indisponible). Root cause : `create_manual_order_line` ne touche jamais `payment_status`
(reste à son défaut `unpaid`), donc le job pg_cron expirait toute réservation walk-in 30 min après
sa saisie comme une vraie commande en ligne abandonnée — 88/102 `order_lines` locales déjà `expired`
à tort au moment du constat. Fix (migration `20260824010000`, CREATE OR REPLACE, signature
inchangée) : exclusion des commandes portant `commission_case='operator_manual'` sur au moins une
ligne (invariant vérifié : une commande walk-in est toujours 100% manuelle, jamais mixte). Nouveau
cas 19 dans `payments.test.sql` (`plan` 41→42). **Vérifié** : suite pgTAP complète 772/772,
migration appliquée via `supabase migration up --local` (jamais `db reset`). **Non traité,
signalé** : les lignes déjà expirées à tort avant le fix (données locales/seed uniquement, hifago
pas en production) — aucune réparation de données sans accord explicite de Jérôme ; l'affichage
"Sin pagar" d'un walk-in dans la fiche cliente admin reste techniquement vrai mais potentiellement
trompeur (cosmétique, hors périmètre). Détail complet : `hifago/docs/journal/2026-08.md`
(2026-08-24). Rien commité, comme le reste de cette session — en attente d'accord de Jérôme.*

*2026-08-23 (suite, session distincte) — relais réseau IP stable LobbyPMS provisionné pour la
préprod : instance Vultr (région Miami, ~3 $/mois avec IP réservée — Oracle Cloud puis Hetzner
écartés en cours de session, cf. §9) à l'IP réservée `104.207.147.127`, reverse-proxy Caddy
authentifié (`X-Relay-Secret`, généré côté serveur, jamais connu de l'agent) vérifié bout-en-bout
contre le vrai `api.lobbypms.com` (réponse JSON réelle de Lobby, jeton factice, IP pas encore
déclarée côté Lobby). Durcissement SSH/ufw/unattended-upgrades vérifié après un piège cloud-init
silencieux (mauvais magic header). Supervision double (ntfy.sh + UptimeRobot) confirmée active.
Code : `relaySecret` optionnel ajouté à `lobbyClient.ts` (6 fonctions, additif) et câblé sur 4 des
5 call sites — `getNightAvailabilityWindow.ts`/`night-availability/route.ts` laissés à la session
LobbyPMS parallèle (fichiers non commités par elle, coordination faite par message). `LOBBY_API_
BASE_URL`/`LOBBY_RELAY_SECRET` posés sur Vercel `staging` (web+admin) — un déploiement propre a
nécessité un worktree git isolé (le checkout partagé aurait embarqué le travail non commité d'une
autre session dans le build) et 2 dépendances fantômes supplémentaires corrigées
(`@hifago/e2e-support`, `@tanstack/react-table` dans `packages/ui`). Commits `5f5b792`/`affa065`/
`3993a2d` sur `main`. **Point bloquant restant, action Jérôme requise** : déclarer
`104.207.147.127` dans LobbyPMS (Configuraciones > Acceso Api) avant tout appel réel contre Casa
Kayam — non fait durant cette session. Détail complet (tous les pièges empiriques) :
`hifago/docs/journal/2026-08.md`, entrée "relais réseau IP stable LobbyPMS provisionné (préprod)".*

*2026-08-23 (session en pause, en attente de Jérôme sur 2 points) — déploiement préprod Vercel de
`apps/web`/`apps/admin` : équipe dédiée `vercel.com/hifago` créée (compte perso `cosmogab`
initialement connecté, ambiguïté signalée avant toute création), deux projets scopés Root Directory
(`hifago-web`→`apps/web`, `hifago-admin`→`apps/admin`), Custom Environment `staging` configuré sur
les deux (branche `staging` créée sur le remote), Deployment Protection (SSO) désactivée sur
`staging` (décision explicite de Jérôme — plus simple à tester, préférée à la fermeture par défaut).
**Déploiements réels vérifiés** (pas juste supposés) sur l'infra Vercel + smoke test anonyme passé :
`https://hifago-web-env-staging-hifago.vercel.app` (catalogue avec vrai contenu seedé, fiche
produit `200`) et `https://hifago-admin-env-staging-hifago.vercel.app` (login rendu, `/admin`
protégé redirige `307`).

**Trois vrais pièges monorepo/Vercel trouvés et corrigés en déployant pour de vrai** (détail complet
`docs/journal/2026-08.md`, 2026-08-23) :
1. Dépendances fantômes non déclarées (`@tanstack/react-table` manquant dans `packages/ui`,
   `@hifago/e2e-support` manquant dans `apps/web`/`apps/admin`) — masquées par le hoisting npm local,
   cassent l'install scopée Vercel. Corrigé dans les `package.json` (changements encore **non
   commités**, attente accord sur branche/PR pour ne pas interférer avec la session parallèle
   LobbyPMS en cours sur `main`).
2. Mauvaise détection de framework spécifique à `hifago-admin` (`@vercel/static-build` choisi au
   lieu de `@vercel/next` malgré un `next build` réussi) — corrigé en posant `framework=nextjs`
   explicitement via l'API sur les deux projets. **À faire systématiquement pour tout futur projet
   Vercel de ce monorepo, jamais compter sur la détection zero-config.**
3. Changer `framework` sur un projet **après** qu'un déploiement soit déjà live a cassé le routing
   edge de ce déploiement (`hifago-web` renvoyait `404 NOT_FOUND` sur toutes les routes, y compris
   hors middleware) sans nouveau déploiement déclencheur — corrigé par un redeploy à froid
   (`vercel deploy --force`). **À retenir : après tout changement de réglage projet zero-config,
   refaire un déploiement frais plutôt que supposer le déploiement existant toujours valide.**

**4 secrets posés** (`SUPABASE_SERVICE_ROLE_KEY`, `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_WEBHOOK_SECRET`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) — tentative de les poser via CLI
bloquée à deux reprises par le classificateur de sécurité auto mode de Claude Code (refuse tout
secret en clair dans une commande Bash, cohérent avec §8.2, pas contourné) : **Jérôme les a posés
lui-même** dans le dashboard Vercel en "Shared Environment Variables" d'équipe scopées sur `staging`
des deux projets — confirmé via API (`vercel env ls` ne les affiche PAS, cette commande ignore les
variables "Shared", piège CLI à noter). Redeploy des deux apps fait, smoke test post-secrets passé
(pages clés `200`, redirections cohérentes, aucun `500`) — connexion authentifiée et paiement
bout-en-bout non testés (pas de mot de passe de compte de test redemandé cette session).

**1 point encore bloquant** : connexion Git GitHub↔Vercel impossible avec le compte `cosmogab` (pas
admin sur `casakayam/hifago-2.0`, ne peut pas autoriser la GitHub App Vercel) — donc pas encore de
redéploiement auto sur push, seulement des déploiements CLI ad hoc cette session. Nécessite que
Jérôme (ou un admin de l'org `casakayam`) autorise la GitHub App Vercel depuis GitHub.*

*2026-08-21 (suite session parallèle) — préprod cloud `hqldjdzgvhfwoqypwzqx` désormais **entièrement
seedé** (identité, catalogue, commandes, ledger, réconciliation PMS, campagne) et vérifié en
conditions réelles bout-en-bout. MCP Supabase confirmé connecté cette fois (scopé à ce seul projet,
pas de niveau organisation exposé — `get_project_url` + recoupement CLI `status -o env`/`projects
list`, aucune ambiguïté). Seed débloqué via nouveau `supabase/scripts/seed_auth_users.mjs` (API
Admin Auth, `createUser({id, email, ...})` — `id` fixe confirmé accepté empiriquement bien
qu'absent du type TS) remplaçant les 4 `insert into auth.users` directs de `seed.sql`. **Nouveau
piège cloud** (`CLAUDE.md` §11 point 17) : `supabase db push --include-seed` échoue sur
`partner_capabilities` (rôle éphémère `cli_login_postgres` du CLI, droits effectifs différents de
`postgres` malgré un `current_user` identique en apparence, mécanisme exact non élucidé) —
contournement vérifié : appliquer le seed via `mcp__supabase__execute_sql` à la place. Vérifié
bout-en-bout : connexion mot de passe réussie (local + cloud), écran catalogue et fiche produit
(bloc établissement) confirmés servis depuis le cloud via `apps/web` basculé temporairement puis
remis en local proprement (`apps/admin` jamais touché, session Firefox active dessus). Point de
sécurité récurrent (3ᵉ occurrence, §11 point 18) : clé `service_role` legacy encore affichée en
clair par `supabase projects api-keys` sans `--reveal` — signalé à Jérôme, rotation à envisager.
Détail complet : `hifago/docs/journal/2026-08.md` (2026-08-21, suite session parallèle).

*2026-08-21 — connecteur LobbyPMS (spec 21 §13) : gap disponibilité live côté client comblé.
`GET /api/pms/night-availability` (Route Handler public, appelé depuis `LodgingReservationForm.tsx`
— jamais depuis `page.tsx`/Server Component, pour ne jamais bloquer le rendu SSR sur des appels
Lobby) alimente enfin le calendrier client d'un logement PMS-backed (Casa Kayam), qui affichait
jusqu'ici un calendrier où rien n'était jamais grisé (faux-positif silencieux, `product_availability`
toujours vide pour ce cas). Ne lit que `available_rooms` (jamais un prix — Lobby n'est jamais la
source du prix côté hifago). Nouveaux modules `packages/domain/src/pms/`
(`getNightAvailabilityWindow`/`parseLobbyNightAvailability`/`nightAvailabilityCache`, échec isolé
par nuit OMIS jamais fabriqué — fail-closed gratuit via `hasUnavailableNightInRange`). Anti-survente
réelle inchangée (`POST /bookings` chez Lobby reste juge final). Bug de test trouvé en faisant
tourner le test (pas de bug applicatif) : le modifier CSS "nuit pleine" s'applique par
react-day-picker au `<td>`, pas au `<button>` — corrigé côté test uniquement. **Vérifié** : Vitest
`packages/domain` 116/116, typecheck/lint propres, e2e `apps/web` 13/13 en séquentiel (échecs à 4
workers = contention sur le serveur dev partagé, pas une régression, confirmé en isolation).
Nouveau test `reserve-lodging-pms-availability.spec.ts`. Détail complet :
`hifago/docs/journal/2026-08.md` (2026-08-21).

*2026-08-20/21 (suite 9, feature 32) — dernière entrée : parcours client testable de bout en bout
sur `apps/web`, **prouvé jusqu'au bout** (paiement réel approuvé + `payment_status='paid'`
confirmé par webhook re-vérifié auprès de Mercado Pago). Construits : recherche/filtre + cartes
riches sur l'accueil (`CatalogBrowser.tsx`), bloc établissement sur la fiche produit
(`ProductDetailView.tsx`, corrige au passage le piège §11.16 déjà présent sur ces 2 routes),
inscription client complète (`signup/`, `verify-email/`, `auth/callback/route.ts`, template
`confirmation.html` rendu dynamique via `{{ .RedirectTo }}`, `config.toml`/`proxy.ts` mis à jour),
pré-remplissage checkout pour un compte connecté. Régression trouvée et corrigée en faisant tourner
les tests : `apps/admin/e2e/auth-connection-complete.spec.ts` (lien codé en dur cassé par le
template dynamique) — rejoué vert. Runbook tunnel exécuté (cloudflared, confirmations explicites
à chaque étape sensible, §8.3) : bug CORS/Private-Network-Access trouvé et contourné (2e tunnel
pour Supabase local), long diagnostic par élimination sur `"una de las partes es de prueba"` côté
Mercado Pago (résolu : connexion préalable au compte acheteur de test requise par Checkout Pro,
doc officielle vérifiée), webhook final déclenché manuellement avec signature HMAC valide après
qu'une tentative a routé sa `notification_url` vers `localhost` injoignable (même piège documenté
la veille) — notre route a re-vérifié le paiement en direct auprès de Mercado Pago avant de rien
confirmer. **Vérifié** : `next build`/typecheck/lint verts `apps/web`+`apps/admin`, e2e `apps/web`
12/12, Vitest 14/14, `payments.status='approved'`/`orders.payment_status='paid'` en base avec un
vrai `mp_payment_id`. `.env.local` reverti à l'état local après coup. **Rien commité** — en attente
d'une demande explicite de push. Détail complet (dont les 8 entrées précédentes du 2026-08-20) :
`hifago/docs/journal/2026-08.md` (2026-08-20, suite 2/3/4/5/6/7/8/9).

*2026-08-19 (suite 2) — connecteur LobbyPMS (spec 21), Tranche 1 complète
implémentée (8 phases : schéma, `create_order` étendu, module `packages/domain/src/pms/`, Route
Handlers, branchement `CheckoutForm.tsx`, **deux premières Edge Functions jamais écrites dans ce
dépôt** + `pg_cron`/`pg_net`/Vault, UI admin, seed/fixtures/tests). Décisions Jérôme : périmètre
complet, `lobby_api_token` texte RPC-only (jamais chiffré), poll 15 min/lot 20. Test local du point
dur (`pg_net` émet un vrai appel HTTP depuis Postgres, invisible à tout mock JS) résolu et VÉRIFIÉ
empiriquement : `supabase/functions/.env` pointe `LOBBY_API_BASE_URL` vers un serveur de fixtures
`node:http` local (`packages/e2e-support/src/pmsFixtureServer.ts`), nouveau
`npm run test:pms-integration` (`tests/pms-integration/`) confirme la vraie Edge Function locale de
bout en bout. Tout vert : pgTAP (691 tests), Vitest (domain/web/admin), 4 e2e Playwright admin
(séquentiel — workers>1 fait échouer le login TOTP partagé, aléa consigné ci-dessous), typecheck/
lint propres. **2 bugs trouvés en faisant tourner les tests, pas en écrivant le code** : (1)
régression introduite par cette session — le `REVOKE`/`GRANT` colonne sur `establishments` (cacher
`lobby_api_token`) cassait `update_establishment` préexistante (`select *`, security invoker) →
403 sur TOUTE édition d'établissement — corrigé (migration `20260819150000`, colonnes explicites) ;
(2) bug **pré-existant, sans lien**, confirmé dans le commit HEAD avant cette session —
`productTypeGating` importé depuis un fichier `"use client"` par un Server Component cassait 500
l'édition de N'IMPORTE QUEL produit — corrigé (extraction `productTypeGating.ts` sans `"use
client"`) en mode autonome, **à faire valider par Jérôme a posteriori**. **Gap connu, signalé, pas
implémenté** : aucune route ne lit la disponibilité Lobby pour l'affichage client (calendrier de
dates) — seule l'écriture (après `create_order`) consulte réellement Lobby ; anti-survente intacte
(Lobby reste juge final au booking), mais l'expérience "voir les dates dispo avant de réserver"
manque pour un établissement PMS-backed — à raffiner dans une future spec. Détail complet
(SQL/TS exacts, plan d'implémentation) : `hifago/docs/journal/2026-08.md` (2026-08-19, suite),
spec 21 §13.

*2026-08-19 (suite) — feature "Mi cuenta" — écran de réglages de compte socio
(`/partner/account`, jusqu'ici inexistant) + logout (jusqu'ici absent de tout `apps/admin`).
Décision reprise en cours de session après échange avec Jérôme : nom/WhatsApp vivent sur des
colonnes individuelles neuves `partner_accounts.full_name`/`phone` (RPC `security definer`
`update_my_account_profile`), PAS sur `partners.display_name`/`phone` (organisation, potentiellement
partagée par plusieurs comptes de connexion — mauvais niveau pour un écran "mon compte"). Email de
connexion (`auth.updateUser({email})`, double confirmation déjà configurée) et mot de passe (même
pattern que `ResetPasswordForm.tsx`) inclus dès cette v1. `LogoutButton.tsx` partagé
(`apps/admin/components/`) posé à deux endroits (nav + page compte, demande explicite). Migration
`20260819100000_partner_account_self_profile.sql`. 1 test e2e chemin heureux vert, typecheck/lint
propres. Hors périmètre signalé (pas corrigé) : `partners` porte toujours un `grant update` +
policy RLS trop permissive (n'importe quelle colonne, y compris `status`), jamais consommée par
aucun code — cette feature ne l'utilise plus du tout, mais la porte reste ouverte pour qui voudra
un jour l'exploiter. **Aléa de concurrence rencontré** : `partner-commissions.spec.ts` échoue
désormais (partenaire seedé `operadorPropuestas` sans plus aucune ligne `ledger_entries`, partenaire
`b0000000-…-0003` disparu de `partners`) — confirmé sans rapport avec cette session (aucun fichier
touché ici ne référence ces tables), une autre session a fait évoluer la base locale partagée
entre-temps. Détail complet dans `hifago/docs/journal/2026-08.md`.

**2026-08-18 (suite 6)** — spec 19 Tranche 1 (capture Mercado Pago) — `CheckoutForm.tsx`
désormais BRANCHÉ de bout en bout (entrée précédente : couche DB + API livrée, UI volontairement en
attente de vraies clés). Jérôme a créé une app sandbox Mercado Pago Colombia et fourni les
identifiants réels au fil de la conversation — consolidés dans deux fichiers **locaux, gitignorés**
(ligne `.gitignore` ajoutée explicitement pour le second, vérifiée par `git check-ignore`) :
`apps/web/.env.local` (`MERCADOPAGO_ACCESS_TOKEN`) et `hifago/mercadopago-sandbox-test-data.md`
(comptes/cartes de test, jamais lu par le code). `MERCADOPAGO_WEBHOOK_SECRET` toujours manquant —
n'a pas bloqué le branchement de la capture.

**`CheckoutForm.tsx`** : `create_order` réussi enchaîne `create_payment_intent` (RPC directe) →
`POST /api/payments/create` → `window.location.href = init_point`, redirection réelle vers Checkout
Pro. Nouvel état `pendingOrderId`/`paymentError` avec bouton « Reintentar pago » si le paiement
échoue APRÈS une réservation déjà réussie (cupo déjà consommé — jamais un retour silencieux à
l'écran panier qui ferait perdre la réservation).

**11 specs e2e mises à jour** (7 `apps/web` + 4 `apps/admin`, toutes celles qui empruntaient
`CheckoutForm.tsx`) — nouveau helper `mockMercadoPagoCheckout(page)`
(`packages/e2e-support/src/payments.ts`) : mock UNIQUEMENT `/api/payments/create` (`create_order`/
`create_payment_intent` restent de vrais appels RPC), jamais de vrai paiement ni de vraie navigation
externe en CI. **2 classes de bugs trouvées EN FAISANT TOURNER les tests, pas en écrivant le code** :
(1) race condition — `order-success` est un état transitoire que la redirection mockée (quasi
instantanée) peut remplacer avant que Playwright ne l'observe (symptôme sans ambiguïté :
"navigated to ..." dans l'erreur) — corrigé via `page.waitForURL(redirectUrl)` partout, course
`checkout-error` vs `waitForURL` dans `reserve-concurrency.spec.ts` ; (2) FK manquantes dans le
nettoyage e2e partagé `resetAvailability` (`packages/e2e-support/src/db.ts`) — `payments.order_id`
(cette session) ET `ledger_entries.order_line_id` (Tranche 0, préexistant, jamais déclenché avant
qu'un test tournant en boucle avec `SEED-REFACTIVE` ne le révèle) référencent `orders`/`order_lines`
sans être purgées avant le `delete` — corrigé, plus `pms_reconciliation_entries`/
`availability_blocks` par précaution (même risque structurel, cf. requête `pg_constraint`).

Vérifié à froid : les 11 e2e passent individuellement ET en lots naturels ; un seul flake sous 4
specs admin empilées, non reproductible isolément, symptôme déjà documenté §11 point 10 (pas une
régression). pgTAP même baseline (6 fichiers). Typecheck/lint propres, unit tests verts (`apps/web`
10, `apps/admin` 89, `packages/domain` 41).

Détail complet (design `create_payment_intent`, wrapper SDK, route handlers, branchement UI, les 2
classes de bugs) dans `hifago/docs/journal/2026-08.md`.

Toujours en attente (fusionné avec les entrées précédentes) : `MERCADOPAGO_WEBHOOK_SECRET` manquant
→ webhook non testable en conditions réelles (tunnel ngrok/cloudflared ou déploiement nécessaire) ;
page de retour dédiée toujours absente (`back_urls` pointe vers l'écran checkout existant,
suffisant pour ce périmètre) ; Tranche 2 de la spec 19 (remboursement) non commencée.
**2026-08-18 (suite 7, spec 20) — risque `jsonb_to_recordset`/`price_tiers` désormais corrigé
PARTOUT** : le motif signalé ci-dessus (littéral JSON `null` non gardé) a été reproduit en vrai en
créant des données de test réelles pour Jérôme (résa logement sur `gmiro46`) puis corrigé sur
proposition/validation explicite de Jérôme — `resolve_tier_price` + `create_order` +
`modify_order_line` (migration `20260818240000`, mêmes signatures, 3-4 sites normalisés chacune),
pgTAP des 4 RPC concernées rejoué (0 échec). Recherche exhaustive confirmée : plus aucune fonction
vivante n'appelle `jsonb_to_recordset(price_tiers)` sans cette garde. Détail complet :
`hifago/docs/journal/2026-08.md` suite 7.

**2026-08-19 (spec 20) — bug de surfacturation réel corrigé : alojamiento facturait qty en double**.
Jérôme a repéré sur la résa de démo (`gmiro46`, Alojamiento 1) une facturation à 1 600 000 au lieu de
800 000 (4 nuits × 200 000). Root cause (bug préexistant, Tranche 2, avant cette session) :
`create_order`/`modify_order_line` multipliaient le tarif nocturne (déjà résolu par palier
d'occupants via `resolve_tier_price`, spec 12 §0) ENCORE une fois par `qty`(personnes) — jamais le
même bug que la branche chambre d'hôtel (qty = lits/chambres distincts, multiplication correcte
là-bas, non touchée). Corrigé après confirmation explicite de Jérôme — migration
`20260818250000_fix_lodging_price_double_qty.sql`, signatures inchangées. pgTAP : 1 assertion
obsolète corrigée (`modify_order_line.test.sql` cas L1), suite rejouée à 0 échec. Détail complet :
`hifago/docs/journal/2026-08.md` (2026-08-19).

**Corrigé le 2026-08-24** (était resté ouvert depuis le 2026-08-18, cf. entrée datée en tête de ce
§12) : job `expire_stale_payment_orders` expirait TOUTE réservation walk-in
(`create_manual_order_line`, payment_status jamais touché par cette RPC, resté à son défaut
`unpaid`) 30 min après sa saisie au comptoir, exactement comme une vraie commande en ligne jamais
payée — 88/102 `order_lines` récentes déjà `expired` pour cette raison au moment du constat. Corrigé
en excluant du job toute commande dont au moins une ligne porte `commission_case='operator_manual'`
(invariant : une commande créée par `create_manual_order_line` est toujours 100% walk-in, jamais
mixte) — migration `20260824010000`, nouveau cas 19 dans `payments.test.sql` (plan 41→42), suite
pgTAP complète rejouée à 0 échec (772/772). **Pas corrigé** : les lignes déjà expirées à tort par ce
bug avant le fix (données de test/seed local, pas de production réelle à ce jour) — pas de script de
réparation écrit sans accord explicite de Jérôme (règle données, jamais de correction silencieuse).
Spec 20 — palette bleue par défaut de SVAR non harmonisée avec HeroUI (cosmétique), pas de refetch
agenda au changement de vue, `modify_order_line` toujours hors périmètre créneaux horaires ;
fragilité préexistante de `admin-reconciliation.spec.ts` (entrée seedée déjà `resolved`) ;
`admin-home-navigation.spec.ts` sensible à l'exécution en parallèle ; activer les créneaux du jetski
réel via `set_product_slot_capacity` (action de données) ; e2e Playwright pour les écrans créneaux
(spec 18) ; machinerie de tri/filtre par tag catalogue client ; Tranche 4 de la spec 17 ; Tranche 2
des specs 11/12/13 ; connecteur LobbyPMS — décisions spec 21 §10 points 3-5 non tranchées
(traslado↔commission hifago, valeur exacte de `orders.status` en cas d'échec PMS post-confirmation,
chiffrement du token) + tests réels contre le compte Casa Kayam (pas de sandbox chez Lobby, IP du
relais `104.207.147.127` pas encore déclarée côté Lobby par Jérôme, seul point bloquant restant) —
le gap disponibilité live côté client (2026-08-21) et le relais réseau IP stable (2026-08-23, Vultr)
sont tous deux comblés, cf. entrées datées en tête de ce §12 ; correctif `waitForLoadState` sur
`admin-camp-booking.spec.ts` ; lot 2 `LocalizedTextField` établissement ; correction
`admin-evento-vitrine.spec.ts` (`#name-es`) ; sidebar admin non repliée sous `md` ; carte transport
multi-transporteurs groupée `apps/web` ; volume de données accumulé cassant 6 fichiers pgTAP
préexistants (`admin_audit_log`, `catalog_rls`, `partner_offboarding_rpc`, `product_availability_rpc`,
`set_product_availability_socio` — assertions `audit_log` non scopées ; nettoyage périodique de
l'instance locale de plus en plus nécessaire).
Détail complet et historique intégral dans `hifago/docs/journal/2026-08.md` — jamais élagué,
**jamais chargé automatiquement** en session. À ouvrir seulement pour comprendre pourquoi une
décision passée a été prise, ou retrouver un piège déjà rencontré ailleurs qu'en §11 ci-dessus.*

<!-- ANCIEN JOURNAL COMPLET (2026-08-13 → 2026-08-15) DÉPLACÉ VERBATIM VERS
     hifago/docs/journal/2026-08.md LE 2026-08-15 — ne pas recoller ici, ne pas dupliquer. -->

