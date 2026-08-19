---
id: refonte-architecture-cible
titre: "Choix de stack et architecture cible"
theme: cadrage
statut: "✅ validé par Jérôme le 2026-08-12 — complété le 2026-08-13"
maj: 2026-08-13
resume: >
  Choix de la stack technique et de l'architecture cible pour la refonte, dérivé des besoins
  réels révélés par les 3 cahiers des charges et l'audit de données — pas une confirmation de
  l'intuition de départ (Next.js + Supabase + Vercel), mais une comparaison challengée point par
  point contre des alternatives réelles, puis soumise à une revue adversariale avant validation.
mots_cles: [architecture, stack, next.js, supabase, vercel, heroui, monorepo, decisions tranchees]
repond_a:
  - "Quelle stack technique et quelle architecture pour hifago, et pourquoi ?"
  - "Quelles décisions sont déjà tranchées et ne doivent pas être rouvertes ?"
---

# Choix de stack et architecture cible — refonte Casa Kayam / Hifago

## Contexte

Le cahier des charges fonctionnel de la refonte (`00-modele-de-donnees.md` +
`01-cahier-des-charges-client.md` + `02-cahier-des-charges-socio.md` +
`03-cahier-des-charges-admin.md`, validés puis complétés par les décisions métier du 2026-08-13)
est terminé pour ce cadrage. Prochaine étape du chantier (`hifago/README.md` § État du chantier, point 2) :
choisir la stack technique et l'architecture cible, à la lumière de ce que ces documents ont
révélé comme besoins réels — pas au doigt mouillé, et pas comme une simple confirmation de
l'intuition de départ (Next.js + Supabase + Vercel).

L'app actuelle (Node/Express + SQLite + fronts vanilla JS, Fly.io) reste seule en production
sans interruption pendant tout ce chantier. Ce document ne touche à aucun code existant — il
fixe la cible technique. Le plan de bascule (migration de données, cutover) est une étape
ultérieure explicitement séparée (`hifago/README.md` § État du chantier, point 3), hors
périmètre ici.

**Décisions actées avec Jérôme pendant ce cadrage** :
- La cible n'utilise **pas Fly.io**, ni maintenant ni comme complément (rejet général, pas
  seulement pour la couche jobs). L'app actuelle continue d'y tourner pendant la transition, mais
  la nouvelle stack ne doit reposer sur aucune infra Fly, web ou jobs.
- Au-delà de la simple confirmation de Next.js/Supabase/Vercel, des alternatives réelles ont été
  comparées (Neon comme Postgres serverless pur, Cloudflare comme hébergeur alternatif de
  Next.js, Convex comme backend réactif, Clerk/WorkOS comme fournisseurs d'identité B2B
  spécialisés) avant de confirmer ou d'ajuster chaque brique — détail dans chaque section
  ci-dessous. Décision finale : **Supabase utilisé pleinement** (Postgres+PostGIS, Auth, Storage,
  Realtime, Edge Functions/pg_cron), pas seulement comme base Postgres managée.

## Méthode suivie

Les 3 cahiers des charges + l'audit de données ont été relus intégralement pour en extraire les
contraintes d'architecture réelles (identité composable, recherche géo, multilingue extensible,
tarification par date, **ressource de disponibilité partagée et blocages multi-jours**, connecteur PMS généralisé sans webhook, jobs planifiés critiques,
campagnes reprenables, 2FA admin, etc.), avec lecture du code actuel
(`docs/2-reference/01-architecture.md`, `docs/5-conception/roles-composables.md`,
`src/services/orderService.js`) pour vérifier ce qui fonctionne déjà et pourquoi (invariant
anti-survente gratuit sous SQLite mono-écrivain, 3 fronts servis par un seul process, etc.).
Chaque brique a ensuite été challengée contre des alternatives réelles plutôt que confirmée par
confort, et l'ensemble du document a été soumis à une **revue adversariale** (cohérence interne,
coûts/fournisseurs, risques techniques, complétude) avant validation — deux corrections
bloquantes en ont résulté (frontière RLS mal définie, affirmation de sécurité inexacte) ainsi que
deux trous comblés (fournisseur email absent, stratégie de backup absente).

**Verdict global : adaptation ciblée de l'intuition de départ, pas une confirmation telle
quelle.** Next.js + Vercel pour le web est un bon choix. Sur la base de données, une alternative
sérieuse (Neon, Postgres serverless pur — pilote HTTP natif pour le serverless, branching de
base de données, sans le bundle Auth/RLS/Realtime) a été comparée à Supabase et écartée : plutôt
que d'utiliser Supabase a minima (juste Postgres + Storage) ou de le remplacer par un
assemblage best-of-breed (Neon + Cloudflare R2), le choix retenu avec Jérôme est d'exploiter
Supabase **pleinement** — Auth, Storage, Realtime et Edge Functions/pg_cron en plus de
Postgres+PostGIS — pour rester sur un seul fournisseur backend et réutiliser un maximum de
briques déjà construites plutôt que de les refaire à la main. Un seul garde-fou est conservé par
rapport à un usage naïf « tout en RLS » : pour le modèle de rôles composables (le point identifié
comme le plus risqué pour RLS pur), la logique métier complexe et sensible reste arbitrée côté
application, RLS venant en **couche de défense supplémentaire**, pas en unique mécanisme — détail
ci-dessous.

---

## Architecture cible recommandée

### Web — monorepo à deux apps Next.js sur Vercel

**Révisé le 2026-08-14** (cf. bloc "Révision" en fin de section) : deux projets Next.js (App
Router) dans un monorepo npm workspaces — `apps/web` (vitrine client, publique) et `apps/admin`
(socio+admin ensemble, authentifié) — plutôt que le projet unique initialement retenu le
2026-08-12. Packages partagés (`packages/ui`, `packages/supabase`, `packages/domain`) pour éviter
la duplication de logique entre les deux apps.

Le raisonnement original ci-dessous (route groups dans une seule app) est conservé tel quel comme
historique de décision — voir le bloc "Révision du 2026-08-14" plus bas pour ce qui a changé et
pourquoi.

#### Historique — décision initiale du 2026-08-12 (révisée le 2026-08-14)

Un seul projet Next.js (App Router), pas deux apps séparées pour client vs socio+admin.

- **Route groups** : `(public)` pour le portail client (marketplace, SEO fort — pages de
  catégorie/listing indexables, recherche géo, ISR/SSG), `(app)` pour socio+admin
  (authentifié, rendu dynamique, formulaires, tableaux, CRM, campagnes).
- **Justification** : le système actuel sert déjà 3 fronts depuis un seul process Express avec
  succès à cette échelle d'équipe (`docs/2-reference/01-architecture.md` § Une app, trois
  fronts). Next.js résout nativement la tension SEO/applicatif *par route* (Server Components,
  rendu par segment) sans dupliquer auth, design system et couche de données entre deux dépôts.
  Deux apps séparées ne se justifieraient que par un scaling indépendant à fort trafic ou des
  équipes/cadences de déploiement distinctes — aucun des deux n'est le cas ici.
- **SEO à l'échelle "marketplace mondial"** (`hifago/README.md` § cadrage) : ISR à la demande
  (`revalidateTag`/`revalidatePath` déclenché à la publication admin), pas de génération statique
  exhaustive de toutes les combinaisons locale × ville × catégorie au build (explosion
  combinatoire dès que le catalogue passe à l'échelle visée).
- **Alternatives comparées, écartées** :
  - *Framework* — SvelteKit (bundle plus léger, ~85 Ko gzip vs ~240 Ko) et React Router v7/Remix
    (moins de convention imposée que l'App Router) ont un mérite réel, mais Next.js reste le
    choix le plus sûr ici : le plus gros écosystème pour exactement les intégrations nécessaires
    (Google Maps/Identity, futurs SDK de paiement MercadoPago/Stripe), et le vivier de
    développeurs le plus large si Jérôme fait appel à des contracteurs plus tard — le projet n'a
    aucun héritage React/Vue/Svelte (fronts vanilla JS actuels), donc aucun biais d'équipe ne
    penche pour une alternative.
  - *Hébergement* — Cloudflare (Workers/Pages) est plus économique à fort trafic et plus rapide
    sur du contenu public très caché, mais son support de l'App Router/React Server Components a
    encore des angles morts en 2026 sur des patterns avancés (ISR ciblée, RSC) que ce projet va
    précisément utiliser pour le SEO. Vercel reste la cible la plus sûre pour la complétude
    fonctionnelle Next.js ; à réévaluer seulement si le coût à l'échelle devient un vrai sujet.
- **Pourquoi pas deux applications séparées (client vs socio+admin), même avec des technos front
  différentes** — question challengée explicitement, pas juste écartée par confort :
  - Le vrai argument contre n'est pas "le design sera différent" (ça, Next.js le résout
    nativement par route — le bundle de `/guatape` ne contient aucune ligne du JS de `/admin`,
    exactement comme l'Express actuel sert 3 pages distinctes) : c'est que **l'identité unifiée
    rend le partage d'auth et de données non négociable**. Un compte qui est client, référent et
    admin à la fois devrait, avec deux apps, traverser deux domaines/sessions différents en
    changeant de casquette — UX dégradée, bugs de session quasi garantis.
  - Séparer forcerait soit un service d'auth centralisé (latence, point de panne, disproportionné
    pour une équipe d'une personne), soit deux implémentations du même contrat de session
    (capacités composables, statut par établissement) — divergence quasi garantie. Le projet a
    déjà vécu et corrigé ce type de risque : `public/portal-photos.js` et `public/history-nav.js`
    sont chargés par les 3 fronts actuels précisément parce qu'une règle dupliquée dérive
    silencieusement sans ce garde-fou. Deux apps supprimeraient ce mécanisme.
  - Un outil dashboard spécialisé (Retool, Refine, Appsmith) pourrait sembler justifier une techno
    différente pour socio+admin vu la densité CRM/tableaux — traité en détail dans la section CRM
    ci-dessous : écarté, parce que la vraie complexité du back-office est dans la logique métier
    (moteur de commission, machine à états PMS), pas dans l'UI.

#### Révision du 2026-08-14

**Fait nouveau** : Jérôme rouvre explicitement la question le 2026-08-14 — l'admin (+ socio) doit
vivre sur un site externe, pas sur l'URL de la vitrine, dans un monorepo mais pas une seule app.
Décision retranchée dans la foulée, avec 4 clarifications actées :
1. **Périmètre** : `apps/admin` regroupe admin **et** socio (calque de l'ancien route group
   `(app)`) ; `apps/web` = vitrine seule (calque de l'ancien `(public)/[locale]`).
2. **Session** : connexions indépendantes entre les deux sites, pas de cookie partagé.
3. **Outillage** : npm workspaces (déjà en place, pas de migration pnpm — coût réel sans gain
   proportionné à cette échelle) + packages partagés, pas de Turborepo pour l'instant (2 apps +
   quelques packages, équipe de 1 — réévaluer si >5-6 packages ou CI >10-15 min).
4. **Domaine** : sous-domaine du même domaine racine (`hifago.co`), pas un domaine distinct.

**Pourquoi l'argument n°1 ci-dessus (identité unifiée/session partagée) ne s'applique plus** : il
reposait sur le postulat qu'une session partagée était non négociable pour l'UX d'un compte
multi-rôles. Ce postulat est explicitement levé par la clarification 2 — un compte qui est à la
fois client, référent et admin se reconnecte en changeant de site, tradeoff assumé par Jérôme.

**Comment l'argument n°2 (duplication de logique, `portal-photos.js`/`history-nav.js`) est
traité** : par les packages partagés (`packages/ui`, `packages/supabase`, `packages/domain`), avec
un principe explicite pour éviter la dérive inverse (packagiser par anticipation) : **un module ne
migre vers `packages/` que s'il est prouvé consommé par les deux apps aujourd'hui** — vérifié par
grep au moment de la restructuration, pas supposé. `packages/supabase` couvre le client Supabase
(browser + server) et les types générés — le point le plus sensible à une divergence silencieuse.

Détail technique complet (structure, outillage, packages, auth, proxy/middleware, e2e, CI,
ordre d'exécution, risques) dans le plan de restructuration exécuté ce jour-là — non reproduit ici
pour ne pas dupliquer une source de vérité ; ce document reste la trace de la *décision*, `CLAUDE.md`
§2 point 1 la règle courante à respecter au quotidien.

### Design system et bibliothèques UI — HeroUI v3 comme socle unique, briques headless ciblées autour

Quatre besoins UI distincts ont été comparés (composants/design system, graphiques, calendrier,
tables denses) — avec un principe directeur qui ressort de la recherche et tranche les
arbitrages : **un seul système visuel cohérent pour toute l'app**, quitte à sacrifier un peu de
"batteries incluses" sur un besoin précis, plutôt que d'empiler deux frameworks CSS différents qui
finissent par se tirer l'un l'autre (le risque identifié explicitement pour Chakra/Mantine/Ant
Design face à un Tailwind déjà en place).

#### Historique — décision initiale du 2026-08-12 (révisée le 2026-08-14)

- **Composants/design system : shadcn/ui** (Radix comme primitives comportementales + Tailwind,
  déjà la techno CSS du projet actuel) — pas Chakra UI, Mantine, ni Ant Design. Raisons : le code
  est copié dans le repo (pas un paquet npm à mettre à jour, zéro risque de migration majeure type
  Chakra v2→v3), aucun thème par défaut à combattre pour poser l'identité visuelle Hifago,
  aucun runtime supplémentaire (poids minimal, important pour le portail client SEO-critique), et
  surtout : pas de design system fermé imposant un seul look — le portail public (orienté
  conversion) et le back-office (dense) peuvent utiliser des tokens/variantes différents sur les
  mêmes primitives, sans que l'un tire l'autre vers le bas.

#### Révision du 2026-08-14 — HeroUI v3 remplace shadcn/ui

**Fait nouveau** (pas juste un changement d'avis) : HeroUI n'avait pas été évalué dans la
comparaison initiale ci-dessus (seuls Chakra UI/Mantine/Ant Design l'avaient été) — candidat non
couvert par la recherche du 2026-08-12. Compatibilité vérifiée sans changement de version : HeroUI
v3 requiert React 19+ et Tailwind CSS v4, exactement la stack déjà en place. Le principe directeur
("un seul système visuel cohérent", tokens différents par registre plutôt que deux bibliothèques)
reste inchangé — seul le fournisseur du socle change. Mécanisme concret : deux thèmes nommés
(`data-theme="vitrine"` / `data-theme="admin"`) sur les mêmes composants HeroUI, posés sur
`<html>` par chaque app — c'est le cas d'usage central du système de theming HeroUI v3 (variables
CSS + sélecteur `[data-theme]`), pas un détournement. Composants importés uniquement via
`packages/ui`, jamais `@heroui/react` directement dans une app.

**Ce qui ne change pas** : Recharts (graphiques), react-day-picker (calendrier client, réexporté
par `packages/ui`), FullCalendar (calendrier admin/socio), TanStack Table (tables denses) — ces
choix étaient déjà indépendants du socle shadcn/HeroUI, aucune raison de les rouvrir. Point non
tranché, à évaluer séparément : HeroUI v3 fournit son propre `DatePicker`/`Calendar` (encore "in
progress" à ce jour) qui pourrait à terme rendre react-day-picker redondant côté client — pas
décidé, mérite un essai visuel avant d'y toucher.

- **Graphiques (suivi analytique, admin §2)** : **Recharts** — pas Tremor en socle (bon produit,
  mais un second système de composants superposé à HeroUI, risque de doublon de primitives ; à
  réserver en emprunt ponctuel si la vélocité prime sur une page précise), pas visx (trop bas
  niveau, coûte du temps de design qu'une petite équipe n'a pas), pas Nivo (bundle plus lourd,
  moins aligné Tailwind), pas Chart.js (rendu Canvas pertinent pour des millions de points, pas
  pour des séries agrégées jour/semaine/mois).
- **Calendrier — deux bibliothèques différentes, pas une seule**, les usages sont trop différents :
  - **Client** (sélecteur de dates de réservation avec prix/disponibilité affichés jour par jour,
    client §2) : **react-day-picker**, réexporté par `packages/ui` (`DayPickerCalendar`) — léger,
    SSR/SEO friendly, personnalisable cellule par cellule (`modifiers`/`components`) pour injecter
    prix et statut directement dans chaque case.
  - **Admin/socio** (ouvrir/fermer des dates ou créneaux, ajuster des cupos, édition en masse par
    plage — socio §3d, admin §3c) : **FullCalendar** (`@fullcalendar/react`), cœur MIT gratuit —
    vue `dayGridMonth` + `selectable` pour le pattern "sélectionner une plage → appliquer un
    changement", `dayCellContent` pour afficher le statut ouvert/fermé/plein. La partie payante
    (vue Resource-Timeline multi-produits, ~480 $/dev/an) n'est pas nécessaire au premier
    périmètre — à garder en tête si une vue multi-chambres façon PMS est demandée plus tard.
- **Tables denses (catalogue, ledger, registre partenaires, file de modération, réconciliation
  PMS)** : **TanStack Table** (headless) partout, habillé avec une primitive table locale à
  `packages/ui` (`SimpleTable`) — pas le `Table` compound HeroUI, qui gère son propre état interne
  (tri/sélection) et n'est pas fait pour être piloté par un moteur headless externe. Le `Table`
  HeroUI reste utilisé tel quel pour les tables d'affichage simple, sans TanStack Table impliqué —
  **pas MUI X Data Grid** dans tous les cas, malgré une intégration officielle plus clé-en-main
  avec Refine.dev
  (`@refinedev/mui`). Arbitrage tranché explicitement : MUI apporte son propre système Material
  (CSS-in-JS runtime, look par défaut différent) — l'introduire, même pour quelques écrans,
  recrée exactement le problème de double registre visuel que le choix de HeroUI vise à éviter.
  TanStack Table dispose lui aussi d'un adaptateur officiel Refine (`@refinedev/react-table`,
  pattern `manualPagination` pour le tri/filtre/pagination côté serveur) — l'écran de modération
  (diff valeur actuelle/proposée) et la file de réconciliation PMS, qui demandent de toute façon
  des cell renderers sur mesure, en bénéficient directement. AG Grid écarté : le volume visé
  (dizaines/centaines de partenaires) ne justifie pas son coût d'intégration ni sa licence
  Enterprise pour les fonctions réellement utiles (regroupement, export avancé).
- **Coût d'intégration honnête, ajouté après challenge du plan** : FullCalendar ne consomme pas
  Tailwind — il rend son propre DOM avec ses propres classes/variables CSS (toolbar, grille), pas
  retouché par HeroUI. Un alignement visuel correct (surcharge des variables de palette,
  remplacement du toolbar natif par un composant HeroUI piloté par référence à l'API FullCalendar,
  `dayCellContent`/`eventContent` en markup Tailwind) est un vrai chantier initial (à chiffrer,
  pas à considérer comme gratuit), plus une double surface de theming (react-day-picker et
  FullCalendar) à resynchroniser à chaque évolution du design system. Ça ne change pas le choix
  (les deux bibliothèques restent les bonnes pour leurs usages respectifs), mais ce coût doit
  apparaître explicitement dans le chiffrage plutôt que d'être implicite.
  De même, Refine.dev perd une partie de son intérêt "clé en main" puisque son intégration
  officielle la plus poussée (`@refinedev/mui`) est explicitement écartée au profit de
  HeroUI/TanStack Table (non officiellement packagés ensemble par Refine) — le gain de vitesse
  reste réel mais plus modeste qu'un couplage officiel, à chiffrer sur cette base plutôt que sur
  la promesse générique de la bibliothèque.

#### Révision du 2026-08-18 — SVAR React Calendar pour l'agenda de réservations socio (calendrier de cupos FullCalendar inchangé)

**Fait nouveau** (pas juste un changement d'avis) : besoin jamais couvert par le choix FullCalendar
ci-dessus — un agenda affichant chaque **réservation individuelle** (jour/semaine/mois, façon
Google Calendar, plusieurs événements simultanés côte à côte, titre `activité - client - N pers.`)
plutôt qu'un agrégat de capacité par jour sur un seul produit. FullCalendar tel qu'intégré ici
(`dayGrid` + `interaction` seulement, cf. `docs/specs/17-...md` §3bis) n'a jamais eu vocation à
porter une vue événement-par-réservation multi-produits — étendre son périmètre aurait exigé les
plugins `timeGrid`/`list` non installés et une refonte du modèle d'événement, pas une simple
extension.

**Décision en 3 temps**, cf. `docs/specs/20-agenda-reservations-socio.md` §10 point 1 pour le détail :

1. Jérôme choisit initialement **MUI X Scheduler** (`@mui/x-scheduler`), malgré deux points de
   friction signalés avec les décisions ci-dessus (second design system Material/Emotion en
   parallèle de HeroUI ; statut beta + responsive marqué "expérimental" par l'éditeur lui-même,
   vérifié sur mui.com/x/react-scheduler) — maintenu en connaissance de cause.
2. **En construisant l'écran**, inspection directe des `.d.ts` du package installé (pas la doc
   marketing — le code livré) révèle un blocage réel, pas seulement un risque : `EventCalendar`
   n'expose **aucun** callback de clic public (`onEventClick`/`onDateClick`/`onSlotClick` absents),
   aucune prop de personnalisation du popup d'événement (`slots`/render), et l'API impérative
   (`apiRef`) se limite à `setVisibleDate`. Sans callback de clic, ni "cliquer une réservation → sa
   fiche" ni "cliquer une case vide → l'ajouter" (les deux interactions centrales de la spec 20) ne
   sont réalisables sans hack DOM sur des classes internes non garanties d'une version beta à
   l'autre.
3. Jérôme propose **SVAR React Calendar** (`@svar-ui/react-calendar`) en alternative — vérifié en
   direct (npm + `.d.ts` réels, pas seulement la doc) : version stable **`2.6.2`** (aucun tag beta),
   licence **MIT**, zéro dépendance à un design system de composants (juste le rendu du calendrier
   — CSS propre, même statut que FullCalendar déjà accepté dans ce projet, pas de boutons/inputs
   SVAR qui concurrenceraient HeroUI), et une vraie API d'événements : le bus d'actions interne
   (`select-event`, `add-event`, `move-event`, `update-event`, `delete-event`) est exposé comme
   props React directes (`onSelectEvent`, `onAddEvent`, …) et bloquable via `api.intercept(...)`.
   **Retenu** — résout le blocage du point 2 sans les deux frictions du point 1.

**Ce qui ne change pas** : FullCalendar reste la bibliothèque du calendrier de cupos/disponibilité
existant (`apps/admin/components/availability-calendar.tsx`, admin + socio, spec 17) — non touché,
outil différent (gestion de capacité agrégée, pas agenda de réservations individuelles). Les deux
bibliothèques calendrier coexistent désormais dans `apps/admin`, chacune strictement scopée à son
propre usage, comme le sont déjà react-day-picker (client) et FullCalendar (admin/socio) depuis la
révision du 2026-08-14 — même principe, un troisième registre visuel borné à un seul écran plutôt
que généralisé. Aucune dépendance MUI/Emotion ne reste dans le projet (installées puis retirées le
même jour, avant tout usage réel en dehors de l'exploration de l'API).

### Internationalisation (i18n) et SEO multilingue — next-intl, routage par sous-chemin, indexation conditionnée à la vraie traduction

Deux couches multilingues bien distinctes coexistent dans ce projet — une confusion entre les deux
est le principal risque à éviter, y compris dans l'implémentation SEO :
1. **Libellés d'interface** (boutons, titres, menus) — un jeu de langues **restreint et codé**
   (ES/EN au lancement), comme aujourd'hui (~230 clés `I18N`). Ajouter une langue d'interface
   reste un geste de déploiement (traduire les clés), mais peu fréquent.
2. **Contenu saisi par les partenaires/admin** (déjà décidé plus haut) — colonnes JSONB par champ,
   liste de langues **illimitée et sans déploiement**, avec repli obligatoire si une traduction
   manque.

**Bibliothèque retenue pour la couche (1) : next-intl** — pas Paraglide.js, pas
react-i18next/next-i18next, pas Lingui. Raisons :
- C'est la seule bibliothèque conçue nativement pour l'App Router : `getTranslations()` fonctionne
  directement dans les Server Components et dans `generateMetadata`/`generateStaticParams`, sans
  provider ni hydratation pour des libellés rendus côté serveur — exactement le cas d'un portail
  SEO. Les autres sont soit un rattrapage d'une conception Pages Router (next-i18next,
  react-i18next — câblage manuel du provider/chargement des namespaces à la charge de l'équipe),
  soit un compilateur (Paraglide, Lingui) dont l'avantage (tree-shaking par message) ne s'applique
  qu'aux libellés dans des Client Components interactifs — sur ~230 clés majoritairement rendues
  serveur, l'écart est négligeable face à la friction ajoutée (routeur de locale propre à Paraglide,
  macros Babel obsolètes sous SWC pour Lingui).
- **SEO intégré nativement** : la config de routing par locale de next-intl alimente directement
  `alternates.canonical`/`alternates.languages` de l'API Metadata Next.js — hreflang et canonical
  générés sans code manuel, contrairement aux autres options qui n'offrent rien d'équivalent clé
  en main.
- Typage TypeScript des clés (détection des clés manquantes à la compilation), ajout d'une langue
  d'interface plus tard = un fichier JSON + une entrée dans la config de routing, rien de plus.

**Mécanique SEO concrète** (le point que Jérôme a explicitement demandé de creuser) :
- **Structure d'URL — sous-chemin par langue** (`/es/...`, `/en/...`, via `middleware.ts` +
  segment `app/[locale]/...`), jamais un paramètre de requête (`?lang=`, mal canonicalisé) ni une
  détection Accept-Language silencieuse sur une même URL (Google déconseille explicitement de
  varier le contenu servi à une URL identique selon l'en-tête — perçu comme du cloaking). Pas de
  ccTLD/sous-domaine par pays : la cible est un marketplace global, pas une déclinaison par pays.
- **hreflang construit sur les locales d'interface routées (ES/EN), jamais sur la liste dynamique
  des langues de contenu** — c'est la règle qui évite de confondre les deux couches ci-dessus.
  Une fiche dont le contenu n'a **pas** de vraie traduction dans la locale demandée (repli JSONB
  vers l'espagnol servi sous une URL `/en/...`) ne doit **jamais** être indexée comme une page
  anglaise distincte — c'est exactement le schéma que Google qualifie de contenu dupliqué perçu.
  Traitement : tant qu'aucune traduction réelle n'existe pour cette locale, la page reste
  `robots: { index: false, follow: true }`, avec un canonical pointant vers l'URL de la langue
  source, et **absente** du cluster hreflang. Dès qu'un partenaire ajoute la traduction (sans
  déploiement, l'ISR à la demande déjà décidée s'en charge), la page bascule automatiquement en
  indexable + canonical auto-référent + entrée hreflang ajoutée. Règle de réciprocité stricte :
  chaque langue indexée référence toutes les autres (y compris elle-même), un seul `x-default`.
- **Sitemap** : un seul `sitemap.xml` dynamique (pas un sitemap par langue), chaque entrée portant
  ses `alternates.languages` (Next.js les sérialise en `xhtml:link rel="alternate"`) — centraliser
  le cluster hreflang évite la désynchronisation entre sitemaps séparés, source majeure d'erreurs
  hreflang constatées sur le terrain. `generateSitemaps()` pour sharder par tranche de 50 000 URLs
  si le catalogue grossit ; régénération liée aux mêmes hooks que la publication/traduction d'une
  fiche (cohérent avec l'ISR à la demande déjà décidée) ; ne jamais lister une variante en repli
  non traduite.
- **Pièges 2026 à éviter explicitement** : router une locale d'interface avant qu'une vraie
  traduction de contenu existe pour la fiche concernée (duplicate perçu) ; publier une route
  `/pt/` indexable dès qu'un contenu portugais existe côté data alors que l'interface `pt` n'est
  pas encore livrée (ce contenu ne doit servir que de source de repli, jamais de route publique) ;
  casser la réciprocité hreflang si le cache de sitemap n'est pas invalidé en même temps que le
  contenu ; rediriger par géolocalisation sans laisser un sélecteur de langue accessible à
  Googlebot.
- **Cas à trancher explicitement, repéré en challengeant le plan : une fiche saisie UNIQUEMENT
  dans une langue de contenu sans locale d'interface routée** (ex. contenu en français, alors que
  seules ES/EN sont routées). La règle "canonical vers la langue source" présuppose que cette
  source soit elle-même une locale routée — ce qui n'est pas garanti puisque les langues de
  contenu sont illimitées alors que les locales d'interface sont un jeu fermé. **Règle retenue** :
  le canonical d'une fiche pointe toujours vers sa version dans la locale d'interface par défaut
  du système (`x-default`, l'espagnol — cohérent avec le repli déjà décidé côté modèle de
  données, où l'espagnol est la langue de saisie la plus probable), jamais vers une langue de
  contenu non routée. Le contenu en français reste consultable (servi en repli sous `/es/...` ou
  `/en/...` selon la langue demandée par le visiteur), mais n'a jamais sa propre URL canonique
  tant qu'aucune locale d'interface `fr` n'est routée.

### Base de données — Supabase (Postgres + PostGIS), pas Neon ni Convex

**Alternatives sérieusement comparées, écartées** :
- **Convex** (backend réactif TypeScript, modèle document) : rejeté — l'audit de données du
  projet (`00-modele-de-donnees.md`) a déjà investi un modèle relationnel précis (14 migrations
  SQL existantes, schéma dormant à réutiliser : `cancel_free_days`, `payout_method`,
  `ledger_entries`...). Repartir sur un modèle document jetterait ce travail de conception déjà
  fait, sans équivalent aussi mature que PostGIS pour la recherche géo par rayon.
- **Neon** (Postgres serverless pur — pilote HTTP natif serverless, branching de base de
  données) : techniquement bien adapté sur le papier, en particulier pour la connexion depuis des
  fonctions serverless Vercel (pas de pooler à configurer) et pour tester une migration sur une
  vraie copie de données. Écarté au profit de Supabase **pas pour un défaut technique**, mais
  parce que la décision finale (ci-dessous) est d'exploiter tout le bundle Supabase — Auth,
  Storage, Realtime, Edge Functions — plutôt que de le limiter à une base Postgres, ce que Neon
  ne fournit pas.

**Confirmé : Supabase, utilisé pleinement** (Postgres+PostGIS, Auth, Storage, Realtime, Edge
Functions/pg_cron) — un seul fournisseur pour tout le backend, cohérent avec la même logique qui
a fait écarter Fly (minimiser le nombre de plateformes à opérer pour une petite équipe), et
réutilise un maximum de briques déjà construites (auth email/Google/MFA, files, temps réel,
jobs planifiés) plutôt que de les refaire à la main.

- **Recherche géographique par rayon** (client §2, 20 km) : PostGIS (`ST_DWithin`) — fit direct,
  disponible nativement sur Supabase, pas de service tiers à ajouter.
- **Géocodage** : réutilise l'infra Google Maps Geocoder déjà en place côté admin
  (`00-modele-de-donnees.md` § Google Maps), stocke lat/lon en colonnes Postgres natives
  (`geography(Point)`).
- **Tarification par date sans PMS** (le gap critique de l'audit — établissement à chambres
  multiples sans PMS) : une vraie table de grille tarifaire par date/plage de dates, par chambre
  ou par logement entier — modélisation relationnelle standard, rien d'exotique requis côté
  moteur.
- **Calendrier partagé / anti-double-booking inter-produits (décision 2026-08-13)** : séparer le
  calendrier propre d'un produit de la **ressource de disponibilité du prestataire** qu'il
  consomme. Tables conceptuelles : `availability_resources`, liaison produit↔ressource et
  `availability_blocks` portant une plage, la cause et la ligne de commande source. Un camp de N
  jours teste toute la plage ; sa réservation crée un blocage unique dont l'indisponibilité des
  autres activités est **dérivée**, plutôt que recopier une fermeture dans chaque calendrier.
- **Contenu multilingue extensible sans redéploiement** (audit § système multilingue transverse) :
  **colonnes JSONB par champ traduisible** (`name jsonb`, `description jsonb`, etc.), pas une
  table de traductions générique `(entity_type, entity_id, field, lang, value)`. Raisons —
  **attendues, à confirmer par le spike géo+JSONB de la section Validation avant de les traiter
  comme acquises** :
  - fetch d'une page catégorie/listing en une seule requête sans jointure par langue — critique
    pour du SEO/ISR performant ;
  - ajout d'une langue (ex. PT pour le Brésil) = ajout d'une clé JSON, zéro migration de schéma ;
  - repli propre et trivial en app : `row.name[lang] ?? row.name[fallback]` ;
  - indexable via index d'expression Postgres si besoin de tri/filtre par langue par défaut.
  Le seul usage que la table générique sert mieux (rapport transverse "tout ce qui manque en
  PT") se couvre par une petite vue/fonction Postgres scannant les colonnes JSONB, hors chemin
  chaud — pas une raison suffisante d'alourdir chaque fetch de page publique.
  **Articulation avec le SEO** (cf. section Internationalisation ci-dessus) : ce repli ne doit
  jamais être confondu avec une vraie traduction du point de vue de l'indexation — une fiche
  servie en repli sous une locale routée reste volontairement hors index tant qu'aucune traduction
  réelle n'existe pour elle.

### Autorisation — Supabase Auth pleinement utilisé, RLS en défense en profondeur (pas en unique mécanisme)

Le modèle d'identité cible (rôles composables client/référent/prestataire/admin sur un même
compte, statut par capacité et par établissement, vue miroir admin en lecture seule, verrou
optimiste multi-admin, audit nominatif — cahiers des charges client §1/§4, socio §1/§3a, admin
§1/§3d/§5) est de la **logique métier conditionnelle**, pas de l'ownership de ligne simple
(`user_id = auth.uid()`) sur lequel RLS excelle nativement — c'est le seul point de prudence
gardé face à un usage "tout RLS", pas une raison de renoncer à Supabase Auth/RLS en général.

- **Supabase Auth, utilisé à fond** : email/mot de passe, Google OAuth, MFA/TOTP pour le 2FA
  admin obligatoire (admin §1) — évite de reconstruire hashing/OAuth/TOTP à la main. Remplace
  directement `src/middleware/auth.js`/`adminAuth.js` et le JWT maison actuels.
- **RLS, activée partout, avec une frontière explicite et vérifiable — pas un jugement au cas par
  cas.** Une revue adversariale du plan a montré que le critère initial ("cas simple" vs "cas
  complexe") était trop flou pour être fiable : à la lettre, "un prestataire ferme une date sur
  son propre calendrier" ressemble à un cas simple ("il édite sa propre fiche"), alors que c'est
  précisément une opération que l'invariant anti-survente (ci-dessous) exige de faire passer par
  la RPC unique. La frontière est donc reformulée en critère explicite et non ambigu, pas laissée
  à l'appréciation :
  - **RPC-only, accès direct impossible (grants revoke sur la table)** : toute table portant un
    compteur de capacité/disponibilité (calendrier, cupos, stock), toute écriture qui doit être
    auditée nominativement, toute lecture qui expose des données d'une autre identité (vue
    miroir), tout verrou optimiste multi-admin. Ces tables n'ont **aucune policy RLS
    d'écriture** — seule la fonction RPC `SECURITY DEFINER` peut y écrire, appelée depuis une
    Route Handler/Server Action.
  - **RLS directe autorisée** : tout le reste — lecture/écriture d'une identité sur ses propres
    données non capacitaires (profil, contenu de fiche hors calendrier, coordonnées de paiement
    masquées).
  - **Ce qui était inexact dans la version précédente** : dire que "RLS reste en filet de
    sécurité" sur les chemins RPC-only est trompeur — une Route Handler en clé `service_role`
    **contourne RLS entièrement par construction** Postgres/Supabase, quelles que soient les
    policies actives. Il n'y a donc pas de filet RLS sur ces tables ; le filet réel, c'est
    l'absence de toute policy d'écriture directe (donc rien à contourner par erreur depuis le
    client) + la couverture de tests d'intégration (cf. section Tests) + la revue de code. À
    documenter tel quel, pas comme une double protection qui n'existe pas.
  - Les fonctions centralisées (`has_capability(uid, role, establishment_id)`, `is_admin(uid)`)
    utilisées dans les policies RLS directes doivent être marquées **`STABLE`** (sinon Postgres
    les ré-exécute ligne par ligne au lieu de les mettre en cache dans le plan de requête) et,
    si elles lisent une table elle-même sous RLS (la table de capacités), en **`SECURITY DEFINER`
    avec `SET search_path = ''`** pour éviter une double évaluation de policy en cascade (voire
    une récursion) et un détournement de search_path — piège documenté par Supabase elle-même sur
    exactement ce pattern. Les policies elles-mêmes enveloppent `auth.uid()` en
    `(select auth.uid())` pour forcer la mise en cache par requête plutôt que par ligne. Ces deux
    points sont ajoutés à la checklist du spike RPC (cf. section Validation).
  - La vue miroir admin s'appuie sur une fonction `SECURITY DEFINER` dédiée (contourne RLS
    explicitement, jamais en confondant l'identité admin avec celle du partenaire regardé), avec
    la même exigence de `search_path` fixé.
- **Ce qui reste vrai de l'analyse initiale** : aucune règle métier complexe n'est *seulement*
  encodée en SQL sans être testée — les fonctions Postgres partagées (`has_capability`, etc.)
  sont couvertes par des tests d'intégration (via une base de test/branche dédiée), avec la même
  discipline de tests déjà pratiquée dans ce projet.
- **Alternative comparée, écartée : Clerk/WorkOS** (fournisseurs d'identité B2B spécialisés,
  avec un concept natif d'organisation/membres/propriétaire très proche du besoin socio §1). Le
  fit fonctionnel est réel, mais deux raisons l'écartent : (1) coût récurrent significatif à
  l'échelle d'un marketplace grand public (Clerk : ~125-145 $/mois dès le plan B2B, plus
  dépassement par utilisateur actif au-delà de 50k — pertinent ici puisque les *clients*, pas
  seulement les partenaires, sont aussi des comptes du même système unifié) ; (2) la modélisation
  fine réellement nécessaire (capacité par établissement, statut par capacité, contrat accepté
  par rôle) resterait de toute façon à construire à la main par-dessus — Clerk n'achèterait que
  la mécanique générique d'invitation/retrait de membres, déjà largement conçue et partiellement
  implémentée dans le projet actuel (`docs/5-conception/roles-composables.md`). Supabase Auth
  (déjà retenu pour la base de données) couvre la mécanique de connexion à coût marginal nul.

### Attribution référent — un moteur unique QR/lien/code, incentive client découplé

**Décision 2026-08-13** : le mécanisme historiquement appelé « code promo » devient une couche
d'**attribution**. QR, lien attribué et code sous-jacent convergent vers un seul resolver qui fournit
un `referrer_id` au moteur de commande ; aucune branche de commission spécifique au QR ne doit
exister.

- **Pas de champ code dans le front client** : l'attribution arrive par le contexte du lien/QR ou
  une source technique équivalente.
- **Persistance uniquement sur compte authentifié/enregistré** : le compte porte son attribution
  partenaire active. Un invité garde l'attribution pour la commande en cours, mais aucune préférence
  durable n'est reconstruite depuis WhatsApp/email.
- **Last-touch explicite** : lorsqu'un compte enregistré revient via un nouveau code valide, ce
  dernier remplace l'attribution active pour les **prochaines** réservations. La commande enregistre
  toujours son propre snapshot, donc aucun historique n'est réattribué.
- **Discount client séparé** : l'ancien 10 % lié au code est désactivé. Conserver éventuellement
  un feature flag/config dormant pour un futur incentive (`customer_benefit_enabled=false`), mais
  cette brique ne doit jamais être une condition du resolver d'attribution.

### Jobs planifiés et connecteur PMS — Supabase Edge Functions + pg_cron/pg_net, sans Fly ni service tiers de jobs

Besoins concernés : sync PMS récurrente par propriété (client §5), expiration de commandes
(client §3f), file de réconciliation avec retries (client §3f, admin §3a), campagnes
email/WhatsApp reprenables avec revalidation d'audience à chaque envoi (admin §3f).

- **Pattern retenu** : chaque besoin est modélisé comme une **table Postgres faisant office de
  file d'attente** (colonnes de statut explicites — cohérent avec la state-machine déjà bien
  conçue dans le code actuel pour `mirror_failed`/`reparacion`, à porter telle quelle plutôt qu'à
  redécouvrir). `pg_cron` déclenche à intervalle régulier, via `pg_net`, une **Edge Function**
  Supabase ; celle-ci réclame un lot de lignes dues via `SELECT ... FOR UPDATE SKIP LOCKED`
  (évite qu'une exécution concurrente retraite les mêmes lignes), les traite (appels sortants
  LobbyPMS, WhatsApp via 360dialog — cf. section CRM ci-dessous, email), met à jour leur statut,
  sort. L'état vit entièrement en base, pas dans le process — une campagne interrompue ou une
  synchronisation ratée reprend automatiquement au prochain tick là où elle en était.
- **Pourquoi Supabase plutôt que Vercel Cron pour cette couche** : garder l'exécution des jobs à
  côté de la base (même plateforme que Postgres/Auth/Storage/Realtime) plutôt que de la répartir
  entre Vercel et Supabase réduit encore le nombre de surfaces à opérer — la même logique qui a
  fait écarter Fly. `pg_cron` est activé par défaut sur tous les projets Supabase ; combiné à
  `pg_net` il permet d'appeler une Edge Function ou une API externe sur un calendrier, sans
  service tiers.
- **Pourquoi pas de service de jobs tiers (Inngest/Trigger.dev/QStash)** : le besoin réel
  (polling par lot + state-machine + reprise) est entièrement couvert par Postgres + pg_cron
  sans complexité ajoutée, et évite un tiers de plus sur le chemin métier le plus sensible
  (anti-survente, argent réel via les commissions). À reconsidérer seulement si la durée d'une
  Edge Function (limitée à quelques minutes) devient trop courte pour un lot, à mesure que le
  volume grandit (marketplace à "dizaines voire centaines" de partenaires, admin §2) — pas une
  hypothèse de départ.
- **LobbyPMS comme première implémentation d'un contrat générique** (client §5) : le connecteur
  vit derrière une interface stable (disponibilité+prix par nuit, création de booking,
  rattachement d'activité, lecture d'occupation), appelée depuis les Edge Functions de jobs —
  un futur PMS différent sur une autre propriété implémente la même interface, sans toucher au
  reste.

### Temps réel — Supabase Realtime pour la propagation calendrier/cupos

Deux exigences explicites du cahier des charges appellent une vraie propagation live, pas
seulement un rafraîchissement au prochain chargement de page :
- client §2 : *"le client voit en temps réel les places restantes quand elles se raréfient"* ;
- socio §3d : *"fermer une date ici la retire immédiatement du calendrier public — aucun délai
  de propagation acceptable, sous peine de survente"*.

**Supabase Realtime** (souscription aux changements Postgres via son WAL) est un fit direct pour
ce besoin précis : une session client ouverte sur une fiche s'abonne aux changements du calendrier/cupos du produit
**et**, pour les offres qui partagent une ressource prestataire, aux blocages de cette ressource.
Une réservation de camp peut ainsi rendre immédiatement indisponibles plusieurs autres activités
sans attendre un rechargement.
Ne remplace pas l'invariant anti-survente (toujours vérifié en lecture fraîche + transaction
atomique côté serveur au moment de réserver, cf. ci-dessous) — Realtime n'est qu'un confort
d'affichage, jamais la source de vérité au moment de la validation finale.

**Précisions techniques ajoutées après challenge du plan** (le visiteur anonyme n'est PAS un
problème d'autorisation — il porte un JWT Supabase de rôle `anon`, évalué par RLS exactement
comme un `SELECT` classique ; si une policy de lecture publique existe sur la table
calendrier/cupos, ce qui est de toute façon nécessaire pour afficher la disponibilité, Realtime
fonctionne sans rien ajouter) :
- **`ALTER PUBLICATION supabase_realtime ADD TABLE ...`** doit être explicitement exécuté sur la
  table calendrier/cupos — ce n'est pas automatique à la création de la table.
- **Modéliser "fermer une date" comme une mise à jour de colonne de statut, jamais comme un
  `DELETE`** : un payload `DELETE` ne porte que la clé primaire côté Realtime, pas les colonnes
  précédentes, sauf à activer `REPLICA IDENTITY FULL` sur la table (coût de réplication
  supplémentaire). Modéliser en `UPDATE` évite ce piège et correspond de toute façon au modèle de
  données déjà retenu (statut ouvert/fermé/plein par date, pas une ligne supprimée).
- **À surveiller si le volume d'abonnements anonymes grossit** : Supabase documente que
  `postgres_changes` + RLS ne scale pas indéfiniment à fort fan-out anonyme, et recommande son
  API **Broadcast** (trigger → `realtime.broadcast_changes`) pour ce cas précis — pas un
  changement de décision au premier périmètre, mais un point d'extension à garder en tête plutôt
  qu'à découvrir en incident de charge.

### CRM et outillage admin — construit en interne, trois briques externes ponctuelles

Le back-office admin couvre 10 domaines (admin §2), dont un CRM complet (fiche 360°, carte +
itinéraire de visite, audiences/campagnes WhatsApp+email, suivi commercial — admin §3e/§3f). Deux
questions distinctes ont été creusées avant de conclure "tout construire à la main" par défaut.

**Faut-il un outil low-code/admin-panel (Retool, Appsmith, Budibase, Refine.dev) plutôt que du
code custom pour l'interface admin ?** Écarté comme plateforme hébergée, retenu comme bibliothèque
ponctuelle :
- La complexité réelle des 10 domaines n'est presque jamais dans l'interface, elle est dans le
  backend : moteur de commission conditionnel (17/10/7), machine à états de réconciliation PMS,
  ledger à 3 statuts, file de campagne reprenable avec revalidation d'audience à *chaque* envoi
  individuel (admin §3f), conformité Habeas Data. Ce backend doit exister quel que soit l'outil
  d'admin choisi — un outil low-code n'accélère que les écrans réellement CRUD (catalogue,
  registre partenaires, recherche globale), minoritaires ici.
- Retool exige soit une fédération d'auth avec le système déjà unifié (2FA obligatoire, audit
  nominatif — contradictoire avec l'identité unique du projet), soit un second référentiel
  d'utilisateurs ; son palier Enterprise (nécessaire pour 2FA/SSO en self-host) coûte
  significativement plus cher que prévu à cette échelle. Appsmith/Budibase exécutent leur JS
  côté navigateur — inadapté à une file d'envoi qui doit survivre à la fermeture de l'onglet.
- **Retenu** : **Refine.dev**, une bibliothèque React (pas un SaaS, pas de verrou fournisseur),
  importée dans le même projet Next.js, utilisée uniquement pour scaffolder les écrans
  véritablement CRUD (catalogue, registre partenaires, tables de commandes). Tout le reste —
  moteur de commission, file PMS, CRM carte/itinéraire, campagnes — reste du code custom
  contrôlant lui-même ses transactions et son audit trail.

**Faut-il adopter une plateforme CRM du marché (Twenty, Attio, HubSpot, Odoo, Zoho...) plutôt que
construire le CRM dans la même base ?** Écarté après comparaison sur les 4 besoins précis du
cahier des charges :
- **Identité unifiée** : chaque CRM du marché maintient ses **propres** fiches contact — même les
  plus "API-first" (Twenty, Attio) exposent une API/des webhooks vers *leur* schéma, pas une
  lecture directe des comptes du projet. Adopter l'un d'eux recréerait exactement le problème de
  désynchronisation d'identité que l'unification vient de résoudre (le seul CRM au modèle
  structurellement unifié, Odoo/`res.partner`, impliquerait d'y migrer l'auth et le cœur métier —
  disproportionné).
- **Carte + itinéraire optimisé multi-arrêts** : aucun CRM généraliste n'a ça nativement ; même
  les CRM "field sales" spécialisés (SPOTIO, Pipeline CRM) encapsulent en interne Google
  Maps/Mapbox — c'est toujours un appel API externe, quel que soit le CRM. **Retenu** : rester sur
  Google (déjà l'infra Geocoder utilisée aujourd'hui), activer `optimizeWaypointOrder` sur les
  appels **Google Routes API** — jusqu'à 25 arrêts par ID de lieu, réordonnancement type TSP,
  aucun nouveau fournisseur. Repli si le coût au volume devient un sujet : mettre en cache une
  matrice de distances et résoudre le TSP localement (2-opt/nearest-neighbor) — trivial à moins de
  20 nœuds.
- **Commission/ledger** : structurellement toujours applicatif — aucun CRM du marché ne modélise
  un moteur de taux conditionnel snapshoté par ligne de commande ni un ledger à 3 états ; c'est le
  cœur du produit, pas un champ CRM générique à louer.
- **Campagnes WhatsApp Business API (templates, fenêtre 24h) + email** : plusieurs CRM ont un
  support natif partiel (Zoho Enterprise/Ultimate, Salesforce Service Cloud, Pipedrive en bêta
  depuis juin 2026), mais aucun n'implémente l'exigence précise du cahier des charges — file
  reprenable **côté serveur** avec **revalidation d'audience à chaque envoi individuel** (logique
  de conformité Habeas Data trop fine pour un module de campagne CRM générique). **Retenu** : un
  BSP pur (Business Solution Provider) branché sous la logique de file déjà décidée (table
  Postgres + Edge Function/pg_cron, cf. section Jobs planifiés) plutôt qu'un CRM entier. Comparé
  sur le marché LATAM : **360dialog**, en mode API-only (pas leur inbox géré) — partenaire
  officiel Meta, ~49 €/mois forfaitaire avec une marge par message quasi nulle (contre ~0,005 $/
  message chez Twilio, qui croît avec le volume), webhooks proches du format Meta natif, migration
  triviale vers l'API Cloud Meta directe plus tard si le volume le justifie. **Point de coût à
  budgéter** : Meta facture désormais au message (pas seulement par conversation) depuis juillet
  2025 ; en Colombie, un template marketing coûte environ 0,0125 $ et un message utilitaire
  environ 0,0008 $ — parmi les tarifs les plus bas de la région, mais la fenêtre gratuite de 24h
  elle-même devient payante au 1er octobre 2026.

**Conclusion** : le CRM vit dans la même base Postgres/Supabase que le reste du produit (fiche
360°, tags, notes, listes de suivi, ledger, contrat de rôle — toutes déjà unifiées avec le compte
utilisateur), avec trois briques externes ponctuelles et interchangeables (360dialog pour l'envoi
WhatsApp, Google Routes API pour l'itinéraire, un fournisseur d'email ci-dessous), pas une
plateforme CRM entière.

**Fournisseur d'email — décision ajoutée après challenge du plan (trou identifié : "SMTP" était
mentionné en passant dans la section Jobs planifiés, sans fournisseur ni coût ni conformité).**
Le cahier des charges porte deux usages email distincts : notifications proactives transactionnelles
(nouvelle commission, proposition traitée, paiement — socio §1, admin §2) et campagnes admin en
texte libre (admin §3f, sans la contrainte de template qui s'applique à WhatsApp). Le mailer intégré
à Supabase Auth est explicitement à usage interne (emails d'authentification, quotas bas) — pas
adapté à ce volume ni à cet usage. **Retenu** : un fournisseur email transactionnel dédié (Resend
ou Postmark — écosystème Next.js/Vercel bien documenté pour les deux, choix final au chiffrage),
branché sous la même logique de file Postgres + Edge Function que WhatsApp (cf. section Jobs
planifiés), avec configuration DNS du domaine (SPF/DKIM/DMARC) pour la délivrabilité. **Conformité
Habeas Data pour les campagnes email, pas seulement WhatsApp** : la même autorisation préalable et
le même mécanisme de désinscription déjà actés pour les audiences clients (admin §3f) s'appliquent
au canal email — à ne pas traiter comme acquis uniquement parce que WhatsApp l'a explicité dans le
cahier des charges.

### Invariant anti-survente — le point le plus sensible du changement de moteur de données

C'est l'angle mort le plus important à ne pas sous-estimer. Aujourd'hui, la lecture-fraîche +
décrément + création de commande dans la même transaction est **gratuite** grâce à
`better-sqlite3` : écrivain unique, `db.transaction()` synchrone, zéro latence réseau
(`src/services/orderService.js:120,282,302`). Passer à Postgres over-network change la
physique : plusieurs instances serverless Vercel peuvent écrire concurremment.

- **Recommandation** : encapsuler chaque opération critique (réservation avec vérification de
  cupo, fermeture de date/créneau, décrément de capacité, **blocage multi-jours d'une ressource
  partagée**) dans **une fonction Postgres unique** (RPC `SECURITY DEFINER`), appelée en un seul
  aller-retour réseau depuis le Route Handler — jamais orchestrée en plusieurs requêtes séparées
  côté app. La fonction verrouille explicitement (`SELECT ... FOR UPDATE`) toutes les lignes de
  ressource/date concernées, dans un ordre déterministe, vérifie **toute** la plage d'un camp, crée
  la commande puis le blocage partagé avant le commit. L'indisponibilité des autres produits est
  dérivée de ce blocage : pas de boucle applicative qui fermerait N produits après coup. C'est le
  pendant Postgres exact du `db.transaction()` actuel.
- **Connexions serverless** : Vercel = fonctions nombreuses et courtes → passer par le pooler de
  connexions Supabase (Supavisor, mode transaction) pour les requêtes simples, et pousser les
  opérations critiques dans les RPC ci-dessus (un seul aller-retour) pour éviter toute ambiguïté
  de sémantique transactionnelle multi-requêtes sous pooler.
- **Comportement de panne** vérifié dans le cahier des charges (client §3d) : échec fermé —
  bloquer la réservation plutôt que risquer une survente si le service de calendrier est
  indisponible. À conserver tel quel.
- **Notification après commit** : le message « camp ou evento réservé, dates bloquées » est produit
  via le journal/outbox de notifications **après** réussite de la transaction. L'envoi du message
  peut être retenté sans jamais remettre en cause le blocage ; inversement, le blocage ne doit
  jamais attendre une réponse « oui/non » du prestataire.

### Stockage et images

- **Supabase Storage**, buckets privés uniquement — jamais d'URL publique permanente, accès par
  URL signée courte générée côté serveur (cohérent avec le principe "aucun accès direct
  navigateur → données" retenu ci-dessus, et avec la fuite PII déjà documentée dans l'app
  actuelle, gap G5 de l'audit — un justificatif de paiement retrouvé dans l'historique git).
- **Transformations d'image** (resize/optimisation des photos partenaires) : disponibles en
  service payant sur Supabase Storage (~$5/1000 images d'origine transformées, 100 gratuites) —
  suffisant pour le volume visé au premier périmètre. Alternative si besoin de contrôle plus fin
  au moment de l'upload (recadrage spécifique, strip EXIF) : traitement via `sharp` dans un
  Route Handler Vercel — les deux options restent sur la même stack, pas de service tiers requis.

### Environnements — préprod et prod séparés, données de préprod synthétiques

Jérôme a explicitement demandé une vraie séparation préprod/prod (pas seulement prod + previews
éphémères par PR, le comportement par défaut), avec des données de test en préprod.

- **Web (Vercel) : Custom Environment `staging`**, pas seulement Preview. Un Custom Environment
  (disponible dès le plan Pro) porte un domaine stable (`staging.hifago.com`, pas une URL de
  commit éphémère), un rattachement de branche (`staging` → redéploiement automatique dans cet
  environnement) et son propre jeu de variables d'environnement — distinct des previews éphémères
  par PR, qui restent utiles en complément pour la revue de code. **Workflow** : PR de feature →
  preview éphémère pour la revue → merge sur `staging` → déploiement auto en préprod (clés
  sandbox) → une fois validé, PR `staging → main` revue puis **promotion manuelle vers la
  production** (jamais automatique sur simple push) via GitHub Environments avec "Required
  reviewers" (audit trail natif) ou le bouton "Promote to Production" de Vercel.
- **Base de données (Supabase) : un second projet Supabase dédié à la préprod**, pas une branche
  persistante. Une branche Supabase persistante existe techniquement (recommandée par Supabase
  pour du staging), mais n'apporte aucun avantage réel ici : coût de compute équivalent à un
  second projet, aucune isolation totale (même organisation/région que le parent), secrets
  d'Edge Functions à reconfigurer manuellement de toute façon, et l'intégration Vercel×Supabase
  Branching est conçue pour les previews éphémères par PR (avec des races documentées), pas pour
  porter un environnement nommé permanent. Les branches éphémères restent utilisées en complément
  pour les previews par PR ; la préprod stable vit sur son propre projet, aligné en configuration
  via les migrations versionnées (CLI, config as code).
- **Données de préprod : synthétiques, jamais une copie de production.** Convention Supabase
  native `supabase/seed.sql` — rejoué automatiquement à chaque `supabase db reset` et à la
  création d'une branche de preview, applicable telle quelle au projet préprod. Contenu : jeu de
  données généré (établissements PMS-backed et non-PMS-backed, chambres avec grille tarifaire par
  date, comptes partenaires à divers statuts de capacité, commandes dans divers états pour
  exercer le moteur de commission et le ledger, codes promo, contenu multilingue d'exemple pour
  valider le repli JSONB et la logique d'indexation SEO) — jamais de PII réelle. Cohérent avec la
  décision déjà actée (gap G5 de l'audit : les fichiers utilisateur/PII ne doivent jamais fuiter
  hors du stockage de données dédié — la même prudence s'applique à la préprod, moins protégée que
  la prod).
- **Point de vigilance découvert en creusant — IP de sortie stable pour LobbyPMS.** Le connecteur
  PMS n'accepte que les requêtes venant d'une IP explicitement whitelistée côté PMS (aujourd'hui
  l'IP fixe de la machine Fly). Ni Vercel (Static IPs : de l'ordre de 100 $/mois par projet
  d'après la documentation — **la granularité exacte par rapport aux Custom Environments n'a pas
  été vérifiée précisément et ce chiffre est à confirmer**, pas à traiter comme acquis) ni
  Supabase Edge Functions (aucune IP de sortie stable native, documenté officiellement par
  Supabase) ne résolvent ça nativement à un coût comparable à l'alternative retenue. **Solution
  retenue** : un relais réseau minimal auto-hébergé par environnement (ex. Hetzner CX22 ou
  équivalent, ~5 €/mois), un simple reverse-proxy authentifié (pas de logique applicative) vers
  lequel pointent à la fois les Route Handlers Vercel et les Edge Functions Supabase pour tout
  appel sortant vers LobbyPMS — deux instances (préprod + prod) pour environ 10-12 $/mois au
  total.
  - **Honnêteté sur le compromis** (challengé explicitement) : ce relais réintroduit exactement le
    type d'infrastructure brute (Linux à patcher/sécuriser/surveiller soi-même) que le rejet de
    Fly visait à éliminer. Ce n'est pas un choix d'hébergement applicatif, mais ça reste un vrai
    morceau d'exploitation manuelle — la seule pièce de toute l'architecture dans ce cas, à
    documenter comme telle plutôt qu'à minimiser.
  - **Point ajouté après challenge — comportement de panne du relais et supervision.** Ce relais
    est sur le chemin de **toute** requête sortante vers LobbyPMS, y compris la disponibilité en
    temps réel au moment d'une réservation PMS-backed. Sa panne doit suivre la même règle
    d'échec fermé déjà actée (bloquer la réservation concernée plutôt que risquer une incohérence)
    — jamais un contournement silencieux. Une supervision minimale (health check + alerte, ex.
    UptimeRobot gratuit ou équivalent) est nécessaire dès le premier périmètre, pas différée : un
    relais qui tombe sans alerte casse silencieusement toute vente PMS-backed.
  - À réévaluer si LobbyPMS évolue vers une authentification par jeton seul (sans restriction IP).
- **Sauvegarde et restauration — décision ajoutée après challenge du plan (absente de la version
  précédente).** L'app actuelle a un scheduler de backup SQLite explicite avec rétention
  documentée ; ce sujet n'a pas d'équivalent dans les sections précédentes alors que de l'argent
  réel est en jeu (commissions, ledger). **Retenu** : l'add-on **Point-in-Time Recovery (PITR)**
  de Supabase sur le projet de production (plan Pro requis, rétention configurable — au moins
  7 jours au premier périmètre, à ajuster au chiffrage selon l'exposition au risque acceptée par
  Jérôme), plus les sauvegardes quotidiennes automatiques incluses au plan Pro en complément. Le
  projet préprod n'a pas besoin de PITR (données synthétiques, reconstructibles à tout moment via
  `seed.sql`). Supabase Storage (photos, comprobantes) suit une politique de rétention séparée à
  documenter au chiffrage — ne pas supposer qu'elle est couverte par le PITR de la base, qui ne
  couvre que Postgres.

### Tests et CI/CD

- **E2E : Playwright**, pas Cypress. Raison principale : Playwright pilote nativement plusieurs
  `BrowserContext` isolés (cookies/storage distincts) dans un seul process de test hors-navigateur
  — c'est le seul moyen fiable de reproduire *in vivo* le scénario le plus critique du produit
  (deux clients qui tentent d'obtenir la même dernière place au même instant). Cypress, piloté
  depuis l'intérieur du navigateur, ne gère qu'un onglet à la fois et rend ce test fragile
  (contournements par iframe/plugin tiers). Autres raisons convergentes : Playwright est le
  scaffold officiel Next.js (`create-next-app --example with-playwright`), benchmarks 2026
  favorables en stabilité/vitesse CI, sharding natif gratuit (vs Dashboard payant chez Cypress).
  **Auth en test** : jamais le vrai écran Google OAuth en CI — login programmatique via l'API REST
  Supabase, session sauvegardée en `storageState.json` réutilisé comme fixture par rôle
  (client/socio/admin), MFA/TOTP admin généré sans téléphone via `otplib` à partir d'un secret de
  test.
- **Unitaire/composant : Vitest**, pas Jest — plus rapide (ESM natif), recommandation par défaut
  de la doc Next.js pour un projet neuf. Le moteur de commission (17/10/7) est gardé en fonction
  pure (DTO en entrée, aucun appel Supabase direct) et testé sans mock, avec une matrice de cas
  limites déjà largement documentée dans le cahier des charges.
- **Test de l'invariant anti-survente sous VRAIE concurrence — pgTAP explicitement écarté pour ce
  cas précis.** pgTAP exécute chaque fichier de test dans une seule transaction annulée en
  rollback : structurellement incapable de simuler une vraie condition de course. **Approche
  retenue** : test d'intégration au niveau RPC direct (pas la route HTTP complète), contre une
  vraie instance Postgres locale (`supabase start` en CI, jamais un mock) — N connexions
  synchronisées par une barrière commune puis relâchées simultanément (pas un simple
  `Promise.all` sans synchronisation, qui ne garantit pas le chevauchement réel et produit des
  tests instables), assertion d'exactement 1 succès sur N tentatives concurrentes visant la
  dernière place. pgTAP reste l'outil de référence pour tout le reste (policies RLS, contraintes,
  logique séquentielle), juste pas pour cet invariant précis.
- **Connecteur LobbyPMS** : fixtures enregistrées (Nock/MSW) couvrant les cas fragiles déjà
  documentés dans l'audit (catégorie non réservable, forme de réponse divergente) pour des tests
  rapides et déterministes à chaque PR, complétées par un job **nocturne séparé** (pas bloquant
  pour les PR) qui frappe le vrai sandbox LobbyPMS pour détecter une dérive de contrat API.
- **Pipeline GitHub Actions** (ordre) : lint/typecheck/unitaire en jobs parallèles → intégration
  (RPC/RLS contre la stack Supabase locale du runner, migrations versionnées faisant foi) →
  build → déploiement preview → E2E Playwright contre le **vrai** déploiement preview Vercel
  (déclenché sur l'événement `deployment_status`, avec les en-têtes de contournement de
  Deployment Protection) → sur la branche `staging` : déploiement préprod + smoke test minimal
  (health check + un parcours critique) → promotion manuelle vers la prod via GitHub Environments
  avec approbateurs requis (cf. section Environnements ci-dessus).

### Ce qui change par rapport à l'intuition de départ

| Élément | Intuition de départ | Recommandation | Pourquoi |
|---|---|---|---|
| Web | Next.js/Vercel | **Confirmé**, une seule app à route groups | Le besoin SEO/applicatif se résout par route, pas par séparation d'app |
| Base de données | Supabase (implicite : plateforme complète) | **Confirmé et étendu** : Supabase utilisé pleinement (Postgres+PostGIS, Auth, Storage, Realtime, Edge Functions/pg_cron) | Neon techniquement compétitif mais ne fournit pas le bundle ; un seul fournisseur backend, cohérent avec le rejet de Fly |
| Autorisation | Non précisé | Supabase Auth à fond + RLS en défense en profondeur (fonctions centralisées), logique complexe/sensible arbitrée côté app | RLS pur risquait la duplication/divergence sur le modèle de rôles composables ; ce garde-fou reste sans renoncer à RLS partout ailleurs |
| Jobs/PMS/campagnes | Non précisé (Vercel implicite) | Supabase Edge Functions + pg_cron/pg_net + Postgres-comme-file, **sans Fly, sans service tiers de jobs, sans Vercel Cron** | Regroupe toute l'exécution backend sur une seule plateforme, cohérent avec le rejet de Fly |
| Temps réel | Non précisé | Supabase Realtime pour la propagation calendrier/cupos | Répond directement à une exigence explicite (client §2, socio §3d), pas seulement un confort |
| Séparation apps | Non précisé (question posée par Jérôme) | **Révisé le 2026-08-14** : deux apps (`apps/web` vitrine / `apps/admin` admin+socio), sessions indépendantes, monorepo npm workspaces + packages partagés | L'argument identité unifiée/session tombe (sessions volontairement indépendantes, assumé) ; duplication traitée par `packages/ui`/`packages/supabase`/`packages/domain`, un module n'y migre que si prouvé partagé |
| Outillage admin | Non précisé (question posée par Jérôme) | Code custom + Refine.dev en bibliothèque pour les écrans CRUD seulement, pas de plateforme low-code hébergée | La complexité est dans le backend métier, pas l'UI ; Retool/Appsmith n'accélèrent que la part minoritaire |
| CRM | Non précisé (question posée par Jérôme) | Construit dans la même base Postgres/Supabase, + 360dialog (WhatsApp) + Google Routes API (itinéraire) | Toute plateforme CRM du marché recréerait la désynchronisation d'identité déjà résolue |
| Design system / UI | Non précisé (question posée par Jérôme) | **Révisé le 2026-08-14** : HeroUI v3 (React Aria+Tailwind v4) partout, Recharts pour les graphiques, react-day-picker (client) + FullCalendar (admin) pour le calendrier, TanStack Table pour les tables | Un seul système visuel cohérent (deux thèmes nommés `vitrine`/`admin`, mêmes composants) ; HeroUI non évalué le 2026-08-12 (fait nouveau) ; MUI X Data Grid toujours écarté, pour ne pas réintroduire un second design system |
| Calendrier agenda socio | Non précisé | **Révisé le 2026-08-18** : SVAR React Calendar (`@svar-ui/react-calendar`, MIT, v2.6.2 stable) — après un premier choix MUI X Scheduler abandonné en cours de construction (aucun callback de clic public, vérifié dans ses `.d.ts`) | Besoin événement-par-réservation multi-produits jamais couvert par FullCalendar dayGrid ; SVAR expose une vraie API d'événements (`onSelectEvent`/`onAddEvent`) sans réintroduire de second design system — cf. section Design system plus haut |
| i18n interface + SEO multilingue | Non précisé (question posée par Jérôme) | next-intl pour les libellés d'interface ; routage par sous-chemin `/es/`/`/en/`, hreflang généré via `generateMetadata`, indexation conditionnée à l'existence d'une vraie traduction (pas au repli JSONB) | Seule lib nativement App Router + SEO intégré ; évite le duplicate content perçu entre langue de repli et langue routée |
| Multilingue | Non précisé | JSONB par champ | Fit direct avec le besoin (extensible, replié, SEO-friendly) |
| Invariant anti-survente | Non précisé | RPC Postgres `SECURITY DEFINER` avec verrouillage explicite | Gratuit sous SQLite, doit être reconçu explicitement sous Postgres réseau |
| Préprod/prod | Non précisé (demandé par Jérôme) | Vercel Custom Environment `staging` + second projet Supabase dédié, données synthétiques via `seed.sql`, relais réseau minimal (~5€/mois/env) pour l'IP stable LobbyPMS | Isolation réelle sans dupliquer l'app ; le relais IP est une nécessité réseau LobbyPMS, pas un retour sur le rejet de Fly — coût réel assumé honnêtement |
| Tests/CI-CD | Non précisé (demandé par Jérôme) | Playwright (E2E) + Vitest (unitaire) ; anti-survente testé par RPC direct + barrière de synchro contre Postgres réel (pas pgTAP, structurellement incapable de simuler la concurrence) | Playwright est le seul à piloter plusieurs contextes navigateur isolés, nécessaire pour prouver l'invariant anti-survente sous charge réelle |
| Sauvegarde/PITR | Non précisé (trou identifié en challengeant le plan) | Add-on PITR Supabase sur le projet prod (rétention ≥7j), sauvegardes quotidiennes incluses au plan Pro | De l'argent réel est en jeu (commissions/ledger) ; l'app actuelle a déjà un scheduler de backup explicite, pas d'équivalent n'était prévu |
| Email transactionnel/campagnes | Non précisé (trou identifié en challengeant le plan) | Resend ou Postmark (choix final au chiffrage), pas le mailer Supabase Auth (usage interne, quotas bas) | Deux usages réels du cahier des charges (notifications proactives, campagnes admin) sans fournisseur nommé dans la version précédente |

---

## Points volontairement non tranchés ici (renvoyés au chiffrage, comme le veut la méthode déjà suivie dans les 3 cahiers des charges)

- Niveaux d'accès différenciés entre utilisateurs d'une même organisation partenaire (accès
  identique vs permissions par personne) — socio §1/§4, déjà noté comme ouvert.
- Détail de la table/state-machine exacte de la file de réconciliation et des campagnes
  (schéma précis des colonnes de statut) — le principe (Postgres-comme-file + cron) est acté ici,
  le schéma se conçoit au chiffrage.
- Fréquence exacte du cron PMS par propriété et taille de lot par tick — dépend du volume réel de
  propriétés PMS-backed, à dimensionner au chiffrage.
- Paiement en ligne — **rouvert le 2026-08-18** (n'est plus hors périmètre) : Jérôme a tranché
  Mercado Pago comme gateway cible (remplace l'hypothèse Wompi/Stripe évoquée ici), acompte
  obligatoire, ledger de règlement, virement automatique au référent et à l'établissement
  (compensation no-show) — voir `docs/specs/19-paiement-mercadopago-acompte-ledger.md`.
- Plan de bascule (migration des données réelles, cutover) — étape séparée et ultérieure du
  chantier, pas ce document.
- **Format de l'export comptable/fiscal** (admin §3g — "un format exploitable par un comptable") :
  un CSV brut depuis le ledger n'est pas la même charge qu'un format compatible avec un logiciel
  comptable colombien courant (Siigo, Alegra, World Office), ou qu'une exigence de facturation
  électronique DIAN si les commissions/paiements aux prestataires en relèvent — question identifiée
  en challengeant le plan, non triviale vu le contexte colombien, à trancher explicitement au
  chiffrage plutôt que supposer qu'un export SQL suffit.
- Fournisseur email final (Resend vs Postmark) et détail de la politique de rétention/backup de
  Supabase Storage (photos, comprobantes) — décisions de principe actées ci-dessus, détail
  d'implémentation renvoyé au chiffrage.

## Validation — deux spikes exécutés le 2026-08-12, résultats positifs

Les deux spikes techniques recommandés ont été exécutés contre une stack Supabase **100 % locale**
(Docker, `supabase start` — zéro ressource cloud créée, cohérent avec la méthode de test déjà
actée dans la section Tests et CI/CD). Scripts et migrations dans un dossier jetable (non
versionné, hors de ce dépôt) ; résultats consignés ici pour mémoire.

1. **RPC Postgres transactionnel (invariant anti-survente)** — **✅ validé.** Fonction
   `reserve_slot()` reproduisant le pattern retenu (`SECURITY DEFINER`, `SET search_path = ''`,
   verrouillage explicite `SELECT ... FOR UPDATE`, un seul aller-retour). Test de concurrence
   réelle avec barrière de synchronisation (20 connexions Postgres indépendantes relâchées au même
   instant sur une place à capacité 1, pas un `Promise.all` naïf) : **9 exécutions consécutives
   propres, exactement 1 succès sur 20 tentatives concurrentes à chaque fois**, état final en base
   toujours cohérent (`booked = 1`, une seule ligne créée dans `reservations`). L'invariant tient
   sous charge concurrente réelle, pas seulement en séquentiel.
2. **Requête géo + JSONB combinée** — **✅ validé.** Table `products` avec `location
   geography(point,4326)` (index GiST) + `name`/`description` en JSONB, peuplée de 50 000 lignes
   (dont un mélange dense autour du point de recherche — pire cas volontairement plus chargé
   qu'un scénario réaliste au premier périmètre). Requête réelle de page de listing (rayon 20 km
   + repli `coalesce(name->>'en', name->>'es')`, triée par distance, LIMIT 20) :
   - `EXPLAIN ANALYZE` confirme l'usage de l'index GiST (`Bitmap Index Scan on
     products_location_gix`), pas de scan complet de table ;
   - **p50 = 40 ms, p95 = 80 ms** de temps de réponse round-trip (20 exécutions), sur un jeu de
     données déjà à l'échelle de plusieurs milliers de partenaires — largement compatible avec une
     page ISR, d'autant que cette requête ne s'exécute pas à chaque vue une fois mise en cache ;
   - le repli JSONB fonctionne comme prévu : sur l'échantillon dans le rayon, 3 253 fiches sans
     traduction EN retombent correctement sur ES via `coalesce`.

**Conclusion** : les deux points les plus novateurs de l'architecture sont désormais vérifiés par
un test réel, pas seulement une hypothèse de conception. Cette architecture peut servir de base au
chiffrage technique complet (découpage en lots, estimation, ordre d'implémentation) — prochaine
étape naturelle.
