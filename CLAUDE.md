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
   react-day-picker (sélecteur de dates client, réexporté par packages/ui — le DatePicker natif
   HeroUI v3 est encore "in progress", pas encore évalué comme remplacement), FullCalendar
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
pour l'IP stable exigée par LobbyPMS.

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

## 12. État courant
*2026-08-13 — scaffold initial posé par `/hifago-init` : Next.js (App Router, Turbopack) +
shadcn/ui (button/card/table/calendar) + next-intl (`es`/`en` routés via `app/(public)/[locale]`,
`app/(app)` non localisé pour socio/admin) + bibliothèques tranchées installées + `supabase init`
(pas de `supabase start`, délégué à `/hifago-dev`) + Vitest/Playwright configurés à vide + workflow
`.github/workflows/hifago-ci.yml` (lint/typecheck/unit → intégration Supabase locale → build ;
déploiement preview/E2E/staging/promotion volontairement non branchés, cf. § 8). `npm run build`
passe. Aucune ressource cloud réelle créée.*

*2026-08-14 — restructuration monorepo + design system, décidée par Jérôme (cf. §1, §2) :
scission de l'app unique en `apps/web` (vitrine) + `apps/admin` (admin+socio, sessions
indépendantes) sous npm workspaces, extraction de `packages/ui` (HeroUI v3, deux thèmes
`vitrine`/`admin`), `packages/supabase`, `packages/domain` et `packages/e2e-support`. shadcn/ui
et `@base-ui/react` entièrement retirés (35 écrans migrés vers HeroUI, dont `components/
availability-calendar.tsx`). Nouvelle page `apps/admin/app/login` (login partagé admin+socio,
texte en dur en français comme `/partner/join`). `apps/admin/proxy.ts` minimal (refresh session
seulement) ; `apps/web/proxy.ts` simplifié (perd l'exclusion `admin|partner`, devenue inutile).
`supabase/config.toml` (`additional_redirect_urls`) et `.github/workflows/hifago-ci.yml`
(`--workspaces --if-present`) mis à jour. Correctif au passage : le lien de parrainage généré par
`apps/admin/app/partner/tools/page.tsx` pointait vers l'origine de la requête courante — cassé
par la scission puisque `/r/[code]` vit désormais dans apps/web à une autre origine ; corrigé via
`NEXT_PUBLIC_WEB_APP_URL` (échec explicite si la variable manque, plutôt qu'un lien "undefined/…"
silencieux). Build + typecheck + lint + tests unitaires (23/23) verts sur les deux apps ; e2e
rejoués et verts (22/22 apps/admin, 9/9 apps/web) et concurrency (5/5 runs propres par scénario)
contre Supabase local reseedé. Trois pièges HeroUI/RSC rencontrés en cours de route et corrigés
partout où ils sont apparus, désormais consignés en §2 point 3 et §11 points 2-4 plutôt que
seulement ici : la contrainte `Table.Body` côté Server Component, le rôle réel du trigger `Select`,
et l'input réel d'un `Switch`. `apps/admin/playwright.config.ts` démarre désormais aussi le
serveur apps/web (`webServer` en tableau) puisque plusieurs specs vérifient l'effet d'une action
admin/socio sur la fiche publique. Toujours aucune ressource cloud réelle créée — nom de
sous-domaine d'apps/admin pas encore tranché (cf. `docs/04-architecture-cible.md`).*

*2026-08-14 — Feature 26, création directe d'un partenaire par l'admin, spéc puis codée dans la
même session (`docs/specs/01-admin-creation-partenaire.md`) : table `partner_crm_profile`
(RPC-only, reprise fidèle de `crm.json` legacy), colonne `partner_invitations.partner_id`, RPC
`create_partner_direct` et extension de `consume_partner_invitation` pour s'attacher à un
partenaire déjà créé (`supabase/migrations/20260814233000_partner_direct_creation.sql`) ; écran
`apps/admin/app/admin/partners/new`, champ adresse en **recherche Google Places au fil de la
frappe** (`google.maps.places.Autocomplete`, restreint CO comme le legacy, choisir une suggestion
remplit adresse + lat/lon en un geste ; repli `Geocoder` au blur si l'admin ne choisit rien),
local à l'app (réutilise l'infra Google Maps déjà décidée pour les socios,
`docs/00-modele-de-donnees.md` § Google Maps, no-op si `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` absent) ;
3 tests e2e (`admin-partner-create.spec.ts`).
Build + typecheck + lint + tests unitaires verts, e2e admin complet vert (24/25 — le seul échec,
`admin-partner-registry.spec.ts`, reproduit à l'identique migration retirée/reset, donc préexistant
et sans lien avec cette feature, à consigner au backlog). Piège HeroUI découvert en écrivant les
tests, distinct du Switch déjà connu : le `Checkbox` n'enregistre un clic que sur son `<input>`
réel, jamais sur le wrapper testid même en `{ force: true }` — silencieux, sans erreur Playwright
(§11 point 5, helpers `checkboxInput`/`toggleCheckbox` ajoutés à `packages/e2e-support`).*

*2026-08-14 — Feature 28, création enrichie d'un établissement par l'admin, spéc puis codée dans
la même session (`docs/specs/03-admin-creation-etablissement.md`, brouillon de périmètre resserré
avec Jérôme avant codage — tags/nombre de chambres/slug écartés, "ce qu'on vend dans
l'établissement" explicitement renvoyé à un lot séparé) : colonnes `description`/`address`/`lat`/
`lon`/`operated_directly`/`photo_urls` sur `establishments`, bucket Storage `establishment-photos`
(premier usage de Supabase Storage dans tout le projet — lecture publique, écriture admin),
RPC `create_establishment` étendue et enfin auditée via `log_admin_action` (dette assumée depuis
la Feature 1, réglée au passage — `supabase/migrations/
20260814234500_establishment_presentation_fields.sql`). Nouveau composant partagé
`apps/admin/components/searchable-combobox.tsx` (`ComboBox` HeroUI, pas `Autocomplete` — seul le
premier est un vrai champ de recherche visible, cf. §11 point 7) remplaçant le `Select` brut de
« Partner propietario » (`establishments/new`) ET celui du flux « Transférer un établissement »
(`partners/[id]/EstablishmentsSection.tsx`) — même correctif aux deux endroits, même anti-pattern.
`address-autocomplete.ts` déplacé de `partners/new/` vers `components/` (désormais consommé par
les deux écrans de création). Écran redessiné en blocs `<fieldset>` (Identidad/Partner
propietario/Presentación) sur le pattern déjà validé de `/admin/partners/new` ; nom simplifié à un
seul champ (un nom d'établissement n'est généralement pas traduit, contrairement à sa
description qui reste bilingue via un nouveau switcher ES/EN au-dessus d'un champ unique).
Build + typecheck + lint verts, e2e ciblés verts (`admin-establishment.spec.ts` étendu,
`admin-partner-registry.spec.ts` sélecteurs corrigés) — seul échec résiduel :
`admin-partner-registry.spec.ts` sur la bascule "código activo", déjà documenté préexistant et
sans lien (spec 01 §11), reproduit à nouveau y compris juste après un `db reset` complet.*

*2026-08-15 — Feature 27, sidebar de navigation + page d'accueil admin
(`docs/specs/02-admin-accueil-et-navigation.md`) : jusqu'ici `/admin` n'était qu'un `redirect`
vide et aucune nav n'existait nulle part (plusieurs écrans injoignables sans taper l'URL).
Nouveau `AdminSidebar.tsx` (Client Component pour `usePathname()`, layout parent reste Server
Component) + vraie page d'accueil (4 KPI cards, 4 graphiques Recharts — première utilisation
réelle de cette dépendance jusque-là jamais consommée — alertes de modération/réconciliation/
capacités en attente, aperçus « top-N + voir tout »). Commissions toujours qualifiées
« generadas », jamais « a pagar » : aucun ledger dû/payé n'existe côté hifago (constat fait en
écrivant la spec, vérifié sur les 30+ migrations), reporté à une future spec dédiée. Pagination
serveur ajoutée partout (lacune G15 enfin traitée) : nouveaux `resolvePageParams`
(`packages/domain`) et `ServerPagination` (`packages/ui` — nommé ainsi, pas `Pagination`, pour ne
pas entrer en collision avec l'export du même nom déjà fourni par HeroUI) ; retrofit sur
`/admin/partners`/`/admin/establishments` (mécanique) et `/admin/orders` (plus délicat : le
filtre statut passe désormais serveur, le tri reste côté client sur la page courante — repli
explicitement documenté dans la spec plutôt que de reconstruire tout `OrdersTable` en
`manualSorting`). Trois écrans manquants créés (nécessité technique de la sidebar, pas un
périmètre inventé) : `/admin/clients` (nouvelle RPC `list_clients`, construite sur `orders`
dédupliquées — ni `auth.users` ni `partner_accounts` ne portent de nom, et se limiter aux comptes
exclurait tout client invité), `/admin/campaigns` et `/admin/products`+`[id]` (listes manquantes,
même patron que `proposals`/`reconciliation`). Suite e2e complète (26 tests) rejouée avant et
après ce lot : 6 échecs, tous confirmés préexistants ou hors périmètre (4 sur
`NewEstablishmentForm.tsx` restructuré par la feature 28 en parallèle, 1 le bug switch "código
activo" déjà connu, 1 un flake de clic sur un lien "Ver" qui n'affecte ni la donnée ni la
pagination — vérifié par navigation directe à la même URL, qui fonctionne). 6 nouveaux tests
e2e ajoutés (`admin-home-navigation.spec.ts`). Build + typecheck + lint + tests unitaires verts
sur tout le monorepo (`resolvePageParams` testé en Vitest, 6 cas).*

*2026-08-15 — Gestion des images (`docs/specs/04-gestion-images.md`, spéc puis codée dans la même
session, pas de numéro de feature attribué) : remplace le mécanisme provisoire `photo_urls`
livré par la feature 28 (`establishments.photo_urls text[]`, bucket public sans réordonnancement
ni service partagé, explicitement qualifié « basique et provisoire » par son propre commentaire
de migration). Nouveau modèle relationnel `product_media`/`establishment_media` (miroir du
`product_media` legacy), bucket unique `catalog-media` (l'ancien `establishment-photos` reste
vide et inutilisé — Supabase interdit le `DELETE` direct sur `storage.buckets` en migration SQL,
constaté en écrivant celle-ci), `product_proposals.kind` (`content`/`photos`) pour la proposition
« photos seules » côté socio, 3 RPC (`add_catalog_media` admin, `submit_photos_proposal` socio,
`reorder_gallery` — seule RPC parmi les trois justifiée par l'atomicité et non par l'audit).
Premier usage de `service_role` dans tout `hifago/` (`packages/supabase/src/service.ts`) pour le
Route Handler d'upload (`apps/admin/app/api/upload/[entity]`, pipeline `sharp` repris à
l'identique du legacy socio : rotate EXIF, resize 2400px, WebP q82). Trois composants partagés
`packages/ui` (`ImageCrop` via `react-easy-crop`, `Carousel` via `embla-carousel-react`,
`MediaGallery` — réordonnancement par flèches ‹ ›, pas de glisser-déposer, fidèle au pattern admin
legacy `photoCards()`) : **deux dépendances UI hors de la carte `/hifago-ui` déjà tranchée**,
remontées explicitement à Jérôme au gate `/hifago-review`, pas tranchées en silence. Écrans admin
(galerie produit et établissement), socio (proposer/retirer/réordonner) et modération dédiée
(`ModeratePhotosProposalForm`, aperçu isolé confiné à `apps/admin`) livrés, plus le carrousel
client (`apps/web`, `next/image` avec `priority` sur le premier slide).

Bug réel trouvé en testant : `submit_photos_proposal` retournait `{ok:true, proposal_id:null}`
sans jamais écrire de ligne — la variable `FOUND` de PL/pgSQL, censée refléter le `select ...
for update` ciblant une proposition existante, était silencieusement écrasée par un `select
count(*) into ...` intermédiaire (`count(*)` renvoie toujours exactement une ligne, donc `FOUND`
vaut toujours `true` après lui) ; capturée dans une variable dédiée juste après la requête qui
compte réellement, immédiatement après le `for update`. Deux pièges d'environnement rencontrés et
corrigés au passage, consignés dans le spec §12 pour ne pas les redécouvrir : Tailwind v4 ne scanne
pas de façon fiable `packages/ui/src` depuis les apps de ce monorepo (`@source
"../**/*.{ts,tsx}"` ajouté à `packages/ui/src/styles/globals.css`, corrige pour tout futur
composant du package) ; Next 16 bloque par défaut `next/image` contre un hôte résolvant vers une
IP privée (garde anti-SSRF neuve) — `images.dangerouslyAllowLocalIP = true` posé dans
`apps/web/next.config.ts`, sans risque puisque `remotePatterns` scope déjà l'hôte exact.

Suite complète rejouée : unitaires verts (tous workspaces), e2e `apps/web` (9/9) et concurrence
(tous scénarios anti-survente, 5 runs propres) verts, e2e `apps/admin` 30/34 — les 4 échecs
confirmés non liés en isolant chacun (2 passent seuls, contention de parallélisation ; 1 est le
switch "código activo" déjà documenté préexistant, spec 01 §11 ; 1 est une collision avec le
`route-announcer` interne de Next, sans rapport avec les photos). 2 nouveaux tests e2e
(`admin-product-photos.spec.ts`, `partner-propose-photo.spec.ts`), `admin-establishment.spec.ts`
mis à jour pour le nouveau pipeline crop (le test existant de la feature 28 s'attendait à un
upload direct sans étape de recadrage).*

*2026-08-15 — correctif de reprise sur `NewEstablishmentForm.tsx` (feature 28,
`docs/specs/03-admin-creation-etablissement.md`), en réaction directe à la migration
`20260815110000_gestion_images.sql` ci-dessus qui a retiré `p_photo_urls` de `create_establishment`
et drop `establishments.photo_urls` sans que l'écran établissement ne soit encore adapté : un
premier correctif de reprise (upload direct au bucket `catalog-media` puis `add_catalog_media` par
photo une fois l'établissement créé) a d'abord rendu l'écran de nouveau fonctionnel, avant d'être
lui-même remplacé quelques heures plus tard par le pipeline définitif de la spec 04 (`ImageCrop` +
Route Handler `/api/upload/establishment`), câblé sur ce même écran par la session travaillant sur
la spec 04. Deux collisions d'édition concurrente sur ce fichier unique en une même journée,
observées et documentées en direct plutôt que silencieusement écrasées — cf. `docs/specs/
03-admin-creation-etablissement.md` en-tête pour le détail chronologique complet. Au passage,
4 fichiers e2e utilisant la création d'établissement comme simple fixture (`admin-camp-
booking.spec.ts`, `admin-partner-offboarding.spec.ts`, `admin-product-create.spec.ts`,
`admin-product-publish.spec.ts`) se sont révélés silencieusement cassés par le renommage de
sélecteurs de la feature 28 elle-même (`name-es`/`partner-select` → `nombre`/`partner-search`),
jamais détecté à l'époque faute d'avoir rejoué la suite e2e complète après cette feature — corrigés
et revérifiés ici. Build + typecheck + lint verts, e2e `admin-establishment.spec.ts` (3/3) et les
4 fixtures corrigées (4/4) rejoués verts après le câblage définitif de la spec 04.*

*2026-08-15 — Feature 29, dashboard partenaire + visibilité établissement Prestador + gestion
admin des invitations (`docs/specs/05-invitations-onboarding-dashboard-partenaire.md`) : partie du
soupçon initial de Jérôme (« le code sert de mot de passe ») était infondée — vérifié directement
dans le code, `create_partner_invitation`/`consume_partner_invitation` séparent déjà correctement
un `Código` d'attribution (jamais dans le lien) d'un jeton opaque haché SHA-256, confirmé par
comparatif de maquettes ASCII. Les deux vrais écarts trouvés en creusant le cahier des charges
socio §3b : (1) `/partner` n'avait aucune page d'accueil — `JoinForm.tsx` affichait un message
inline sans jamais rediriger. Nouveau route group `apps/admin/app/partner/(app)/` (garde + nav)
enveloppant `commissions/products/tools` (déplacés, URLs inchangées) ; `join/` reste hors du
groupe, répertoire frère jamais concerné par la garde — point critique vérifié en e2e (le visiteur
non authentifié doit toujours atteindre `/partner/join`). `JoinForm.tsx` redirige désormais vers
`/partner` au lieu d'afficher un message inline. (2) Le rattachement d'établissement du chemin
Prestador, déjà sûr (`partner_capabilities.establishment_id` « en attente » +
`create_establishment` qui rattache automatiquement, index uniques partiels empêchant tout
doublon — mécanique de la spec 03, jamais retouchée ici), n'était visible nulle part côté admin.
Nouveau `/admin/invitations` (liste paginée + révocation, nouvelle RPC `revoke_partner_invitation`)
avec badge « Falta establecimiento » pour un Prestador consommé sans établissement, lien direct
préremplissant `/admin/establishments/new?partner_id=` (petit ajout sur `SearchableCombobox` :
initialisation paresseuse de `query` depuis une `value` déjà fournie, sinon le libellé restait
vide malgré une sélection correcte). Lien de l'alerte home admin « Capacidades de prestador en
revisión » (Feature 27) redirigé vers cette nouvelle liste actionnable. OAuth Google et le
multi-établissement/multi-utilisateur, explicitement laissés ouverts par le cahier des charges,
restent hors périmètre (décision Jérôme). `db reset` complet puis suite e2e rejouée entièrement
(36 tests) : 1 échec pré-existant sans lien (`admin-partner-registry.spec.ts`, switch « código
activo », déjà consigné 3 fois dans les specs 01/02/03) ; `admin-partner-offboarding.spec.ts`
adapté au passage (attendait l'ancien message inline `join-success`). Build + typecheck (2 apps) +
lint + tests unitaires verts.*

*2026-08-15 — deux correctifs signalés par Jérôme le même jour, sur `/partner/join` et `/login` :
(1) la case « J'accepte les conditions » n'avait aucun moyen de faire lire ce qu'elle engage —
nouveau bouton « Voir les conditions » + modale (`PartnerTermsModal.tsx`), contenu factice (lorem
ipsum, un seul document pour référent et prestataire) en attendant le vrai texte. Piège évité :
le bouton est posé HORS de `Checkbox.Content` — c'est un `CheckboxButton` react-aria, toute la
zone est pressable, un bouton imbriqué y aurait aussi basculé la case au lieu d'ouvrir seulement
la modale (vérifié à la fois par capture d'écran réelle et par un test e2e qui bascule
explicitement sur l'ouverture/fermeture de la modale). (2) `/login` (partagé admin+socio) était en
français — erreur : il avait suivi la convention isolée de `/partner/join` au lieu de celle,
dominante, du reste d'`apps/admin` (espagnol). Repassé en espagnol (`Iniciar sesión`, `Correo
electrónico`, `Contraseña`) ; `loginAs` (e2e) passe par l'API Supabase Auth directement, aucun
test ne dépendait du texte français. `docs/specs/05-invitations-onboarding-dashboard-partenaire.md`
mis à jour en conséquence. Build + typecheck + lint verts, e2e `partner-join.spec.ts` et
`admin-partner-offboarding.spec.ts` rejoués verts.*

*2026-08-15 — Feature 30, gestion complète d'un établissement (`docs/specs/06-gestion-
etablissement.md`) : comble un vrai gap (décision cahier admin §3c déjà validée le 2026-08-11 —
« toute la présentation d'un établissement s'édite depuis l'admin » — jamais construite : seules les
photos l'étaient, spec 04) et une absence totale côté socio (aucune création/édition, ni en hifago
ni en legacy, vérifié exhaustivement). Nouvelle RPC `update_establishment` (admin, `security
invoker`, même raisonnement que `transfer_establishment`) + bloc `EstablishmentEditBlock.tsx` sur
l'écran établissement existant. Côté socio, deux gestes toujours en proposition modérée, jamais en
écriture directe (symétrique à `submit_photos_proposal`, spec 04) : `submit_establishment_
creation_proposal` (couvre indifféremment le tout premier établissement d'un partenaire et un
établissement supplémentaire — `create_establishment` gère déjà les deux cas identiquement, un seul
mécanisme) et `submit_establishment_edit_proposal`, nouvelle table `establishment_proposals`
(RPC-only, miroir de `product_proposals` avec `establishment_id` nullable pour `kind='create'` tant
que non approuvée). `moderate_establishment_proposal` réutilise `create_establishment`/
`update_establishment` en interne plutôt que dupliquer leur logique d'écriture. Nouveau sous-arbre
`apps/admin/app/partner/(app)/establishment/` (liste, proposition de création, proposition
d'édition) + extension de l'écran de modération admin existant (`/admin/proposals`, fusion avec
`product_proposals`, nouveau `ModerateEstablishmentProposalForm.tsx`).

**Bug réel trouvé et corrigé avant tout code applicatif** : `update_establishment` référençait
`establishments`/`log_admin_action` sans qualification de schéma — fonctionne appelée directement
par un admin (search_path par défaut), mais casse (`relation "establishments" does not exist`)
appelée en nested depuis `moderate_establishment_proposal` (`set search_path = ''`) ; trouvé en
testant la RPC directement (13 scénarios, script Node signant en tant que comptes seedés réels)
avant de construire l'écran — même discipline que le bug `FOUND` de la spec 04. Corrigé en
qualifiant toutes les références internes en `public.*`.

**Trois aléas d'environnement rencontrés en vérifiant, tous sans lien avec cette feature** (deux
autres sessions travaillaient en concurrence sur ce même dépôt pendant ce travail) : (1)
`node_modules` désynchronisé de `package-lock.json` sur `qrcode`/`@types/qrcode` (ajouté par une
autre session pour une fonctionnalité QR code) — cassait la compilation de `/partner/tools` et, par
propagation Turbopack, des routes sans rapport lors d'un run e2e complet ; `npm install` a suffi
(déjà résolu à la bonne version dans le lockfile). (2) Rollout en cours d'un 2FA/AAL2 obligatoire
pour les comptes admin par une autre session concurrente
(`20260815250000_admin_2fa_aal2.sql`, `checkMfaGuard` sur `admin/layout.tsx` ET
`partner/(app)/layout.tsx`) — le compte seedé admin n'a pas encore de facteur TOTP enrôlé
localement, bloque toute connexion admin programmatique (`loginAs`) derrière `/mfa/enroll` ; a
empêché de rejouer la suite e2e complète et les 2 assertions admin de cette feature au moment de la
vérification finale (déjà passées deux fois proprement plus tôt dans la session, avant ce rollout ;
le scénario socio pur, non concerné par le garde admin, a été re-vérifié après coup et passe). (3)
Le skill `/hifago-ui` documente encore « français pour `/admin/*` » — confirmé obsolète par l'audit
`/hifago-review` (grep exhaustif) : tout `apps/admin` est déjà en espagnol, cf. l'entrée du dessus
sur `/login`. Signalé, non corrigé (hors périmètre de cette spec).

Vérification : RPC testées directement (13 scénarios, tous les garde-fous). `tsc --noEmit` + eslint
propres (monorepo). Vitest vert (29 tests). 4 tests e2e dédiés passés deux fois consécutives avant
le rollout MFA. `npm run test:concurrency` entièrement vert (aucune régression sur les RPC
critiques déjà en place). Audit `/hifago-review` (5 domaines, 10 agents — audit + vérification
adversariale indépendante par domaine) : RLS/RPC-only 🟢, anti-survente 🟢 (hors périmètre), i18n/
SEO 🟢, design system 🟢, fournisseurs écartés 🟢 — aucun écart trouvé.*

*2026-08-15 — Feature 31, connexion/inscription complète
(`docs/specs/07-connexion-inscription-complete.md`) : Google OAuth, inscription libre email/mot de
passe avec vérification par email obligatoire, mot de passe oublié/réinitialisation, et 2FA TOTP
obligatoire pour le rôle admin (`hifago/docs/03-cahier-des-charges-admin.md` §1, décision
2026-08-11/12) — décisions déjà validées, jamais construites. Back-end générique pour les deux
apps (config Supabase Auth, RPC) ; front concentré sur `apps/admin` (`apps/web` déféré). `is_admin()`
étendu pour exiger l'AAL2 quand la capacité admin est active (chokepoint déjà utilisé par toute la
checklist RLS/RPC-only — un seul changement centralisé, vérifié par grep exhaustif que 100 % des
appelants sont des auto-contrôles `is_admin(auth.uid())`), nouveau `has_admin_capability(uid)`
distinct (capacité seule, sans AAL2) pour que le garde applicatif sache rediriger vers
`/mfa/enroll` avant que l'AAL2 soit atteignable. `/partner/join` (Feature 29) reste instantané
malgré `enable_confirmations = true` : nouveau Route Handler `POST /api/auth/invitation-signup`
crée le compte déjà confirmé (`service_role`, `admin.createUser`) puis établit la session,
`consume_partner_invitation` reste l'unique autorité de consommation du jeton.

**Trois vrais bugs trouvés en vérifiant réellement** (navigateur piloté + vrais emails Mailpit, pas
seulement typecheck/lint) : (1) le pré-contrôle du jeton d'invitation ne peut pas lire
`partner_invitations` via `service_role` — cette table est RPC-only, aucun `GRANT SELECT` à ce
rôle (`service_role` contourne la RLS, jamais l'absence de GRANT) — nouvelle RPC
`check_partner_invitation` (`security definer`), même patron que le reste du projet. (2) Un
`friendly_name` NULL dans le facteur TOTP seedé du compte admin de test cassait **toute**
connexion, pas seulement celle de ce compte (`sql: Scan error ... converting NULL to string is
unsupported` côté GoTrue) — le scanner Go attend une chaîne vide, jamais NULL (confirmé par le
comportement du vrai `mfa.enroll()`). (3) Le dispatcher racine (`app/page.tsx`) avait un repli mort
(`redirect("/partner/join")` pour un compte sans aucun rôle) — invisible jusqu'ici puisqu'aucun
compte sans rôle ne pouvait exister avant l'inscription libre (seul `/partner/join`, qui accorde
toujours au moins `referrer`, créait des comptes) ; corrigé vers `redirect("/partner")`, qui
affiche déjà cet état.

Piège d'environnement au passage : les liens email (confirmation/reset) pointaient sur
`127.0.0.1:3101`, cassant la navigation Playwright dont le `baseURL` est `localhost:3101` — Next 16
bloque par défaut les ressources dev cross-origin (`allowedDevOrigins`). Templates et
`additional_redirect_urls` alignés sur `localhost`.

QR TOTP : `mfa.enroll()` renvoie déjà un SVG prêt à l'emploi (`data.totp.qr_code`) — la dépendance
`qrcode` envisagée dans le plan n'a pas été ajoutée (déjà installée par une autre session pour
`/partner/tools`, sans lien avec ce lot).

Nouveau générateur TOTP (RFC 6238 minimal, pas de dépendance) dans `packages/e2e-support/src/
mfa.ts`, secret fixe seedé pour `admin@hifago.test` (`supabase/seed.sql`) — `signInAndCollectCookies`/
`createSignedInClient` complètent désormais le challenge MFA automatiquement quand un facteur est
détecté, sinon toute la suite e2e existante aurait échoué sur l'AAL2. Nouveaux tests
`auth-connection-complete.spec.ts` (signup+confirmation par vrai email, renvoi, mot de passe
oublié/reset par vrai email, bouton Google visible, enrôlement 2FA forcé puis vérification à la
session suivante avec un compte de test dédié — jamais le seed admin partagé).

`db reset` complet puis suite e2e rejouée plusieurs fois : 47-48/50 verts selon les runs, les
échecs résiduels tous confirmés pré-existants et sans lien (switch « código activo », déjà consigné
4 fois ; interaction entre `admin-product-photos.spec.ts` et `admin-product-price-tiers.spec.ts`
sur un établissement seedé partagé, confirmée par isolation, aucun rapport avec l'auth). Un test
existant (`admin-invitations.spec.ts`) adapté en navigation directe plutôt que `.click()` sur un
badge, fragilité de clic déjà documentée (§11) réapparue sous forte accumulation de données de test
sur cette session longue — repasse systématiquement après un `db reset`. Build + typecheck (2 apps)
+ lint + tests unitaires verts.

**Identifiants Google OAuth réels reçus et vérifiés le 2026-08-15** : Jérôme a créé un nouveau
client Google Cloud dédié (projet « hifago », distinct du client legacy `...mk2jv456...` réutilisé
nulle part ici) — `hifago/.env` (gitignoré) porte désormais le vrai `client_id`/`client_secret`.
Flux confirmé de bout en bout par navigateur piloté : clic sur « Continuar con Google » →
redirection réelle vers `accounts.google.com` affichant **« to continue to hifago »**, sans
`redirect_uri_mismatch` ni `invalid_client` — preuve que `client_id`, secret et
`http://127.0.0.1:54321/auth/v1/callback` sont correctement reliés côté Google Cloud Console.
Seule l'étape finale (choisir un compte Google réel et consentir) reste manuelle, comme prévu
(`docs/04-architecture-cible.md` ligne 736 : jamais le vrai écran Google en CI).*

*2026-08-15 — deux correctifs sur un vrai compte Google en test réel par Jérôme, tous deux
invisibles par construction/automatisation (jamais un vrai OAuth Google ni un vrai enrôlement TOTP
n'avaient été testés par un humain avant ce jour) :

**(1) Bug réel — `redirect_to` dynamique jamais validé par une origine nue.** Connexion Google
réussie côté GoTrue (confirmé par les logs : `user_signedup` puis `login`, deux 302), mais
atterrissage sur `http://127.0.0.1:3100/en?code=...` (la vitrine, code OAuth brut affiché dans
l'URL) au lieu d'`apps/admin`. Cause : `additional_redirect_urls` ne portait que des origines nues
(`http://localhost:3101`) — Supabase ne les matche QUE contre un `redirect_to` sans chemin ni
requête ; un `redirect_to` réel (`/auth/callback?next=%2F`) échoue silencieusement la validation et
GoTrue retombe sur `site_url` (port 3100). Les flux email (confirmation/reset) n'avaient jamais
révélé ce bug : leur lien est figé dans le template, jamais validé dynamiquement contre cette
liste. Corrigé en ajoutant des entrées `**` (glob `gobwas/glob`) :
`http://localhost:3101/**`/`http://127.0.0.1:3101/**`.

**(2) Décision — 2FA rendu optionnel.** Un second bug (enrôlement TOTP échouant en conditions
réelles, cause non isolée avec certitude — piste principale : cookies mélangés entre `127.0.0.1`
et `localhost` suite au bug (1), avant son correctif) bloquait complètement l'accès admin de
Jérôme. Décision : `is_admin()` ne requiert plus l'AAL2
(`20260815270000_admin_2fa_optional.sql`, revient à un simple contrôle de capacité) ; les trois
points d'entrée (`app/admin/layout.tsx`, `app/partner/(app)/layout.tsx`, `app/page.tsx`) ne
redirigent plus vers `/mfa/enroll`/`/mfa/verify`. Les deux écrans restent en place et fonctionnels
pour un usage volontaire — `auth-connection-complete.spec.ts` adapté en conséquence (navigation
directe vers `/mfa/enroll` puis `/mfa/verify`, sans redirection de garde à attendre) et rejoué
vert, y compris l'enrôlement réel (QR affiché, code généré, vérifié) — la mécanique elle-même n'est
donc pas cassée en soi, seul un état de session réel dans un vrai navigateur a posé problème. 2FA
obligatoire (`hifago/docs/03-cahier-des-charges-admin.md` §1) reste donc **non conforme
temporairement** — à rouvrir une fois la cause exacte du (2) isolée en conditions réelles.

`db reset` + suite complète rejouée : 47/50 verts, 3 échecs tous déjà confirmés pré-existants et
sans lien avec ce correctif.*

*2026-08-15 — spec 08, gestion CRUD complète d'une activité admin
(`docs/specs/08-admin-gestion-activite.md`) : deux capacités manquantes du cahier admin §3c
(tags multi-valeurs remplaçant la catégorie fixe, suppression réelle avec garde-fou anti-commande)
plus deux extensions demandées par Jérôme en cours de session (prix par palier de quantité/
personnes, bornes min/max par réservation) — comparées point par point à l'app legacy en
production avant construction (règle "refaire pas réinventer") : seule la suppression réelle y
existe déjà à l'identique (`catalogService.deleteProduct`), les trois autres sont des extensions
nouvelles, assumées comme telles. Nouvelles tables `catalog_tags`/`product_tag_assignments` (RLS
directe, aucun critère RPC-only) ; `products.price_tiers`/`min_qty`/`max_qty` (nullables,
additives) ; RPC `delete_product` (`security definer` — pas `security invoker` comme
`set_product_sellable`, car `product_availability`/`product_proposals` révoquent explicitement
INSERT/UPDATE/DELETE pour `authenticated`, un DELETE en `security invoker` y échouerait par
"permission denied" avant même l'évaluation de la RLS). Extension bornée de `create_order` (Phase 1 :
bornes qty par produit remplacent le plafond fixe `qty > 20` ; Phase 4 : résolution du prix par
palier) — aucun changement au schéma de verrouillage, `product_availability` reste keyé
`(product_id, date)`, c'est ce qui distingue cette extension des créneaux horaires (renvoyés à une
future spec 09, structurellement une nouvelle dimension de capacité). Nouveau composant partagé
`apps/admin/components/tags-multiselect.tsx` (`TagGroup`/`Tag`, première utilisation de ces
composants HeroUI dans le projet — API vérifiée dans les `.d.ts`, aucun piège rencontré à l'usage)
et nouvel écran `/admin/tags` (CRUD minimal, mirroir de `RevokeInvitationButton.tsx` pour la
confirmation destructive).

Collision concurrente rencontrée en cours d'implémentation : la migration
`20260815250000_admin_2fa_aal2.sql` (spec 07, autre session) a rendu `is_admin()` dépendant d'une
session AAL2, cassant temporairement toute vérification e2e admin — y compris des tests
préexistants sans lien (`admin-product-photos.spec.ts`) — le temps que `loginAs`/
`createSignedInClient` (`packages/e2e-support`) soient mis à jour pour compléter un challenge TOTP,
puis que la spec 07 revienne sur l'obligation d'AAL2 (`20260815270000_admin_2fa_optional.sql`, cf.
entrée ci-dessus). Travail mis en pause plutôt que contourné, reprise confirmée par un test témoin
avant de relancer la suite complète.

Vérification complète après `db reset` : `create_order.concurrency.mjs` rejoué (2 scénarios, 5 runs
consécutifs propres chacun — aucune régression du verrouillage) ; 4 nouveaux tests e2e
(`admin-tags-catalog.spec.ts`, `admin-product-tags.spec.ts`, `admin-product-delete.spec.ts` — deux
cas, jamais/déjà commandée —, `admin-product-price-tiers.spec.ts` — création via l'écran réel puis
vérification RPC directe des 3 rejets et des 2 résolutions de prix) tous verts ; 16 tests de
régression rejoués verts (`admin-camp-booking`, `admin-partner-offboarding`, `admin-product-publish`,
`admin-product-create`, `admin-product-edit`, `admin-product-photos`, `admin-establishment`,
`admin-establishment-edit`, `admin-home-navigation`). Build + typecheck + lint + tests unitaires
verts sur tout le monorepo.*

*2026-08-15 — correctifs UX sur la spec 08 (`NewProductForm`/`EditProductForm`/`/admin/tags`/
`/admin/products`), signalés par Jérôme après un premier passage visuel (l'e2e par sélecteurs
n'avait pas détecté ces manques — screenshot Playwright pris a posteriori pour diagnostiquer, à
refaire systématiquement pour toute feature UI avant de la déclarer terminée) : (1) **Nom d'une
activité passé à un champ unique "Nombre"** (`nameEs`/`nameEn` retirés), même décision que
l'établissement (spec 03) — un nom d'activité est généralement un nom propre, pas traduit ; reste
stocké `{es: valeur}` dans `name` (jsonb inchangé). Scope volontairement limité aux écrans admin
directs (`NewProductForm`/`EditProductForm`) — les formulaires socio (`EditProposalForm.tsx`,
`ModerateProposalForm.tsx`) gardent `name-es`/`name-en`, non touchés (écriraient dans
`product_proposals.payload`, hors périmètre de ce correctif). (2) **`TagsMultiSelect` sait
désormais créer un tag à la volée** si la frappe ne correspond à aucun tag existant (option
"+ Crear…" dans le `ComboBox`, insert direct `catalog_tags` puis sélection immédiate) — l'admin
n'a plus besoin de passer par `/admin/tags` avant de pouvoir assigner un nouveau tag à une
activité. (3) **Lien "Editar" ajouté directement sur `/admin/products`** (liste) et **bouton
"Editar" (renommer) ajouté sur `/admin/tags`** (`RenameTagButton.tsx`, même patron Modal que
`NewTagForm`/`DeleteTagButton`) — aucun des deux n'avait de chemin direct avant, seulement "Ver"/
"Eliminar". Nettoyage au passage : titre "Etiquetas" dupliqué dans `ProductTagsBlock.tsx` (le
bloc et le composant portaient chacun leur propre libellé) retiré.

Contamination croisée trouvée en creusant un échec e2e à ce moment-là :
`admin-product-price-tiers.spec.ts` sélectionnait un établissement seedé partagé
(`b0000000-...-004`, "Establecimiento Propuestas E2E") **par son nom affiché** dans le `Select` —
cassé par `admin-establishment-edit.spec.ts` (spec 06, autre session), qui renomme ce même
établissement partagé en testant l'édition. L'id restait valide pour un insert direct par FK (ce
que font `admin-product-tags.spec.ts`/`admin-product-delete.spec.ts` sans souci), mais pas pour
une sélection par nom dans l'UI. Corrigé en créant un établissement dédié à ce test (jamais un
seedé partagé pour toute sélection par nom, cf. précédent déjà documenté pour les partenaires/
établissements dans les specs 01/03). `admin-product-edit.spec.ts` reste par ailleurs un flake déjà
connu et sans lien (navigation `/admin/establishments/[id]` lente à compiler à la demande sous
Turbopack, ~50 % d'échec reproduit indépendamment de tout changement de cette session, confirmé
par navigation directe qui aboutit toujours avec un délai suffisant) — non corrigé ici, hors
périmètre.

22 tests e2e rejoués verts après ces correctifs (dont 2 nouveaux : création de tag à la volée).
Build + typecheck + lint verts.*
