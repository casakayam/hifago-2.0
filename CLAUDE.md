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

## 12. Curseur — dernière session

En fin de feature/session : (1) *append* (jamais écraser) une entrée datée à
`hifago/docs/journal/<mois-en-cours>.md` — nouveau mois = nouveau fichier (`2026-09.md` le
1er septembre) ; (2) *remplacer* (pas ajouter) le paragraphe ci-dessous par le résumé de cette
nouvelle entrée.

*2026-08-16 — dernière entrée : spec `14-admin-transporte.md`, `type='transport'` activé dans
`ProductForm` (suite des specs 11/12/13, même jour). Vérification V1 (« regarde ce qui existe déjà
dans la doc et le code de l'ancien ») : transport n'y est pas une entité dédiée, juste une valeur de
`products.type` — chaque trajet/tarif est une fiche produit distincte rattachée à un `provider_id`
(Aeroturex, Gotravel), `capacity_default`/`schedule` toujours `NULL`/`'date'`, aucune donnée
d'horaires structurée en base, et **LobbyPMS n'est pas lié au transport** (déjà découplé, backlog
V1 item C2) — pas d'IP statique à prévoir ici. `products.type` autorise déjà `'transport'` depuis
la toute première migration catalogue, jamais retiré du CHECK — **aucune migration nécessaire**,
pure activation de gating : `isTransport` rejoint `hasLocationAndTags`/`hasPriceQtyFields` (même
groupe que l'activité), `hasCheckInOut` inchangé (transport n'y entre pas). Décision Jérôme avant
plan : admin seulement, pas de reconstruction de la « carte transport multi-transporteurs » groupée
de la V1 côté `apps/web` (portail déjà générique pour tout type hors evento, zéro changement
nécessaire là). Simplification volontaire par rapport à la V1 : les paliers de capacité de véhicule
(« hasta 4/7 pers. », deux fiches produit séparées en V1) deviennent deux tramos de `price_tiers`
d'un même produit — mécanisme déjà généralisé pour alojamiento/hôtel.

**Effet de bord trouvé en vérifiant la non-régression, sans rapport avec transport** :
`admin-product-hotel.spec.ts` échouait par intermittence. Deux causes réelles, corrigées : (1)
`RoomCard` (`hotel-rooms-editor.tsx`) mergeait ses champs via `{...room, champ}` sur un `room`
capturé dans la closure du rendu au lieu d'une forme fonctionnelle — même classe de bug déjà
corrigée pour `LocalizedTextField`/l'array-level en spec 11, généralisée ici à tous les champs de
`RoomCard` (pas seulement les 3 handlers photo réseau) ; (2) `toggleCheckbox` (`force:true`) sur la
case stay_rates de la chambre 0 pouvait courir contre le redimensionnement du bloc Fotos causé par
l'apparition de la vignette juste au-dessus — corrigé en réordonnant le test (stay_rates avant la
photo), pas en affaiblissant l'assertion. 5/5 exécutions vertes après (0/5 avant).

Vérifié : typecheck/lint propres, nouveau `admin-product-transport.spec.ts` vert dès la première
exécution (2 tramos de prix, assertions négatives prouvant l'absence de check-in/checkout, édition,
persistance), capture navigateur réelle (390×844/1280×900) sans débordement, 77 tests Vitest verts,
suite e2e produit complète (create/lodging/hotel/price-tiers/transport/products-list) verte en
séquence. **Signalé sans corriger** (hors sujet de cette tâche) : `'hotel'` manquant dans
`PRODUCT_TYPES` de `apps/admin/lib/lists/filters.ts`. Toujours en attente (inchangé depuis
l'entrée précédente) :
garde-fou `price_cop is null` dans `create_order` (evento+hotel, chokepoint anti-survente) ;
Tranche 2 des specs 11/12/13 ; connecteur LobbyPMS lui-même ; correctif `waitForLoadState` sur
`admin-camp-booking.spec.ts` ; lot 2 `LocalizedTextField` sur l'établissement ; correction
`admin-evento-vitrine.spec.ts` ; sidebar admin non repliée sous `md` ; carte transport
multi-transporteurs groupée côté `apps/web` (hors périmètre explicite, spec à part si un jour
voulue).
Détail complet et historique intégral dans `hifago/docs/journal/2026-08.md` — jamais élagué,
**jamais chargé automatiquement** en session. À ouvrir seulement pour comprendre pourquoi une
décision passée a été prise, ou retrouver un piège déjà rencontré ailleurs qu'en §11 ci-dessus.*

<!-- ANCIEN JOURNAL COMPLET (2026-08-13 → 2026-08-15) DÉPLACÉ VERBATIM VERS
     hifago/docs/journal/2026-08.md LE 2026-08-15 — ne pas recoller ici, ne pas dupliquer. -->

