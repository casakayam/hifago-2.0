---
id: specs-listes-standardisees-admin-socio
titre: "Listes admin/socio standardisées — pagination, tri, filtres, composant réutilisable"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: 2026-08-15
resume: >
  Standardise les 13 pages liste d'apps/admin (admin + socio) derrière un composant réutilisable
  unique (`DataList`) : pagination et tri pilotés par l'URL, filtres déclaratifs, clic sur une
  ligne vers une page de détail dédiée, boutons d'action selon ce qui est réellement possible par
  entité, pleine largeur — sans changer les champs déjà affichés en colonne.
mots_cles: [liste, tableau, pagination, tri, filtre, DataList, ServerPagination, TanStack Table,
  SimpleTable, admin, socio, standardisation, pleine largeur]
repond_a:
  - "Quel composant réutiliser pour toute nouvelle page liste admin/socio ?"
  - "Comment le tri et les filtres doivent-ils être pilotés (URL vs état client) ?"
  - "Quelles colonnes/filtres/tri/actions proposer pour chacune des listes existantes ?"
  - "Quelles listes manquent encore d'une page de détail dédiée, et laquelle créer ?"
  - "Pourquoi les listes admin/socio sont-elles contraintes en largeur aujourd'hui, et comment lever ça sans casser les formulaires ?"
---

# Listes admin/socio standardisées

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). `apps/web` (catalogue vitrine,
> historique de commandes client) explicitement hors périmètre — décision Jérôme, cf. §3. Pas de
> numéro de build hifago dédié (changement transverse, pas une feature fonctionnelle isolée).
>
> **Numéro de fichier `10-`** — vérifié juste avant création (`ls docs/specs/`) : `09` a été pris
> entre-temps par une session concurrente (`09-design-system-admin.md`, sans rapport avec cette
> spec). Les 3 renvois de `08-admin-gestion-activite.md` vers « spec 09 » (créneaux horaires,
> jamais réservés que de façon informelle, « numéro à reconfirmer ») ont été corrigés dans le même
> lot pour ne plus pointer sur un mauvais numéro.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6-9 | *(fusionnées dans 0 — détaillées ici seulement si la justification ne tient pas en une ligne)* | — |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

```
list_clients(p_search text, p_email text, p_sort text default 'last_order_at',
             p_sort_direction text default 'desc', p_limit int default 20, p_offset int default 0)
  → table(client_key, display_name, email, phone, orders_count, last_order_at, total_count)
  MODIFIÉE (supabase/migrations/20260815100000_list_clients_rpc.sql) — ajoute p_sort/p_sort_direction,
  whitelist interne : display_name | email | orders_count | last_order_at.

get_client(p_client_key text) → jsonb
  NOUVELLE — identité agrégée (même logique de coalesce que list_clients) + liste des commandes.

list_proposals(p_status text, p_entity text, p_kind text, p_partner_id uuid, p_search text,
               p_sort text default 'created_at', p_sort_direction text default 'desc',
               p_limit int default 20, p_offset int default 0)
  → table(id, entity_type, kind, status, display_name, partner_name, created_at, updated_at, total_count)
  NOUVELLE — union product_proposals ∪ establishment_proposals, impossible à paginer/trier en deux
  requêtes PostgREST séparées. Précédent exact : list_clients (count(*) over() → total_count).

Squelette sécurité des 3 : security definer + set search_path='' + garde is_admin(auth.uid())
interne + grant execute to authenticated explicite (jamais accordé par défaut sur une fonction
créée par le rôle postgres — hifago/CLAUDE.md §11.1). PAS le squelette anti-survente
(hifago/docs/05-reference-technique.md §1) — lectures pures, aucun compteur de capacité en jeu,
aucun SELECT...FOR UPDATE nécessaire.
```

### Modèle de données (delta)

```
Aucune table créée. Aucune colonne ajoutée. Aucune policy RLS modifiée.

Index ajoutés (perf du tri par défaut désormais imposé sur ~13 écrans, aucune de ces colonnes
n'étant indexée aujourd'hui — vérifié par grep sur toutes les migrations) :
  comm_campaigns(created_at desc) · establishments(created_at desc) ·
  partner_invitations(created_at desc) · products(created_at desc) · partners(created_at desc) ·
  catalog_tags(created_at desc) · pms_reconciliation_entries(created_at desc) ·
  pms_reconciliation_entries(status) · order_lines(date) · order_lines(status)
```

### Invariants

```
- Une clé de tri (?sort=) n'atteint .order()/ORDER BY que via une VALEUR d'un dictionnaire codé en
  dur côté serveur (whitelist clé d'URL → expression SQL) — jamais la chaîne d'URL interpolée.
- Une valeur de filtre à choix fermé hors liste est ignorée, jamais transmise à la requête, jamais
  une erreur 500.
- ?sort= inconnu ou ?dir= invalide → repli silencieux sur le tri par défaut de la liste (même
  posture défensive que resolvePageParams déjà en place).
- Tout changement de tri ou de filtre retire ?page= de l'URL (retour page 1).
- ?page= reste >= 1 quelle que soit l'entrée (resolvePageParams, inchangé).
- Les 13 listes sont paginées côté SERVEUR : `rows` reçu par DataList est déjà la page courante ;
  aucun sortedRowModel/paginatedRowModel TanStack n'est enregistré (manualSorting/manualPagination
  uniquement, rowCount = totalCount).
- Une colonne issue d'une ressource embarquée (jointure) ou calculée en JS n'est jamais triable
  (sortable: false) : un tri serveur ne peut pas la produire.
- Un filtre ne peut jamais élargir la visibilité : il s'applique après la RLS, ou à l'intérieur
  d'une RPC après sa garde is_admin().
- Chaque ligne mène à une page dédiée (rowHref), sauf 2 exceptions documentées et assumées :
  /admin/clients (vue agrégée, pas une entité persistée) et /partner/commissions (la ligne montre
  déjà tout ce que la RLS autorise le référent à voir).
- Les data-testid existants (pagination*, sort-<col>, <prefix>-row-<id>, liens d'action,
  no-orders/no-commissions, etc.) sont préservés à l'identique — aucune régression e2e silencieuse.
```

### Cas limites

```
?page=999 au-delà du dernier          → page vide + "Página 999 de N", Anterior actif (inchangé).
?sort=<colonne inexistante>           → tri par défaut, pas d'erreur.
?status=<valeur hors check>           → filtre ignoré, liste complète.
Filtre vidé puis formulaire soumis    → paramètre absent de l'URL, jamais "" transmis.
Liste vide après filtrage             → message d'état vide dédié, pagination "Página 1 de 1".
q contenant % ou _                    → jokers ilike (comportement actuel /admin/products, non régressé).
client_key contenant @, ., +          → encodeURIComponent obligatoire dans l'URL de la fiche client.
Résolution d'une entrée réconciliation → router.refresh() (jamais mutation d'état local) : la
                                         ligne peut sortir du filtre actif.
Ligne dont le statut change et sort du filtre actif → refresh serveur, jamais de mutation locale.
0 résultat sur /partner/commissions   → 3 totaux à 0, table masquée, message no-commissions préservé.
Tri par défaut sur colonne nullable (consumed_at, last_attempt_at) → NULLS LAST explicite.
```

### Fichiers touchés

```
packages/ui/src/components/data-list.tsx          (nouveau — DataList, "use client")
packages/ui/src/components/server-filters.tsx      (nouveau — ServerFilters)
packages/ui/src/index.ts                           (2 exports ajoutés)
packages/domain/src/list/resolveSortParams.ts       (nouveau)
packages/domain/src/list/resolveFilterParams.ts     (nouveau)
packages/domain/src/list/resolveListParams.ts       (nouveau)
packages/domain/src/index.ts                        (3 exports ajoutés)
apps/admin/lib/lists/sortable-columns.ts            (nouveau — whitelists par liste)
apps/admin/lib/lists/filters.ts                     (nouveau — définitions de filtres par liste)
apps/admin/app/admin/layout.tsx                                     (retrait max-w-5xl)
apps/admin/app/partner/(app)/layout.tsx                             (retrait max-w-3xl)
apps/admin/app/partner/(app)/{commissions,products,establishment,tools}/layout.tsx  (retrait wrapper mort)
apps/admin/app/admin/{campaigns,clients,establishments,invitations,orders,partners,products,
  proposals,reconciliation,tags}/page.tsx + <Entity>List.tsx        (13 × page + composant client)
apps/admin/app/admin/{clients/[key],invitations/[id],tags/[id],reconciliation/[id]}/page.tsx  (nouvelles fiches)
apps/admin/app/partner/(app)/{products/[id],establishment/[id]}/page.tsx           (nouvelles fiches)
apps/admin/app/admin/reconciliation/ResolveEntryDialog.tsx           (mutation locale → router.refresh())
supabase/migrations/<ts>_list_clients_sort.sql       (modifie list_clients)
supabase/migrations/<ts>_get_client_rpc.sql          (nouvelle RPC)
supabase/migrations/<ts>_list_proposals_rpc.sql      (nouvelle RPC)
supabase/migrations/<ts>_list_sort_indexes.sql       (10 index)
```

---

## 1. Contexte et problème

Aujourd'hui, 13 pages liste existent dans `apps/admin` (10 admin + 3 socio), chacune réinventée à
sa façon : pagination côté serveur sur 7 d'entre elles (`campaigns`, `clients`, `establishments`,
`invitations`, `orders`, `partners`, `products`), côté client uniquement sur 1
(`/partner/commissions`, tout chargé sans `.range()`), absente sur 5 (`proposals`,
`reconciliation`, `tags` — volontairement, volume attendu faible —, `/partner/products`,
`/partner/establishment`). Aucun tri n'est piloté par l'URL nulle part (grep confirmé) : soit un
tri serveur fixe non modifiable par l'utilisateur, soit un tri client TanStack Table qui ne survit
pas à un refresh (`/admin/orders`, `/partner/commissions`). Aucun composant de filtre partagé
n'existe : chaque page a son `?q=`/`?status=`/`?email=` ad hoc, jamais factorisé. Deux idiomes de
table cohabitent — `Table` compound HeroUI (8 pages) vs TanStack Table + `SimpleTable` (2 pages,
là où un vrai tri interactif était nécessaire), conforme à la distinction déjà écrite dans
`hifago/CLAUDE.md` §2.2 mais jamais généralisée. Toutes les listes sont contraintes en largeur
(`max-w-5xl` admin, `max-w-3xl` socio), aucune ne prend l'écran en entier.

Le triptyque d'actions Ver/Editar/Eliminar n'a jamais été une règle écrite avant cette spec — il a
émergé empiriquement le 2026-08-15 : Jérôme a dû signaler après un premier passage **visuel** (pas
détecté par l'e2e par sélecteurs) l'absence de lien « Editar » sur `/admin/products` (liste) et
`/admin/tags`, corrigés dans l'urgence après coup
(`hifago/docs/journal/2026-08.md`, dernière entrée). C'est le déclencheur direct de cette spec :
Jérôme demande maintenant que pagination, tri, filtres, clic-vers-détail et boutons d'action
deviennent une règle explicite et un composant unique, pas une découverte au cas par cas à chaque
nouvelle liste.

La pagination serveur elle-même n'est pas nouvelle comme *principe* — elle est déjà tranchée par
G15 (cahier des charges admin §6, décision du 2026-08-11 : « la liste des destinataires/contacts
doit être paginée dès la cible, pas ajoutée quand elle deviendra visiblement lente ») et
généralisée à toutes les listes admin par `docs/specs/02-admin-accueil-et-navigation.md` §3. Cette
spec ne réinvente donc pas la pagination — elle complète ce qui manque encore (tri serveur réel,
filtres factorisés, clic-vers-détail systématique, pleine largeur) et le fait converger vers un
seul composant, là où spec 02 avait livré `ServerPagination`/`resolvePageParams` mais laissé
chaque page composer le reste à la main.

## 2. Portée

**In** :
- Un composant réutilisable `DataList` (`packages/ui`) consommé par les 13 listes d'`apps/admin`
  (10 admin + 3 socio) — pagination, tri, filtres, clic-vers-détail, actions de ligne.
- Helpers serveur `resolveSortParams`/`resolveFilterParams`/`resolveListParams`
  (`packages/domain`), composés avec `resolvePageParams` existant, jamais dupliqués.
- Conversion des 5 listes non paginées (`proposals`, `reconciliation`, `tags`, `/partner/products`,
  `/partner/establishment`) et de la liste paginée côté client (`/partner/commissions`) vers la
  pagination serveur uniforme.
- Conversion de `/admin/proposals` et `/admin/reconciliation` du format cartes vers le composant
  standard (actions "Revisar"/"Resolver" conservées, pas nécessairement Editar/Eliminar).
- Tri serveur réel (piloté par l'URL) sur les 13 listes, whitelist de colonnes par liste.
- Filtres déclaratifs par liste, ancrés dans des colonnes réelles (jamais inventées).
- 6 nouvelles pages de détail minimales pour les listes qui n'en ont pas aujourd'hui : `/admin/
  clients/[key]`, `/admin/invitations/[id]`, `/admin/tags/[id]`, `/admin/reconciliation/[id]`,
  `/partner/products/[id]`, `/partner/establishment/[id]` — contenu minimal (champs déjà connus +
  boutons déjà écrits), pas une refonte.
- Pleine largeur des pages liste (retrait des `max-w-*` de layout, sans toucher aux formulaires qui
  portent déjà leur propre largeur locale).
- 3 objets RPC (`list_clients` modifiée, `get_client` et `list_proposals` nouvelles) + 1 migration
  d'index.

**Out, explicitement renvoyé ailleurs** :
- `apps/web` (catalogue vitrine public, historique de commandes du compte client) — décision
  Jérôme, cf. §3.
- Toute nouvelle capacité métier absente aujourd'hui (pas de RPC `update_partner`, pas de
  suppression/archivage d'établissement, pas de suppression d'invitation au-delà de la révocation
  déjà existante, pas de suppression de campagne) — cette spec ne comble pas ces trous, elle les
  documente (§10) ; le triptyque Ver/Editar/Eliminar est une règle avec exceptions énumérées, pas
  un absolu, conforme à la demande de Jérôme (« boutons spécifiques selon ce qui est possible »).
- Refonte du contenu des colonnes déjà affichées — hors périmètre par consigne explicite de
  Jérôme (« les champs restent tels quels pour l'instant »).
- Adoption de Refine.dev — décision Jérôme, cf. §3.
- Ordre d'affichage par drag/flèches + tri par colonne qui le suspend temporairement (cahier des
  charges admin §3c, spécifique au catalogue) — mécanisme distinct d'un tri de colonne standard,
  jamais construit à ce jour, renvoyé à une future spec catalogue si Jérôme le priorise.
- Recherche globale multi-entités — déjà explicitement hors périmètre de spec 02 §2, conditionnée
  à un volume de données pas encore atteint ; non rouverte ici.

## 3. Décisions retenues

Décisions actées avec Jérôme pendant la clarification de cette spec (à ne pas rouvrir sans fait
nouveau) :

- **Périmètre `apps/admin` uniquement** — les 2 listes publiques d'`apps/web` (catalogue vitrine,
  historique de commandes) restent telles quelles : pas de notion d'édition côté public, déjà
  cliquables vers leur détail produit/aucune fiche commande.
- **`/admin/proposals` et `/admin/reconciliation` inclus**, malgré leur forme actuelle en cartes —
  convertis vers le même composant standard, avec leurs actions propres conservées.
- **Pas de Refine.dev** — vérifié gratuit (MIT, `@refinedev/core`/`@refinedev/react-table`, aucun
  palier payant nécessaire), mais Jérôme choisit explicitement de ne pas l'introduire dans cette
  spec ; rester sur du TanStack Table v9 câblé à la main, comme `/admin/orders` et
  `/partner/commissions` aujourd'hui. L'écart déjà documenté dans `docs/04-architecture-cible.md`
  et `docs/specs/08-...md` §2 (Refine prescrit pour les écrans CRUD, jamais utilisé) reste donc
  ouvert et non comblé — à ne pas re-proposer sans fait nouveau.

Décisions déjà actées ailleurs, qui s'appliquent ici sans être rouvertes :
- Pagination toujours pilotée par l'URL (`?page=N`), jamais un état client volatile — décision
  Jérôme documentée dans `docs/specs/02-admin-accueil-et-navigation.md` §3/§8, conforme à G15
  (`docs/03-cahier-des-charges-admin.md` §6).
- Stack table cible : TanStack Table (headless) + `SimpleTable` pour toute table dense/interactive,
  jamais le `Table` compound HeroUI pour ce cas (`hifago/CLAUDE.md` §2.2, révisée 2026-08-14).
  Cette spec généralise cette règle : après elle, plus aucun écran d'`apps/admin` n'est dans le cas
  « affichage simple sans tri » qui justifiait le `Table` HeroUI — à noter dans l'architecture
  cible plutôt que laisser la phrase devenir fausse en silence (§10).
- Idiome RSC obligatoire (`hifago/CLAUDE.md` §2.3) : une page Server Component fetch et passe des
  données déjà sérialisées à un composant `"use client"` dédié qui seul manipule
  `items`/`renderEmptyState`/colonnes-fonctions — jamais l'inverse.

## 4. Parcours cible

1. Un admin/socio ouvre une page liste (ex. `/admin/products`). Elle occupe toute la largeur
   disponible, triée par défaut sur la colonne la plus pertinente (le plus souvent `created_at
   desc`, cf. §5 par liste).
2. Il change de page (`ServerPagination`), trie par une autre colonne (clic sur un en-tête,
   `?sort=&dir=`) ou filtre (formulaire de filtres, `?q=`/`?status=`/...) — l'URL change à chaque
   fois, jamais un état perdu au refresh ou en partageant le lien. Changer le tri ou un filtre
   revient systématiquement à la page 1.
3. Il clique sur une ligne (ou un bouton « Ver ») → arrive sur une page de détail dédiée à cet
   élément.
4. Sur cette page de détail, il dispose des actions réellement possibles pour cette entité :
   éditer, supprimer, changer de statut, résoudre, réviser — jamais un bouton pour une action qui
   n'a pas de RPC/route derrière.

**Ordre de migration** (aucun écran ne change avant le lot 0) :

| Lot | Contenu | Pourquoi ce rang |
|---|---|---|
| 0 | Helpers `packages/domain` + `DataList`/`ServerFilters` + tests Vitest | Fondations, aucun écran ne change encore — fonctions pures, palier de test le plus léger |
| 1 | Pilote A `/admin/orders` | Déjà sur TanStack+SimpleTable — prouve tri serveur, filtre select, plage de dates, sans changer de socle |
| 2 | Pilote B `/admin/products` | Le plus simple, 1er vrai passage HeroUI `Table` compound → `DataList`, triptyque complet déjà en place |
| 3 | Pleine largeur (2 layouts + 4 sous-layouts morts) | Après les 2 pilotes, pour juger l'impact visuel sur de vraies listes standardisées — capture d'écran obligatoire |
| 4 | Reste admin sans backend neuf : campaigns, establishments, invitations, partners, tags | Répétition mécanique du pattern des pilotes |
| 5 | 6 fiches détail nouvelles | Indépendantes du composant, parallélisables |
| 6 | Backend (3 RPC + index) → clients, proposals + leur fiche | Seules listes bloquées par une migration — peut démarrer en parallèle du lot 0 |
| 7 | `/admin/reconciliation` (cartes → table) | Conversion de forme la plus lourde, après rodage sur les pilotes |
| 8 | Socio : commissions (dernier — seul vrai risque de régression sur les 3 totaux), products, establishment | |

## 5. Écran(s)

### 5.1 Composant réutilisable — `DataList`

**Fichiers** : `packages/ui/src/components/data-list.tsx` (`DataList`, `"use client"`),
`packages/ui/src/components/server-filters.tsx` (`ServerFilters`, réutilisable seul, form GET).
Noms libres — vérifiés non pris par `packages/ui/src/index.ts` (`export * from "@heroui/react"`,
qui réserve déjà `Table`/`Pagination`/`SearchField`/`Toolbar`/`EmptyState`).

**Comportement** :
- TanStack Table v9 en mode `manualSorting: true` / `manualPagination: true` / `rowCount:
  totalCount`, `state.sorting` dérivé de la prop `sort`. Ni `sortedRowModel` ni
  `paginatedRowModel` enregistrés — c'est ce qui garantit que rien ne réordonne/repagine la page
  déjà servie côté client. Rôle résiduel de TanStack : modèle de colonnes + `FlexRender`.
- En-têtes triables = liens `<a href="…?sort=<id>&dir=<asc|desc>&…">`, pas des boutons — même
  logique que `ServerPagination` (navigable sans JS, survit au refresh). Les filtres actifs sont
  conservés dans l'URL générée, `page` en est systématiquement absent. `data-testid={
  \`sort-${id}\`}` + indicateurs `↑`/`↓`, identiques à `OrdersTable.tsx` aujourd'hui.
- Filtres = un seul `<form method="GET" action={basePath}>` (idiome déjà en place sur
  campaigns/clients/products), avec un `<input type="hidden" name="sort">` + `dir` pour préserver
  le tri actif ; jamais de `page` dans ce formulaire.
- Clic ligne → détail : la 1ʳᵉ cellule rend un vrai `<a href={rowHref(row)}>` (lien réel, pas un
  `onClick` sur `<tr>` — préserve clavier, clic-milieu, copier-lien) avec un *stretched link*
  (`after:absolute after:inset-0`) pour que toute la ligne soit cliquable ; la colonne d'actions
  reste `relative z-10` par-dessus.
- Actions rendues en dernière colonne sans en-tête, `flex gap-2`, style bouton identique à
  l'existant (diff visuel nul hors largeur).
- État vide : une seule `<tr><td colSpan={n}>` centrée, `emptyMessage` + `emptyTestId` — jamais
  `renderEmptyState` de HeroUI (render-prop, non sérialisable à travers la frontière RSC,
  `hifago/CLAUDE.md` §2.3).
- Pagination : `ServerPagination` réutilisé tel quel, `extraParams` = tri + filtres actifs
  (corrige au passage un bug latent : `establishments`/`invitations`/`partners` ne passent
  aujourd'hui aucun `extraParams`, perdant tout filtre en changeant de page).
- Rendu `w-full` ; `SimpleTable` apporte déjà `overflow-x-auto`, donc une liste large reste
  utilisable sur mobile sans travail supplémentaire.

**Frontière RSC** : `DataListColumn.cell` et `DataListAction.href`/`render` sont des fonctions —
non sérialisables Server→Client. Chaque liste a donc exactement deux fichiers : `page.tsx` (Server
— auth, fetch, `resolveListParams`, lignes déjà sérialisées) et `<Entity>List.tsx` (`"use client"`
— colonnes, actions, `<DataList/>`). Idiome déjà pratiqué par `OrdersTable.tsx`,
`PartnersTable.tsx`, `CommissionsTable.tsx`, `ProposalsTable.tsx`, `ProductsTable.tsx` (socio).

**Types** (contrat exact, à reprendre tel quel en code) :

```ts
export type DataListColumn<Row> = {
  id: string;                             // = clé d'URL ?sort= ET id TanStack — jamais l'expression SQL
  header: string;
  cell?: (row: Row) => React.ReactNode;   // défaut : String(row[id])
  sortable?: boolean;                     // défaut false ; true ⇒ id DOIT être dans la whitelist serveur
  align?: "left" | "right";
  className?: string;
};

export type DataListAction<Row> = {
  id: string;
  label: string;                          // "Ver" | "Editar" | "Eliminar" | "Revisar" | "Resolver" | …
  href?: (row: Row) => string;
  render?: (row: Row) => React.ReactNode; // action à état (dialog) fournie par le composant client de la page
  isVisible?: (row: Row) => boolean;
  variant?: "outline" | "danger";
  testId: (row: Row) => string;           // obligatoire — préserve les testids e2e existants
};

export type DataListFilter =
  | { kind: "text"; name: string; label: string; placeholder?: string }
  | { kind: "select"; name: string; label: string; allLabel: string; options: { value: string; label: string }[] }
  | { kind: "date"; name: string; label: string };

export type DataListProps<Row> = {
  rows: Row[];                             // déjà la page courante, déjà filtrée/triée par le serveur
  getRowId: (row: Row) => string;
  columns: DataListColumn<Row>[];
  actions?: DataListAction<Row>[];
  rowHref?: (row: Row) => string;
  basePath: string;
  page: number; pageSize: number; totalCount: number;
  sort: { key: string; direction: "asc" | "desc" };
  filters?: DataListFilter[];
  filterValues?: Record<string, string>;
  extraParams: Record<string, string>;     // sort+dir+filtres actifs — jamais page
  ariaLabel: string;
  rowTestIdPrefix: string;                 // ⇒ data-testid={`${prefix}-row-${id}`}
  emptyMessage: string;
  emptyTestId?: string;
  toolbar?: React.ReactNode;               // bouton "Nuevo …", bloc de totaux, bannière
};
```

### 5.2 Convention d'URL

| Param | État actuel | Rôle dans cette spec |
|---|---|---|
| `page` | déjà en place (`resolvePageParams`) | inchangé |
| `sort` | **inexistant partout, créé ici** | clé de colonne, jamais une expression SQL |
| `dir` | **inexistant partout, créé ici** | `asc` \| `desc` |
| `q` | existant sur 3 listes | généralisé partout où une recherche texte fait sens |
| `status` / `email` | existants (orders / clients) | généralisés |
| `type`, `entity`, `kind`, `sellable`, `path`, `city`, `date_from`, `date_to`, `operated_directly` | nouveaux | filtres fermés, par liste (cf. §5.3) |

Règle commune : tout changement de tri ou de filtre retire `page` (retour page 1) ; `sort`/`dir`
et les filtres actifs survivent à la pagination.

### 5.3 Les 13 listes

Pour chaque liste : colonnes conservées (inchangées, sauf mention contraire), tri (options +
défaut proposé), filtres proposés, actions de ligne, route de détail.

#### Admin

**`/admin/campaigns`** — Audiencia · Canal · Estado · Progreso · Creada · actions.
Tri : `created_at` **desc (défaut, déjà le cas)**, `audience`, `channel`, `status`. `Progreso` non
triable (agrégat JS d'une 2ᵉ requête). Filtres : `q` (existant) · `status` ∈ {draft, sending,
completed} · `audience` ∈ {clients, referrers, providers, partners, all} · `channel` ∈ {whatsapp,
email} (valeurs = `check` réels de la migration campagnes). Actions : **Ver** →
`/admin/campaigns/[id]` (existant). Pas d'Editar/Eliminar — aucune RPC `update_campaign`/
`delete_campaign`.

**`/admin/clients`** — Nombre · Email · Teléfono · Pedidos · Último pedido. Tri : `last_order_at`
**desc (défaut, déjà l'ordre interne de la RPC)**, `display_name`, `email`, `orders_count` — RPC
`list_clients` étendue (§7). Filtres : `q` + `email` (existants, inchangés) — aucune autre colonne
disponible (`client_key` est un `coalesce()`, pas une entité avec plus de champs). Actions : **Ver**
→ `/admin/clients/[key]` (nouvelle fiche). Pas d'Editar/Eliminar — exception assumée, ce n'est pas
une entité, `orders`/`order_lines` sont RPC-only.

**`/admin/establishments`** — Nombre · Partner · Estado · Actividades · actions. Tri : `created_at`
**desc (défaut, déjà le cas)**, `name`→`name->>es`, `status`, `updated_at`. `Partner` non triable
(ressource embarquée). Filtres : `q` (nouveau, `ilike name->>es`) · `status` ∈ {active, archived} ·
`operated_directly` ∈ {true, false}. Actions : **Ver/Editar** → `/admin/establishments/[id]`
(existant, fiche + bloc d'édition inline) · « + Actividad » · « Recurso compartido » (conservés).
Pas d'Eliminar — aucune RPC de suppression/archivage.

**`/admin/invitations`** — Código · Tipo · Estado · Creada · Expira · Consumida · actions. Tri :
`created_at` **desc (défaut, déjà le cas)**, `expires_at`, `consumed_at`, `status`, `promo_code`,
`onboarding_path`. Filtres : `status` ∈ {pending, consumed, revoked, expired} · `path` ∈ {referrer,
provider} · `q` (`ilike promo_code`). Actions : **Ver** → `/admin/invitations/[id]` (nouvelle
fiche) · **Revocar** (`RevokeInvitationButton`, conservé, `isVisible: status==='pending'`) · lien
conditionnel « Falta establecimiento » (conservé).

**`/admin/orders`** *(pilote)* — Fecha · Producto · Establecimiento · Cantidad · Estado · Titular ·
Referente · Monto · actions. Tri serveur : `date`, `created_at`, `qty`, `status`, `total_cop`.
Producto/Establecimiento/Titular/Referente non triables (embarqués). Défaut proposé : `created_at
desc` (au lieu de `date asc` actuel, « prochaines échéances en premier ») — conforme à la règle
générale demandée, ancien tri `date asc` toujours accessible en un clic + nouveau filtre
`date_from`/`date_to` qui couvre l'usage préparation ; **à confirmer en relecture** (§10, c'est un
écran opérationnel qui fonctionne aujourd'hui). Filtres : `status` (existant, 6 valeurs) ·
`date_from`/`date_to` (nouveau, sur `order_lines.date`) · `q` sur le titulaire (nouveau, jointure
`orders!inner` + `ilike`). Actions : **Ver pedido** → `/admin/orders/[id]` (existant) · **Cambiar
estado** (`ChangeStatusDialog`, conservé). Clic ligne → `/admin/orders/[id]`.

**`/admin/partners`** — Nombre · Estado · Capacidades activas · Establecimientos · actions. Tri :
défaut proposé `created_at desc` (au lieu de `display_name` alphabétique actuel — changement à
confirmer, §10), plus `display_name`, `status`, `entity_type`, `partner_city`, `updated_at`.
Filtres : `q` (`display_name` ou `email`) · `status` ∈ {active, suspended, archived} ·
`entity_type` ∈ {person, organization} · `role` ∈ {referrer, operator, admin} (via
`partner_capabilities!inner`) · `city`. Actions : **Ver** → `/admin/partners/[id]` (existant) ·
**Offboarding** → `/admin/partners/[id]/offboarding` (existant). Pas d'Editar — aucune RPC
`update_partner`.

**`/admin/products`** *(pilote)* — Nombre · Establecimiento · Tipo · Precio · Estado · actions.
Tri : `created_at` **desc (défaut, déjà le cas)**, `name`→`name->>es`, `price_cop`, `type`,
`updated_at`. Establecimiento non triable (embarqué). Filtres : `q` (existant) · `type` ∈ {lodging,
activity, transport, tour, camp, evento} · `sellable` ∈ {true, false}. Actions : **Ver** →
`/admin/products/[id]` · **Editar** → `/admin/products/[id]/edit` · **Eliminar**
(`DeleteProductButton`, RPC `delete_product`, remontée de la fiche vers la ligne) — toutes déjà
existantes, triptyque complet, liste de référence pour les autres.

**`/admin/proposals`** — Actividad/Establecimiento · Tipo · Partner · Enviada · actions. Pagination
et tri serveur nécessitent la nouvelle RPC `list_proposals` (§7 — union de 2 tables impossible en
pagination PostgREST directe). Tri : défaut proposé `created_at desc` (au lieu de `asc` actuel —
changement à confirmer, §10), plus `kind`, `status`, `entity_type`, `partner_name`,
`display_name`. Filtres : `status` ∈ {pending, approved, rejected, withdrawn}, **valeur par défaut
`pending`** (préserve le comportement actuel tout en le rendant visible/modifiable — aujourd'hui
codé en dur, invisible) · `entity` ∈ {product, establishment} · `kind` ∈ {content, photos, create,
edit}. Actions : **Revisar** → `/admin/proposals/[id]` (+`?entity=establishment`, existant). Clic
ligne = Revisar. Pas d'Editar/Eliminar (modération).

**`/admin/reconciliation`** — conversion cartes → table, la plus structurante de cette spec.
Colonnes : Titular *(lien commande)* · Establecimiento · Estado · Intentos · **Creada** (ajoutée —
seul nouveau champ de toute la spec, nécessaire pour rendre visible la clé du tri par défaut). Tri
: défaut proposé `created_at desc` (au lieu de `asc` actuel — changement à confirmer, §10), plus
`attempts`, `status`, `last_attempt_at`. Filtres : `status` **remplace le split visuel actuel en 2
sections** ("Por resolver"/"Fallo permanente"), valeur par défaut `pendientes` (= `.in("status",
["open","retrying"])`, préserve le comportement actuel) ; options : Pendientes (défaut) · Abierta ·
Reintentando · Fallo permanente · Resuelta · Todas. Actions : **Resolver** (`ResolveEntryDialog`,
`isVisible: status ∈ {open, retrying}`) · **Ver pedido** → `/admin/orders/[orderId]`. Détail à
créer : `/admin/reconciliation/[id]` (sinon seule liste sans page dédiée parmi celles converties).
⚠ `ResolveEntryDialog` passe de mutation d'état local (`setRows`) à `router.refresh()` — nécessaire
dès qu'un filtre serveur est actif (une ligne résolue doit pouvoir sortir du filtre "pendientes").

**`/admin/tags`** — Etiqueta · Actividades · **Creada** (ajoutée, même raison que reconciliation) ·
actions. Tri : défaut proposé `created_at desc` (au lieu de `slug` alphabétique actuel — changement
à confirmer, §10), plus `slug`, `label`→`label->>es`. `Actividades` non triable (agrégat embarqué).
Filtres : `q` (`ilike label->>es` ou `.or()` avec `slug`). Pagination activée (pageSize 20) — annule
le choix « volume en dizaines, pas de pagination » documenté dans le code, au nom de l'uniformité
demandée ; à confirmer (§10), impact nul si le volume reste faible (« Página 1 de 1 »). Actions :
**Ver** → `/admin/tags/[id]` (nouvelle fiche) · **Editar** (`RenameTagButton`, modal, conservé) ·
**Eliminar** (`DeleteTagButton`, conservé) — triptyque complet.

#### Socio

**`/partner/commissions`** — Fecha · Producto · Monto total · Comisión referente · Estado. Tri
serveur : `date` **desc (défaut, déjà le cas côté client aujourd'hui, devient serveur)**,
`created_at`, `total_cop`, `referrer_commission_cop`, `status`. ⚠ `Estado` devient **non triable** —
c'est une valeur *dérivée* en JS par `deriveLedgerEntry(...)`, pas une colonne ; régression
assumée à documenter (triable côté client aujourd'hui). Filtres : `date_from`/`date_to` · `status`
(colonne réelle). Pas de filtre sur l'état dérivé — reproduire `deriveLedgerEntry` en SQL
dupliquerait la logique métier hors de sa source unique (point ouvert, §10). ⚠⚠ Point technique à
trancher : les 3 totaux affichés (estimé/gagné/réattribué) sont calculés aujourd'hui sur *toutes*
les lignes chargées ; avec une pagination serveur, ils ne couvriraient plus que la page courante —
faux silencieusement si rien n'est fait. Correctif proposé : une 2ᵉ requête non paginée, bornée aux
colonnes nécessaires à `deriveLedgerEntry`, avec les mêmes filtres, passée en prop `toolbar` de
`DataList` — garde `deriveLedgerEntry` comme source unique plutôt que de la dupliquer en SQL.
Actions/détail : aucun — même exception assumée que `/admin/clients` (la ligne montre déjà tout ce
que la RLS autorise le référent à voir).

**`/partner/products`** — Nombre · Precio · Categoría · Estado · actions. Tri : `created_at`
**desc (défaut, déjà le cas)**, `name`→`name->>es`, `price_cop`, `type`. Filtres : `q` · `sellable`
∈ {true, false}. Actions : **Ver** → `/partner/products/[id]` (nouvelle fiche) · **Proponer
edición** → `/partner/products/[id]/edit` (existant) · **Calendario** → `.../availability`
(existant).

**`/partner/establishment`** — liste de `Card` aujourd'hui (généralement 1 item, structurellement
plusieurs possibles) → convertie en table pour l'uniformité. Nombre · Estado (chip, non triable —
vient d'une 2ᵉ requête `establishment_proposals`) · actions. Tri : défaut proposé `created_at desc`
(au lieu de `asc` actuel — quasi théorique vu le volume, gardé pour l'uniformité), `name`→
`name->>es`. Pas de filtre — exception assumée, volume structurellement 1-3 (§10). Actions : **Ver**
→ `/partner/establishment/[id]` (nouvelle fiche) · **Editar** → `.../[id]/edit` (existant).
`PendingCreationBanner` reste au-dessus, passé en prop `toolbar`.

### 5.4 Fiches détail à créer — contenu minimal

Cadré par la consigne de Jérôme (« les champs restent tels quels, il faut juste les boutons et
pouvoir cliquer pour voir le détail ») : rendre la fiche accessible, pas refondre son contenu.

| Route | Contenu | Source | Actions |
|---|---|---|---|
| `/admin/clients/[key]` | Identité (nom, email, tél, nb pedidos, dernier pedido) + liste des commandes du client, liens vers `/admin/orders/[id]` | RPC `get_client` (nouvelle) | aucune |
| `/admin/invitations/[id]` | Colonnes de la liste + `partner_hint`, `created_by`, partenaire résolu (lien), alerte "Falta establecimiento" | `partner_invitations` (RLS admin déjà en place) | `RevokeInvitationButton` si `pending` |
| `/admin/tags/[id]` | `label`, `slug`, `created_at`, activités portant le tag (liens) | `catalog_tags` + `product_tag_assignments` | Renombrar, Eliminar (composants existants) |
| `/admin/reconciliation/[id]` | Entrée + ligne de commande liée, `attempts`, `last_attempt_at`, `resolution_note`, `resolved_by/at`, lien commande | `pms_reconciliation_entries` | `ResolveEntryDialog` si `open`/`retrying` |
| `/partner/products/[id]` | Fiche lecture seule (nom, prix, catégorie, tags, photos, statut) | `products` (RLS `products_select_own`) | Proponer edición, Calendario |
| `/partner/establishment/[id]` | Fiche lecture seule (nom, adresse, description, photos, statut) | `establishments` (RLS `establishments_select`) | Editar |

Note transverse : `AdminSidebar`/`PartnerNav` calculent déjà `isActive()` par
`pathname.startsWith(href + "/")` — rien à ajouter pour les nouvelles routes.

### 5.5 Pleine largeur

`apps/admin/app/admin/layout.tsx:39` (`max-w-5xl`) et `apps/admin/app/partner/(app)/layout.tsx:29`
(`max-w-3xl`) perdent leur `max-w-*`, en gardant `mx-auto w-full flex-1 flex-col gap-6 p-8`. Les 4
sous-layouts socio (`commissions`, `products`, `establishment`, `tools`) posent aujourd'hui une
largeur *plus grande* que leur parent (donc déjà sans effet réel — `max-w-5xl`/`max-w-4xl` imbriqué
dans un `max-w-3xl` parent) et doublent le `p-8` : le wrapper de largeur est retiré, seule la garde
d'authentification est conservée. Aucun risque sur les formulaires : ils portent déjà leur propre
largeur locale (`max-w-md`/`max-w-2xl`, vérifié sur `NewProductForm.tsx`, `EditProductForm.tsx`,
`NewEstablishmentForm.tsx`, `EstablishmentEditBlock.tsx`, `NewPartnerForm.tsx`,
`NewCampaignForm.tsx`, `NewInvitationForm.tsx`, les `Moderate*Form.tsx`, `EditProposalForm.tsx`,
`EditEstablishmentProposalForm.tsx`) — retirer la contrainte de layout n'élargit donc que les pages
liste et les en-têtes de page détail, jamais les formulaires eux-mêmes. Critère de fin : capture
d'écran Playwright de chaque écran migré avant de le déclarer terminé (leçon du 2026-08-15).

## 6. Modèle de données

Résumé exhaustif déjà en §0 — rien à ajouter ici : aucune table, aucune colonne, aucune policy RLS
touchée. Seule addition : la migration d'index listée en §0, justifiée par le fait que cette spec
transforme `created_at` (et `order_lines.date`/`status`) en colonne de tri par défaut sur ~13
écrans simultanément, alors qu'aucune n'est indexée aujourd'hui (vérifié par grep sur toutes les
migrations).

## 7. Contrat API/RPC

**`list_clients`** (modification) — ajoute `p_sort text default 'last_order_at'` et
`p_sort_direction text default 'desc'`. Re-validation interne contre une whitelist codée en dur
(`display_name`, `email`, `orders_count`, `last_order_at`) : une valeur hors liste ⇒ repli sur
`last_order_at`/`desc`, jamais une erreur. Tri par chaîne de `CASE ... END`, jamais `EXECUTE
format(...)` — pas de SQL dynamique à auditer :
```sql
order by
  case when p_sort = 'last_order_at' and p_sort_direction = 'desc' then a.last_order_at end desc nulls last,
  case when p_sort = 'last_order_at' and p_sort_direction = 'asc'  then a.last_order_at end asc  nulls last,
  case when p_sort = 'display_name'  and p_sort_direction = 'asc'  then a.display_name  end asc,
  -- … une paire de branches par (colonne, direction) de la whitelist
```
Verbeux mais auditable ; alternative `EXECUTE format` + `quote_ident` écartée (§10).

**`get_client(p_client_key text) → jsonb`** (nouvelle) — reproduit la logique de `coalesce()` de
`list_clients` pour retrouver l'identité + agrège les commandes du même `client_key`. Nécessaire
car `client_key` n'est pas une colonne réelle, juste un identifiant calculé — pas de `.select()`
PostgREST possible sur cette clé.

**`list_proposals(p_status, p_entity, p_kind, p_partner_id, p_search, p_sort, p_sort_direction,
p_limit, p_offset)`** (nouvelle) — union normalisée de `product_proposals` et
`establishment_proposals`, `total_count` via `count(*) over()` (précédent exact : `list_clients`).
Alternative *vue SQL* écartée : aucune vue n'existe dans ce projet aujourd'hui (grep confirmé sur
toutes les migrations) — introduire ce pattern (RLS via `security_invoker`) sans nécessité aurait
été un écart d'architecture non justifié pour cette spec seule (§10).

**Squelette de sécurité, identique pour les 3** : `security definer`, `set search_path = ''`,
garde interne `if not is_admin(auth.uid()) then raise exception ...`, puis `grant execute on
function ... to authenticated;` explicite (jamais accordé par défaut — piège déjà documenté
`hifago/CLAUDE.md` §11.1). Ce n'est **pas** le squelette anti-survente
(`hifago/docs/05-reference-technique.md` §1/§1bis) : aucune de ces 3 fonctions ne touche un
compteur de capacité, ne verrouille une ligne, ni n'a besoin d'un test de concurrence dédié.

## 8. Règles et invariants

Reprise justifiée des invariants secs de §0 :

- **La clé de tri n'est jamais l'expression SQL.** `?sort=name` → `.order("name->>es")`, jamais
  `.order(searchParams.get("sort"))`. Ça évite de faire transiter une expression à caractères
  spéciaux dans une URL, et surtout garantit qu'aucune chaîne venue du client n'atteint
  `.order()`/`ORDER BY` : seule une valeur d'un dictionnaire codé en dur y arrive. C'est
  l'invariant de sécurité central de cette spec — sans lui, un `?sort=` arbitraire serait une
  primitive d'injection SQL potentielle sur toute liste utilisant `.order()` dynamiquement.
- **Un filtre à choix fermé hors liste est ignoré, jamais transmis.** Même logique, appliquée aux
  valeurs de `.eq()`/`.in()` plutôt qu'à `.order()`.
- **Repli silencieux, jamais une erreur, sur une entrée `sort`/`dir`/`page` malformée** — cohérent
  avec la posture déjà choisie par `resolvePageParams` (« la liste reste utilisable plutôt que de
  renvoyer une erreur sur un lien mal formé »).
- **Toute colonne triable doit être une vraie colonne (ou expression) de la requête source**,
  jamais une valeur calculée côté JS après coup (agrégat, jointure imbriquée, valeur dérivée) —
  un tri serveur ne peut structurellement pas la produire. D'où les colonnes explicitement
  marquées non triables par liste en §5.3.
- **Pagination et tri sont toujours servis ensemble** : une liste qui pagine côté serveur mais
  trie côté client n'a de sens que sur une seule page à la fois — incohérent avec l'objectif de
  cette spec (tri sur l'ensemble des résultats, pas juste la page affichée). D'où la conversion
  systématique vers `manualSorting`.

## 9. Cas limites

Repris et justifiés depuis §0 : la page au-delà du dernier résultat reste affichable (comportement
`resolvePageParams` déjà éprouvé, pas une nouveauté) ; un `sort`/`status`/`dir` invalide ne casse
jamais la page, il replie sur le défaut documenté par liste (§5.3) ; un filtre texte vidé ne doit
jamais transmettre une chaîne vide à `.ilike()` (sinon un comportement différent d'un filtre
"absent" pourrait apparaître selon le driver) ; la clé composite `client_key` doit être encodée
dans l'URL de la fiche client (elle peut contenir `@`/`.`/`+`) ; toute mutation déclenchée depuis
une ligne de liste sous filtre actif (résolution d'une entrée de réconciliation, changement de
statut d'une commande) doit rafraîchir depuis le serveur plutôt que muter un état local — sinon
une ligne qui ne correspond plus au filtre actif resterait affichée à tort jusqu'au prochain
rechargement complet.

## 10. Décisions tranchées / points ouverts

Écrites comme des propositions justifiées (pas des blocages) — cette spec reste `brouillon`
jusqu'à relecture de Jérôme, qui peut trancher différemment sans repartir de zéro.

1. **Numérotation** : `10` pris pour cette spec, `09` déjà pris par `09-design-system-admin.md`
   (session concurrente). Les 3 renvois de la spec 08 vers « spec 09 » (créneaux horaires)
   corrigés dans le même lot vers une formulation neutre.
2. **5 défauts de tri qui changent sur des écrans qui fonctionnent aujourd'hui** — `/admin/orders`
   (`date asc` → `created_at desc`), `/admin/partners` (`display_name asc` → `created_at desc`),
   `/admin/proposals` (`asc` → `desc`), `/admin/reconciliation` (`asc` → `desc`), `/admin/tags`
   (`slug asc` → `created_at desc`). **Proposé** : appliquer partout, conforme à la règle générale
   demandée (« de base triées par plus récentes ») ; l'ancien tri reste accessible en un clic, non
   supprimé — risque de rupture d'habitude jugé faible vu la mitigation. **À confirmer par
   Jérôme en relecture**, en particulier pour `/admin/orders` (usage opérationnel quotidien).
3. **Réconciliation** : `status` avec défaut `pendientes` remplace le split visuel fixe en 2
   sections. **Proposé** : oui — un filtre est plus flexible qu'un split figé (permet de voir
   "Resuelta"/"Todas" sans autre écran) tout en préservant exactement la vue par défaut actuelle.
4. **Commissions socio** : la pagination serveur casse les 3 totaux affichés si rien n'est fait.
   **Proposé** : 2ᵉ requête non paginée bornée aux colonnes nécessaires à `deriveLedgerEntry`
   (garde la fonction comme source unique) plutôt qu'une RPC d'agrégation SQL qui la dupliquerait.
5. **Deux listes sans fiche détail** (`/admin/clients`, `/partner/commissions`). **Proposé** :
   exception assumée — ce ne sont pas des entités, la ligne montre déjà tout ce qui est visible
   pour `/partner/commissions` ; `/admin/clients` gagne quand même une fiche minimale (§5.4) car
   elle agrège plusieurs commandes, contrairement à `/partner/commissions`.
6. **`list_proposals`** : RPC (précédent `list_clients`) **proposée** plutôt qu'une vue SQL — aucune
   vue n'existe dans le projet aujourd'hui, introduire ce pattern uniquement pour cette spec aurait
   été un écart d'architecture non nécessaire.
7. **Tri dynamique en plpgsql** : chaîne de `CASE` **proposée** plutôt que `EXECUTE format` +
   `quote_ident` — zéro SQL dynamique à auditer, verbosité acceptée en échange.
8. **Migration d'index** : incluse dans cette spec (§0/§6) plutôt que différée — c'est cette spec
   qui rend `created_at` chaud sur ~13 écrans simultanément, la corrélation est directe.
9. **Pleine largeur** : `max-w-*` **totalement retiré** (pas de garde-fou `max-w-[1600px]`) —
   conforme à la demande explicite de Jérôme (« doit prendre toute la page »). Les pages détail à
   prose longue seront jugées par capture d'écran une fois la contrainte levée, pas par
   anticipation.
10. **Clic ligne** : *stretched link* sur la 1ʳᵉ cellule **proposé** plutôt qu'un lien simple + un
    bouton "Ver" séparé — accessibilité correcte (vrai `<a>`, pas un `onClick` sur `<tr>`) sans
    perdre la possibilité d'un clic direct sur une action de la même ligne.
11. **`pageSize`** : 20 uniforme **proposé** (aligné sur `resolvePageParams`) — fait passer
    `/partner/commissions` de 10 à 20 ; jugé sans impact (juste plus de lignes par page).
12. **`/admin/tags`** : activer la pagination **proposé** malgré le choix documenté "volume en
    dizaines, pas de pagination" — cohérence avec la règle "pagination partout" demandée,
    impact nul si le volume reste petit (« Página 1 de 1 »).
13. **`/partner/establishment`** : pas de barre de filtres — **exception assumée**, volume
    structurellement 1-3 par socio.
14. **Actions impossibles faute de RPC existante** — pas d'Editar sur `/admin/partners` (aucune
    `update_partner`), pas de suppression/archivage d'établissement, pas de suppression
    d'invitation au-delà de la révocation, pas de suppression de campagne. **Hors périmètre** de
    cette spec par consigne de Jérôme (« boutons spécifiques selon ce qui est possible ») — le
    triptyque Ver/Editar/Eliminar est documenté comme une règle avec exceptions énumérées, pas un
    absolu à combler ici.
15. **`hifago/CLAUDE.md` §2.2 / `docs/04-architecture-cible.md`** disent que le `Table` compound
    HeroUI « reste utilisé pour les tables d'affichage simple ». Après cette spec, aucun écran
    d'`apps/admin` n'est plus dans ce cas. **Proposé** : ajouter une note datée dans l'architecture
    cible plutôt que laisser la phrase devenir fausse en silence — à faire dans le même commit que
    l'implémentation, pas dans cette spec elle-même.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers source vérifiés |
|---|---|
| §0/§5.1 Composant réutilisable | `packages/ui/src/components/pagination.tsx`, `packages/ui/src/components/simple-table.tsx`, `packages/ui/src/index.ts`, `apps/admin/app/admin/orders/OrdersTable.tsx`, `apps/admin/package.json` (TanStack Table v9.1.2) |
| §0/§7 Helpers pagination existants | `packages/domain/src/pagination/resolvePageParams.ts`, `packages/domain/src/index.ts` |
| §5.2 Convention d'URL | grep sur `apps/admin/app/admin/**/page.tsx` et `**/*.tsx` (`searchParams`) — aucune occurrence de `sort=`/`dir=` |
| §5.3 Les 13 listes | `apps/admin/app/admin/{campaigns,clients,establishments,invitations,orders,partners,products,proposals,reconciliation,tags}/page.tsx`, `apps/admin/app/partner/(app)/{commissions,products,establishment}/page.tsx` + composants clients associés |
| §5.5 Pleine largeur | `apps/admin/app/admin/layout.tsx:39`, `apps/admin/app/partner/(app)/layout.tsx:29`, les 4 sous-layouts socio, formulaires listés (`NewProductForm.tsx`, `EditProductForm.tsx`, etc.) |
| §7 RPC existante à étendre | `supabase/migrations/20260815100000_list_clients_rpc.sql` |
| §6 Index manquants | grep `create index` sur toutes les migrations de `supabase/migrations/` |
| §1 Déclencheur | `hifago/docs/journal/2026-08.md` (dernière entrée, correctifs UX 2026-08-15) |

## 12. Documents liés

- [`docs/specs/_modele.md`](_modele.md) — gabarit suivi par ce document.
- [`docs/specs/avant-la-spec.md`](avant-la-spec.md) — checklist de clarification suivie avant
  rédaction (périmètre, files d'opération, Refine.dev tranchés avec Jérôme avant d'écrire).
- [`docs/specs/02-admin-accueil-et-navigation.md`](02-admin-accueil-et-navigation.md) — pose
  `ServerPagination`/`resolvePageParams` et la décision « pagination serveur partout » (G15),
  réutilisés et complétés ici.
- [`docs/specs/08-admin-gestion-activite.md`](08-admin-gestion-activite.md) — triptyque
  Ver/Editar/Eliminar constaté empiriquement (correctifs 2026-08-15), déclencheur direct de cette
  spec ; renvois vers « spec 09 » corrigés dans le même lot que la création de ce document.
- `hifago/docs/04-architecture-cible.md` — choix TanStack Table + `SimpleTable` pour les tables
  denses (§ stack UI), Refine.dev prescrit mais jamais utilisé.
- `hifago/docs/03-cahier-des-charges-admin.md` §6 — G15 (pagination serveur, décision 2026-08-11).
- `hifago/docs/05-reference-technique.md` — squelette RPC de référence (non anti-survente ici).
- `hifago/CLAUDE.md` §2.2, §2.3, §11.1 — stack composants, idiome RSC, piège `grant execute`.
