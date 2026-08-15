---
id: specs-admin-accueil-et-navigation
titre: "Admin : sidebar de navigation et page d'accueil"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-15
resume: >
  Spec de la sidebar de navigation persistante et de la page d'accueil admin (vue d'ensemble,
  KPIs, graphiques, alertes) pour le nouveau stack Hifago — aujourd'hui /admin ne fait qu'une
  redirection vide et aucun écran n'est joignable sans connaître son URL.
mots_cles: [admin, sidebar, navigation, dashboard, KPI, graphiques, pagination, clients, hifago]
repond_a:
  - "Comment un admin navigue-t-il entre les écrans du back-office hifago ?"
  - "Que doit montrer la page d'accueil admin ?"
  - "Comment paginer les listes admin côté serveur ?"
---

# Admin : sidebar de navigation et page d'accueil

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`), pas l'app legacy. **Feature n°27**
> (dernière feature migrée côté hifago avant celle-ci : 26, création directe d'un partenaire,
> `docs/specs/01-admin-creation-partenaire.md`) — numéro de build, distinct du `02-` de ce fichier
> qui est un compteur de docs.
>
> **Implémenté le 2026-08-15**, dans la foulée de la spec, sans repasser par une approbation
> intermédiaire séparée (même méthode que la feature 26) — sidebar, page d'accueil, RPC
> `list_clients`, 3 écrans manquants, retrofit pagination et tests e2e livrés d'un seul tenant.
> Fichiers réels en annexe §11.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écrans | implémenté |
| 6 | Modèle de données | implémenté |
| 7 | Contrat RPC | implémenté |
| 8 | Règles et invariants | implémenté |
| 9 | Cas limites | implémenté |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 1. Contexte et problème

**Aujourd'hui, `/admin` (hifago) ne fait qu'une redirection vide** vers `/admin/establishments`
(`apps/admin/app/admin/page.tsx`) — aucune page d'accueil, aucun contenu. Et **aucune
sidebar/nav n'existe nulle part** dans `apps/admin` (`apps/admin/app/admin/layout.tsx` n'est
qu'une garde d'authentification, pas un shell de navigation). Conséquence vérifiée : plusieurs
écrans déjà codés — `/admin/partners`, `/admin/orders`, `/admin/proposals`, `/admin/campaigns/new`,
`/admin/invitations/new` — sont **injoignables sans taper l'URL à la main**.

Le cahier des charges admin (`hifago/docs/03-cahier-des-charges-admin.md` §2, validé par Jérôme le
2026-08-11) a déjà tranché qu'une vue d'ensemble est *« le point d'entrée quotidien »* : volumes,
commissions générées/dues/payées, réservations récentes, suivi PMS et exceptions. Une décision du
même jour ajoute des **graphiques d'évolution** (ventes, commissions, performance par
partenaire/établissement, santé du catalogue) — principe acté, indicateurs précis explicitement
laissés *« à trancher au chiffrage »*. Rien de tout cela n'a jamais été construit côté hifago.

**Vérifié en direct sur la vraie prod legacy (`hifago.co/admin`, lecture seule, 2026-08-15)** :
aucune dérive entre le code du repo et la prod — mêmes 3 KPIs (Revenus Générés, Commissions à
Payer + taux, Hostels Partenaires), mêmes 10 onglets (Résumé, Partenaires·Registre,
Partenaires·Prospection, Prestataires, Clients, Messages, Catalogue, Camps, Événements,
Commandes), même groupement Pilotage·Réseau·Vente. Deux nuances utiles trouvées à l'écran, pas
dans le code :
- La table **« Détail par Hostel »** du legacy est un vrai mini-ledger (Montant Dû, Statut
  « 0/1 »/« PAYÉ »/« 1/2 », justificatifs de paiement par réservation) — confirme que ce chantier
  mérite sa propre spec (constat 1 ci-dessous), et donne la référence concrète à reproduire ce
  jour-là.
- Chaque table du legacy porte son propre **champ de recherche local** — pattern à reprendre pour
  les nouveaux écrans hifago.

### Deux constats qui recadrent le périmètre

1. **Aucun ledger n'existe côté hifago.** Aucune table `ledger_entries` (vérifié sur toutes les
   migrations, zéro résultat) — `order_lines` ne porte qu'un *snapshot de commission générée*
   (`referrer_commission_cop`, `app_commission_cop`), jamais un état dû/payé/versé. Le commentaire
   de `hifago/supabase/migrations/20260814170000_set_order_line_status_rpc.sql:13-16` le dit
   explicitement : *« le ledger n'existe pas encore »*. Le format d'export comptable est classé
   *« à trancher au chiffrage, jamais sans Jérôme »* (`hifago/CLAUDE.md` §10). → reporté à une
   spec dédiée séparée (§2, §10).
2. **Aucun champ nom/prénom séparé n'existe pour un client.** Ni `auth.users`, ni
   `partner_accounts` ne portent de nom — seuls `email`/`phone`. Le seul nom disponible est
   `orders.holder_name` (texte libre unique, `not null`), partagé par 8 migrations de RPC de
   commande. Et `auth.users` n'est pas exposé à PostgREST (accessible uniquement depuis une
   fonction `security definer`, comme le fait déjà `list_audience_members`,
   `hifago/supabase/migrations/20260814230000_campaign_engine.sql:36-40`).
3. **Le mécanisme « demande d'ouverture prestataire hors zone / liste d'attente »** décrit au
   cahier des charges socio (`hifago/docs/02-cahier-des-charges-socio.md:142-143`, « accordée
   immédiatement si la zone correspond, sinon liste d'attente ») **n'existe pas non plus côté
   hifago** — vérifié, aucune RPC/table de type `service_market_requests` ou équivalent
   (contrairement au legacy, qui l'a). L'alerte « demandes prestataire en attente » prévue par le
   cahier des charges §2 n'a donc pas de donnée réelle à afficher pour l'instant (§5.2, §10).

## 2. Portée

**In** : sidebar shell persistante (layout `/admin`), page d'accueil (`/admin`), `/admin/clients`
(liste seule), `/admin/campaigns` (liste — n'existe pas, seuls `new`/`[id]` existent),
`/admin/products` (liste + fiche simple `[id]` — n'existent pas, seuls `new`/`edit`/`availability`
existent), convention de pagination serveur + retrofit `/admin/orders` (actuellement pagination
client-only) et `/admin/partners`/`/admin/establishments` (actuellement sans pagination).

**Out, explicitement renvoyé ailleurs :**
- Fiche client détaillée (une seule liste ici, cf. décision §3) — future spec séparée.
- **Ledger dû/payé et export comptable** (constat 1) — future spec dédiée
  (candidate `docs/specs/03-admin-ledger-paiements.md`), qui reproduira la table « Détail par
  Hostel » du legacy comme référence.
- **Recherche globale** (cahier des charges §2) — le cahier des charges lui-même la conditionne à
  un volume de données pas encore atteint (seed synthétique, pas de vrai volume) ; mérite sa
  propre conception (quelles entités, `ilike` simple vs `pg_trgm`).
- Notifications temps réel/push — ce lot se limite à un chargement au moment où la page se charge,
  pas de polling ni de Realtime (Realtime n'est de toute façon jamais source de vérité pour rien
  de critique, `hifago/CLAUDE.md` §4.5).
- Carte + itinéraire CRM (§3e cahier des charges) — déjà hors périmètre connu.
- Le mécanisme « demande d'ouverture prestataire hors zone » lui-même (constat 3) — n'existe pas
  encore côté hifago, pas construit ici.

## 3. Décisions retenues

Ne pas rouvrir :
- **Structure à deux niveaux** (décision Jérôme, 2026-08-15) : une sidebar persistante à gauche
  porte les actions et les vues ; la page d'accueil est *« l'endroit pour retrouver les infos
  importantes et les actions »* — une vue d'ensemble, jamais une page qui duplique des tables
  complètes.
- **Pagination serveur partout, y compris rétro-corriger `/admin/orders`** (décision Jérôme) —
  conforme à la lacune **G15** déjà tranchée pour la cible : *« La liste des destinataires/contacts
  doit être paginée dès la cible, pas ajoutée quand elle deviendra visiblement lente »*
  (`hifago/docs/03-cahier-des-charges-admin.md` §6).
- **`/admin/clients` : liste seule** (décision Jérôme) — nom complet, email, téléphone, nombre de
  commandes, dernière commande ; triée ; un filtre texte combiné nom+email et un filtre séparé par
  email. La fiche détaillée (toutes les infos) est explicitement une spec future distincte.
- **Ledger reporté** (décision Jérôme, constat 1) — cette spec affiche des commissions
  **générées**, jamais un indicateur « à payer » inventé ou provisoire.
- Conséquence technique de la décision sidebar, pas un périmètre inventé : `/admin/campaigns`
  (liste) et `/admin/products` (liste + fiche simple) doivent être créés ici, sinon la sidebar
  pointerait vers des 404.

## 4. Parcours cible

1. L'admin se connecte → atterrit sur `/admin` (aujourd'hui : redirection vers
   `/admin/establishments` — devient le vrai contenu de cette spec).
2. La sidebar, présente sur tout `/admin/*`, permet d'atteindre n'importe quel écran en un clic —
   plus besoin de connaître une URL.
3. Sur l'accueil : lecture des KPIs/graphiques/alertes, clic sur un « voir tout » ou une entrée de
   sidebar pour approfondir.
4. Sur une liste (partners, establishments, orders, clients, campaigns, products) : la pagination
   est pilotée par l'URL (`?page=N`) — recharger la page, revenir en arrière ou partager le lien
   reproduit exactement la même page de résultats (jamais un état client volatile).

## 5. Écrans

### 5.1 Sidebar (`AdminSidebar.tsx`, nouveau)

| Entrée | Route | Statut |
|---|---|---|
| Accueil | `/admin` | Nouveau contenu, route déjà existante |
| Partenaires | `/admin/partners` | Existe déjà |
| Établissements | `/admin/establishments` | Existe déjà |
| Commandes | `/admin/orders` | Existe déjà (retrofit pagination, §10) |
| Clients | `/admin/clients` | **À créer** |
| Catalogue | `/admin/products` | **À créer** (liste) |
| Campagnes | `/admin/campaigns` | **À créer** (liste) |
| Propositions | `/admin/proposals` | Existe déjà |
| Réconciliation | `/admin/reconciliation` | Existe déjà |
| + Créer | menu → `partners/new`, `establishments/new`, `invitations/new` | Réutilise les boutons contextuels déjà existants sur chaque liste, ne duplique pas leur logique |

### 5.2 Page d'accueil (`/admin`)

**KPI cards** (reprennent/améliorent les 3 du legacy, `public/admin.js:208-234`) :
1. Revenus générés (global) — `sum(order_lines.total_cop)` sur lignes non annulées.
2. Commissions générées — `sum(referrer_commission_cop + app_commission_cop)` sur lignes
   `fulfilled`, + répartition par bénéficiaire (chips cliquables vers la fiche partenaire, comme
   en legacy). Libellé **« générées »**, jamais « à payer » (constat 1) — à écrire explicitement
   dans l'UI pour ne pas induire en erreur.
3. Établissements partenaires actifs — `count(establishments) where status='active'`.
4. Commandes en attente d'action — lignes `reserved` dont la date de service est passée (proxy
   simple d'« à traiter », pas un ledger).

**4 graphiques Recharts** (tranchent le « à trancher au chiffrage » du cahier des charges §2) :
1. Évolution des ventes (line chart, `order_lines.total_cop` par jour, fenêtre 30j/90j).
2. Commissions générées dans le temps (référent vs app, même fenêtre) — répond à « commissions
   générées/payées » du cahier des charges **pour la moitié générée seulement** (la moitié
   « payées » reste hors périmètre, constat 1 — à écrire noir sur blanc, pas glissé sous le tapis).
3. Top partenaires par volume (bar chart horizontal, top 5-10).
4. Santé du catalogue (publié `products.sellable=true` / brouillon `sellable=false` / en attente
   `product_proposals.status='pending'` / refusé `status='rejected'`) — calculable aujourd'hui
   sans nouvelle donnée.

**Alertes** (lecture seule, au chargement de page) :
- Propositions à modérer — `count(product_proposals) where status='pending'` → `/admin/proposals`.
- Exceptions de réconciliation — `count(pms_reconciliation_entries) where status in ('open','retrying')` → `/admin/reconciliation`.
- Capacités prestataire en attente de revue — `count(partner_capabilities) where role='operator' and status in ('onboarding','pending_review')` → `/admin/partners`. **Ce n'est pas** l'alerte « demande hors zone / liste d'attente » du cahier des charges (constat 3, mécanisme absent de hifago) — un signal plus générique, à nommer clairement comme tel dans l'UI.

**Aperçus « top-N + voir tout »** (triés `created_at desc`, limite 5, lien vers la liste complète) :
partenaires récents, établissements récents, clients récents.

### 5.3 `/admin/clients`

Liste paginée (RPC `list_clients`, §7) : Nom complet, Email, Téléphone, Nb commandes, Dernière
commande. Filtre texte (nom+email combinés) + filtre séparé par email. Champ de recherche local en
haut de tableau (pattern repris du legacy, §1).

### 5.4 `/admin/campaigns`

Liste paginée des campagnes existantes (même patron que `/admin/proposals`/`/admin/reconciliation`),
lien vers `campaigns/new` et `campaigns/[id]`. Champ de recherche local.

### 5.5 `/admin/products` + `/admin/products/[id]`

Liste paginée (aujourd'hui seuls `new`/`edit`/`availability` existent, jamais une vue neutre) +
fiche simple `[id]` (nom, établissement, prix, statut vendable, liens vers édition/disponibilité).
Champ de recherche local.

### 5.6 Pagination (composant partagé)

Un seul composant `ServerPagination` (§6 — nommé ainsi et non `Pagination` : HeroUI exporte déjà
un composant de ce nom, à primitives `onPress`/état client, incompatible avec une pagination par
lien `href` sans JS), appliqué aux 5 écrans ci-dessus + au retrofit `/admin/orders`.

## 6. Modèle de données

Aucune nouvelle table (contrairement à la spec 01) : `orders`, `order_lines`, `partners`,
`establishments`, `product_proposals`, `products`, `comm_campaigns`, `pms_reconciliation_entries`,
`partner_capabilities` — tous déjà supportés, réutilisés tels quels. Seule vraie nouveauté : la
RPC `list_clients` (§7).

Composants partagés (nouveaux, à créer une seule fois) :
- `packages/domain/src/pagination/resolvePageParams.ts` — helper pur : `searchParams` →
  `{page, pageSize, from, to}` (`from`/`to` = bornes directes pour `.range()`).
- `packages/ui/src/components/pagination.tsx` (exporte `ServerPagination`, §5.6) — rendu en liens
  `?page=N`, pas d'état React (cohérent avec le fait que toutes les pages liste actuelles sont des
  Server Components sans couche de fetch client).
- `packages/ui/src/components/kpi-card.tsx` et `chart-card.tsx` — première vraie utilisation de
  Recharts (dépendance déjà déclarée dans `apps/admin/package.json`, jamais consommée jusqu'ici).

## 7. Contrat RPC — `list_clients`

```
list_clients(
  p_search text default null,   -- ilike sur display_name (holder_name) OU email combinés
  p_email text default null,    -- filtre séparé
  p_limit int default 20,
  p_offset int default 0
) returns table (
  client_key text,        -- coalesce(account_id::text, lower(holder_email), holder_phone, order.id::text)
  display_name text,      -- holder_name de la commande la plus récente pour ce client_key
  email text,
  phone text,
  orders_count bigint,
  last_order_at timestamptz,
  total_count bigint       -- count(*) over(), un seul aller-retour
)
```
Repli sur `order.id::text` (pas prévu dans le contrat initial, ajouté à l'implémentation) : un
invité sans compte, email NI téléphone ne doit jamais fusionner silencieusement avec un autre
client sous une clé `NULL` commune (`GROUP BY` traite `NULL = NULL` comme une seule clé).

Construite sur `orders` dédupliquées (pas `partner_accounts`/`auth.users`, qui excluraient
structurellement tout client invité — `create_order_guest_checkout` accepte `auth.uid() = null`).
`security definer`, `set search_path=''`, garde `is_admin` — squelette de base (comme
`list_audience_members`), **pas** le squelette anti-survente (aucune capacité en jeu).

Le reste des listes (orders/partners/establishments/campaigns/products) reste de simples
`.select(..., {count:'exact'}).range(from,to)` — RLS déjà en place, aucune RPC nécessaire.

## 8. Règles et invariants

- Un item de sidebar ne pointe jamais vers une route inexistante — invariant testable en e2e
  (cliquer chaque lien, vérifier une réponse 200, jamais un 404).
- Les commissions sont toujours qualifiées « générées », jamais « à payer », tant que le ledger
  n'existe pas (constat 1).
- La pagination est toujours pilotée par l'URL, jamais un état client qui se perd au rechargement.

## 9. Cas limites

- Page hors bornes (`?page=999` sur une liste courte) → liste vide, jamais une erreur.
- Filtre email sans résultat → état vide explicite, pas un tableau qui reste sur l'ancien résultat.
- Client invité (aucun compte) → apparaît quand même dans `/admin/clients` (construit sur `orders`,
  pas sur les comptes).
- Audience de campagne vide → déjà couvert par les invariants existants de `comm_campaigns`.

## 10. Décisions tranchées / points ouverts

- **Fréquence de rafraîchissement des alertes** → au chargement de page seulement, pas de
  polling/Realtime pour ce lot (aucun signal d'un besoin seconde-près ; à revisiter si l'usage
  réel le montre).
- **Retrofit `/admin/orders`** — nuance technique réelle, pas cosmétique : `OrdersTable.tsx` fait
  aujourd'hui tri et filtre statut **côté client sur les lignes déjà chargées en entier**
  (`rowSortingFeature`, `apps/admin/app/admin/orders/OrdersTable.tsx:79-88`). Passer en pagination
  serveur casse silencieusement ces deux features si rien d'autre ne change (un filtre sur une
  seule page ne filtre plus que 10-20 lignes, pas la commande entière). **Décision retenue** :
  pousser filtre **et** tri serveur (`?status=&sort=&dir=&page=`, `TanStack Table` reconfiguré en
  `manualSorting: true`/`manualPagination: true`) — cohérent avec l'esprit G15 (pas de pagination
  qui ne résout qu'à moitié le problème). Repli explicite si le temps manque : tri resterait
  client (page courante seulement), seul le filtre statut passerait serveur.
- **Alerte « prestataire en attente »** — le mécanisme exact du cahier des charges (hors zone /
  liste d'attente) n'existe pas côté hifago (constat 3) ; la requête proxy proposée en §5.2 est
  documentée comme telle, pas présentée comme équivalente.
- **Ledger et export comptable** — reportés à une spec dédiée séparée (constat 1), jamais tranchés
  en silence ici.
- **Mécanisme de demande d'ouverture prestataire hors zone** (constat 3) — absent de hifago,
  candidat pour une spec/feature séparée (portage du `POST /api/partner/operator-request` legacy),
  hors périmètre de cette spec.

## 11. Annexe — traçabilité code→règle

### Sources ayant informé la spec

| Section | Fichiers sources |
|---|---|
| §1 Contexte | `hifago/apps/admin/app/admin/page.tsx`, `apps/admin/app/admin/layout.tsx`, `public/admin.js:208-234`, `public/admin.html:122-241`, `docs/2-reference/03-app-admin.md:41-63`, `hifago/docs/03-cahier-des-charges-admin.md` §2 |
| Constat 1 (ledger) | `hifago/supabase/migrations/20260814170000_set_order_line_status_rpc.sql:13-16`, `20260814180000_order_lines_commission_snapshot.sql`, `hifago/CLAUDE.md` §10 |
| Constat 2 (client) | `hifago/supabase/migrations/20260813194515_availability_orders_core_tables.sql:34-36`, `20260814230000_campaign_engine.sql:36-40` |
| Constat 3 (opérateur hors zone) | `hifago/docs/02-cahier-des-charges-socio.md:142-143` |
| §5 Écrans existants | `apps/admin/app/admin/{partners,establishments,orders,proposals,reconciliation}/page.tsx` |
| §7 RPC | `hifago/docs/05-reference-technique.md`, `20260814230000_campaign_engine.sql` (squelette `list_audience_members`) |

### Fichiers livrés (2026-08-15)

| Élément | Fichier |
|---|---|
| Migration (RPC `list_clients`) | `hifago/supabase/migrations/20260815100000_list_clients_rpc.sql` |
| Sidebar | `hifago/apps/admin/app/admin/AdminSidebar.tsx`, `layout.tsx` (restructuré) |
| Page d'accueil | `hifago/apps/admin/app/admin/page.tsx`, `dateWindow.ts`, `AdminAlerts.tsx`, `RecentList.tsx`, `charts/{SalesChart,CommissionsChart,TopPartnersChart,CatalogHealthChart}.tsx` |
| Composants partagés | `hifago/packages/ui/src/components/{pagination,kpi-card,chart-card}.tsx` (+ `packages/ui/package.json`, dépendance `recharts` ajoutée), `hifago/packages/domain/src/pagination/resolvePageParams.ts` (+ test) |
| `/admin/clients` | `hifago/apps/admin/app/admin/clients/page.tsx` |
| `/admin/campaigns` | `hifago/apps/admin/app/admin/campaigns/page.tsx` |
| `/admin/products` + `[id]` | `hifago/apps/admin/app/admin/products/page.tsx`, `products/[id]/page.tsx` |
| Retrofit pagination | `apps/admin/app/admin/partners/page.tsx`, `establishments/page.tsx`, `orders/page.tsx` + `OrdersTable.tsx` (filtre statut passé serveur, tri resté client sur la page courante — repli documenté §10), `orders/statusLabels.ts` (extrait de `OrdersTable.tsx`) |
| Tests E2E | `hifago/apps/admin/e2e/admin-home-navigation.spec.ts` — 6 scénarios : routes sidebar sans 404, surlignage + clic réel, KPIs/alertes/4 graphiques, fenêtre 90 jours, filtres clients (texte + email + cas vide), pagination présente sur les listes existantes |

### Écarts constatés en implémentant, sans lien avec cette feature

- **Suite e2e existante (26 tests) rejouée avant et après ce lot** : 6 échecs, tous préexistants ou
  hors périmètre — 4 (`admin-camp-booking`, `admin-partner-offboarding`, `admin-product-create`,
  `admin-product-publish`) échouent sur `input[name="name-es"]` introuvable dans
  `NewEstablishmentForm.tsx`, restructuré en parallèle par une autre feature en cours (adresse
  géocodée, photos, description) — pas cette spec. 1 (`admin-partner-registry`) est le bug déjà
  documenté du switch « código activo » (feature 26 §11, reproduit indépendamment de toute
  migration). Le 6ᵉ (`admin-product-edit`) échoue sur un clic qui ne navigue pas vers
  `/admin/establishments/{id}` alors que le lien existe, est visible et que la navigation directe
  vers la même URL fonctionne parfaitement — même famille de flake de clic que le bug switch
  ci-dessus, jamais un problème de données/pagination (vérifié : l'établissement ciblé est bien
  sur la page 1 avec seulement 8 lignes en base au moment du test).
- Aucun de ces 6 échecs n'est reproductible en isolant strictement le code de cette spec ; non
  corrigés ici (hors périmètre, pas cette feature).

## 12. Documents liés

- `hifago/docs/03-cahier-des-charges-admin.md` §2, §3e, §3g — vision globale du rôle admin.
- `hifago/docs/04-architecture-cible.md` — pagination manuelle, ledger, export (points renvoyés
  au chiffrage).
- `docs/specs/01-admin-creation-partenaire.md` — précédent direct (gabarit, granularité).
- `docs/specs/03-admin-creation-etablissement.md`, `docs/specs/04-gestion-images.md` — specs
  parallèles (autres features, même session) : un futur spec ledger dû/payé (constat 1) prendrait
  le premier numéro libre au moment de son écriture, pas un numéro figé ici à l'avance.
