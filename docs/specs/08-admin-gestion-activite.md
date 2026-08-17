---
id: specs-admin-gestion-activite
titre: "Admin gère une activité (tags, paliers de prix, bornes de quantité, suppression réelle)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-15
resume: >
  Spec de la gestion CRUD complète d'une activité côté admin (`products.type='activity'`) :
  catalogue de tags remplaçant la catégorie fixe, prix par palier de quantité/personnes, bornes
  min/max de quantité par réservation appliquées dans la RPC anti-survente, et suppression réelle
  avec garde-fou anti-commande. Événements/camps/hébergement/réservation restent hors périmètre.
mots_cles: [admin, gestion activite, tags, catalog_tags, paliers de prix, price_tiers, min_qty,
  max_qty, suppression produit, delete_product, create_order, hifago]
repond_a:
  - "Comment l'admin catégorise-t-il une activité avec plusieurs tags au lieu d'une catégorie fixe ?"
  - "Comment définir un prix qui varie selon la quantité/le nombre de personnes ?"
  - "Comment supprimer réellement une activité sans casser l'historique d'une commande existante ?"
  - "Comment appliquer des bornes de quantité par réservation sans casser l'invariant anti-survente ?"
---

# Admin gère une activité

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). **Numéro de fichier `08-`** —
> `06-gestion-etablissement.md` et `07-connexion-inscription-complete.md` livrés par d'autres
> sessions concurrentes le même jour, vérifié juste avant création de ce fichier (`ls docs/
> specs/`). Pas de numéro de build hifago dédié attribué (convention "Feature N" laissée de côté
> pour cette spec, cf. `hifago/CLAUDE.md` § État courant).
>
> **Implémentée le 2026-08-15**, après un brainstorm en plusieurs temps avec Jérôme : périmètre
> initial resserré à "activité uniquement" (pas evento/camp/hébergement/réservation), puis élargi
> en cours de session à la demande de Jérôme (tags multiples, paliers de prix, bornes min/max —
> cf. §3, §10) après comparaison avec l'app legacy en production.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 6 | Modèle de données | implémenté |
| 7 | Contrat API/RPC | implémenté |
| 8 | Règles et invariants | implémenté |
| 9 | Cas limites | implémenté |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 1. Contexte et problème

Le cahier des charges admin (§3c, validé 2026-08-11) décide un CRUD complet sur le catalogue —
création, modification, dépublication, **suppression** — mais aucun mécanisme de suppression
n'existait pour `products` (ni colonne `status`, ni RPC, ni écran ; seul `sellable=false` via
`set_product_sellable`, feature 4, existait comme levier négatif). La "catégorie" d'une activité
restait par ailleurs une énumération fixe à 6 valeurs (`products.category`), jamais même exposée
à la création (`NewProductForm.tsx`), alors que l'audit `hifago/docs/00-modele-de-donnees.md` §3
et le cahier admin §3c décidaient déjà que des tags remplaceraient cette catégorie figée.

En cours de session, Jérôme a demandé d'aller plus loin après un rappel de la règle "refaire pas
réinventer" ([[hifago_rebuild_not_reinvent]]) : gérer plusieurs catégories/tags par activité, un
prix qui varie par palier de quantité/personnes, des bornes min/max de quantité par réservation.
Une comparaison exhaustive avec l'app legacy en production (`src/services/catalogService.js`,
`pricingService.js`, `stayService.js`, `public/admin.js`) a montré que :
- La suppression réelle avec garde-fou anti-commande **existe déjà et fonctionne ainsi en legacy**
  (`catalogService.deleteProduct`) — la seule des demandes de cette spec qui soit une vraie reprise
  fidèle, pas une extension.
- Tags multiples, paliers de prix pour une activité et min/max par réservation **n'existent nulle
  part côté legacy** pour une activité (le seul palier legacy, `stay_rates`, est strictement
  réservé à un hébergement loué en entier) — ce sont des extensions nouvelles, assumées comme
  telles, pas des reprises.
- Le cupo du jour (capacité globale par date/créneau) est déjà repris côté hifago (Tranche 3,
  `product_availability`/`product_calendar`) — rien à ajouter ici.

## 2. Portée

**In** :
- Catalogue `catalog_tags` (admin crée/renomme/retire un tag) et assignation multi-valeurs à une
  activité (`product_tag_assignments`), remplaçant `products.category` côté écran admin direct.
- Prix par palier de quantité/personnes (`products.price_tiers`), qui remplace `price_cop` pour le
  calcul réel côté `create_order` dès qu'il est défini.
- Bornes `min_qty`/`max_qty` par réservation, appliquées réellement dans `create_order` (remplace
  le plafond générique codé en dur `qty > 20`).
- RPC `delete_product` : suppression réelle d'une activité, bloquée si elle a déjà été commandée
  (`order_lines`), quel que soit le statut de la commande.

**Out, explicitement renvoyé ailleurs** :
- Événements (`evento`), camps (`camp`), ~~hébergement (`lodging`)~~ — activé le 2026-08-16,
  [`12-admin-alojamiento-house.md`](12-admin-alojamiento-house.md) —, et tout ce qui touche le
  parcours de réservation lui-même au-delà des deux bornes ci-dessus — périmètre "activité
  uniquement", cadré par Jérôme dès le départ.
- Horaires d'ouverture/fermeture, créneaux réels, durée d'une activité — demandés par Jérôme en
  cours de session, mais reconnus structurellement équivalents à une nouvelle dimension de
  capacité dans la RPC anti-survente (comme les camps/evento, chacun déjà leur propre spec) :
  renvoyés à une future spec dédiée (numéro non encore attribué — `09` a finalement été pris par
  la spec de design system admin, `10` par celle de standardisation des listes admin/socio, toutes
  deux écrites avant celle-ci).
- Commission (`acompte_pct`/`referral_pct`), coordonnées géographiques, ordre d'affichage (`sort`)
  — jamais construits ici, cf. §10.
- Tags côté établissement — `catalog_tags` est nommée de façon générique pour ne pas fermer cette
  porte plus tard, mais seule l'assignation produit est construite dans cette spec.
- Migration/suppression de `products.category` — reste en base, toujours utilisée par le flux
  socio (`product_proposals`/`moderate_product_proposal_rpc`), hors périmètre admin-only ici.
- Refine.dev — l'architecture cible le prescrit pour les écrans "vraiment CRUD" comme le
  catalogue, mais aucun des écrans livrés à ce jour (specs 01/02/03/04/06) ne l'utilise ; écart
  assumé et documenté, pas comblé dans cette spec (cf. §3).

## 3. Décisions retenues

- **Écran partagé conservé** — `NewProductForm.tsx`/`EditProductForm.tsx` restent l'écran unique
  activity/evento/camp avec champs conditionnels par type ; tags/paliers/min-max réservés à
  `type === "activity"`, jamais exposés pour evento/camp.
- **Suppression réelle avec garde-fou** — reprise fidèle du comportement legacy : une activité
  ayant au moins une ligne dans `order_lines` (quel que soit son statut, y compris annulée) ne se
  supprime jamais, seulement dépubliable via `set_product_sellable`.
- **Tags remplacent `category` à l'écran admin direct seulement**, pas en base ni côté socio — le
  cahier des charges lui-même qualifie le lien "remplacées ou simple pré-remplissage" de non
  tranché (`hifago/docs/01-cahier-des-charges-client.md` §2) ; option la moins invasive retenue
  ici, migration complète renvoyée à une décision ultérieure (§10).
- **Paliers de prix remplacent `price_cop` pour le calcul réel** dès qu'ils sont définis —
  `price_cop` reste renseigné pour l'affichage catalogue (prix du palier le plus bas), jamais
  utilisé par `create_order` dans ce cas. Structure reprise du précédent technique `stay_rates`
  (tranches non chevauchantes), validée côté app (formulaire admin), jamais un CHECK SQL sur du
  JSON complexe — même choix que `stay_rates` côté legacy.
- **Min/max qty appliqués réellement dans `create_order`**, pas seulement un champ descriptif —
  remplace le plafond générique `qty > 20` codé en dur, avec repli sur le comportement historique
  (1..20) si non défini sur le produit. Extension bornée : aucun changement au schéma de
  verrouillage (`product_availability` reste keyé `(product_id, date)`), c'est précisément ce qui
  distingue cette extension des créneaux horaires (future spec dédiée, nouvelle dimension de
  capacité — voir §10).
- **RLS directe pour `catalog_tags`/`product_tag_assignments`/`price_tiers`/`min_qty`/`max_qty`**
  — aucun des 4 critères RPC-only (`hifago/CLAUDE.md` §3) ne s'applique : pas de compteur de
  capacité, pas de verrou optimiste multi-admin, pas de lecture cross-identité, pas plus "audité"
  que `products.category` aujourd'hui (jamais audité).
- **`delete_product` en `security definer`**, pas `security invoker` (contrairement au calibrage
  plus léger de `set_product_sellable`) — justifié : `product_availability` et `product_proposals`
  portent un `revoke insert, update, delete ... from authenticated, anon` explicite (RPC-only par
  GRANT), un DELETE en `security invoker` échouerait par "permission denied" avant même
  l'évaluation de la RLS.
- **Pattern custom conservé** (Server Component + HeroUI + RLS/RPC selon critère habituel), pas
  Refine.dev — écart déjà présent dans les 5 specs précédentes, pas rouvert ici sans fait nouveau
  présenté à Jérôme (`hifago/CLAUDE.md` §1).

## 4. Parcours cible

1. L'admin crée un tag depuis `/admin/tags` (nom, slug dérivé automatiquement).
2. Il assigne des tags à une activité, à la création (`/admin/products/new`, optionnel) ou depuis
   l'édition (`ProductTagsBlock`, sauvegarde immédiate par ajout/retrait).
3. Il définit soit un prix simple, soit un prix par paliers de quantité (bascule "Definir por
   tramos"), et optionnellement des bornes min/max de quantité par réservation.
4. Un client tente une commande : quantité sous le minimum ou au-dessus du maximum → rejetée
   avant tout verrou ; quantité dans une plage non couverte par les paliers → rejetée ; quantité
   dans un palier → prix résolu automatiquement côté serveur.
5. L'admin retire un tag du catalogue depuis `/admin/tags` → disparaît en cascade de toutes les
   activités qui le portaient, aucune confirmation en deux temps distincte (le compte d'usage est
   déjà affiché dans la modale de suppression).
6. L'admin tente de supprimer une activité jamais commandée → confirmation → suppression réelle →
   retour au catalogue, fiche 404 ensuite.
7. L'admin tente de supprimer une activité déjà commandée → message explicite, lien direct vers la
   dépublication, aucune suppression n'a lieu.

## 5. Écran(s)

1. **`/admin/tags`** (nouveau) — liste (libellé, nombre d'activités assignées), formulaire de
   création (`NewTagForm`), renommage (`RenameTagButton`, Modal pré-rempli) et suppression avec
   confirmation (`DeleteTagButton`, mirroir de `RevokeInvitationButton.tsx`). Pas de
   `ServerPagination` (volume attendu en dizaines).
2. **`/admin/products/new`** — champ unique **"Nombre"** (`nameEs`/`nameEn` retirés, même décision
   que l'établissement spec 03 — cf. §10) ; champ `TagsMultiSelect` (nouveau composant partagé,
   **crée un tag à la volée** si la frappe ne correspond à aucun tag existant) ; bloc "Precio" avec
   bascule prix simple/paliers, champs min/max qty — ces quatre derniers réservés à
   `type === "activity"`.
3. **`/admin/products/[id]/edit`** — même champ "Nombre" unique ; `category` retirée du formulaire
   de contenu ; nouveau bloc séparé `ProductTagsBlock` (même patron que `ProductStatusBlock`/
   `ProductPhotosBlock` : action distincte, sauvegarde immédiate) ; bloc prix simple/paliers +
   min/max qty ajouté au formulaire de contenu (édition directe, pas de RPC).
4. **`/admin/products/[id]`** — bouton "Eliminar" (nouveau `DeleteProductButton`, mirroir de
   `RevokeInvitationButton.tsx`) ajouté à la barre d'actions, à côté de "Editar"/"Disponibilidad".
5. **`/admin/products`** (liste) — lien "Editar" ajouté à côté de "Ver" sur chaque ligne, accès
   direct sans passer par la fiche de lecture.

**Composant partagé `TagsMultiSelect`** (`hifago/apps/admin/components/tags-multiselect.tsx`) —
multi-sélection, aucun équivalent existant (`SearchableCombobox`, spec 03, est mono-sélection).
Ajout via `ComboBox` (recherche client-side, taper une requête avant de cliquer — piège HeroUI déjà
documenté `CLAUDE.md §11.7`), retrait via `TagGroup`/`Tag`/`Tag.RemoveButton` (HeroUI, première
utilisation dans le projet).

## 6. Modèle de données

| Élément | Statut |
|---|---|
| `catalog_tags(id, label jsonb, slug text unique, created_at)` | **Nouvelle table.** RLS directe, lecture publique, écriture admin. |
| `product_tag_assignments(product_id, tag_id, created_at, PK composite)` | **Nouvelle table.** Cascade des deux côtés (pas de l'historique de commande). RLS directe, visibilité héritée du produit parent. |
| `products.price_tiers jsonb` | **Ajoutée.** Nullable. Tranches `{min_qty, max_qty, price_cop}`, intervalles fermés, non chevauchants (validé côté app). |
| `products.min_qty int`, `products.max_qty int` | **Ajoutées.** Nullables, `CHECK(min_qty <= max_qty)`. Repli RPC sur 1/20 si non définies. |

Aucune modification de colonnes existantes (`products.category` inchangée, toujours utilisée côté
socio).

## 7. Contrat API/RPC

```sql
delete_product(p_product_id uuid, p_note text default null) returns void
```
`security definer`, `set search_path = ''`, `is_admin()` vérifié explicitement en tête. Snapshot
complet de la ligne avant suppression (`to_jsonb`), audité (`log_admin_action('product.delete', ...)`).
Exceptions : `produit introuvable` (défaut P0001) si la ligne n'existe pas ; `esta actividad ya fue
reservada...` (`errcode='23503'`, réutilisé pour sa justesse sémantique comme `23505` l'est déjà
pour "code déjà attribué") si `order_lines` porte au moins une ligne pour ce produit. Nettoie
`product_calendar`/`product_availability`/`product_proposals` (aucune cascade native) avant le
`delete` final sur `products`.

**`create_order`** (RPC anti-survente, `supabase/migrations/20260815240000_create_order_qty_bounds_and_tiers.sql`)
étendue sur exactement deux points, tous deux avant tout verrou (Phase 1) ou en écriture (Phase 4) :
- Phase 1 : `coalesce(products.min_qty, 1)`/`coalesce(products.max_qty, 20)` remplacent le plafond
  fixe `qty > 20` — nouveaux `reason` possibles : `qty_below_minimum`, `qty_cap_exceeded` (repris),
  `no_matching_tier` (si `price_tiers` est défini mais ne couvre pas la quantité demandée).
- Phase 4 : si `products.price_tiers` est défini, le prix de la ligne est résolu par
  `jsonb_to_recordset` sur la tranche couvrant la quantité commandée, au lieu de `price_cop` —
  toujours calculé côté serveur, jamais transmis par le client.

Aucun changement au schéma de verrouillage (`product_availability` reste keyé `(product_id, date)`,
même ordre de verrous Phase 2/2b). Pas de RPC pour `catalog_tags`/`product_tag_assignments`/
`price_tiers`/`min_qty`/`max_qty` côté écriture admin — RLS directe, justifiée §3.

## 8. Règles et invariants

- Une activité avec au moins une ligne dans `order_lines` (tout statut confondu) ne peut jamais
  être supprimée, seulement dépubliée.
- `create_order` résout toujours le prix côté serveur (`price_cop` ou palier), jamais transmis par
  le client — invariant déjà en place, préservé par cette extension.
- Un tag retiré du catalogue retire aussi toutes ses assignations (cascade), sans confirmation
  distincte de celle de la suppression du tag lui-même (le compte d'usage est déjà affiché).
- Un produit peut avoir 0 tag (jamais bloquant), un prix simple sans palier (comportement par
  défaut), et aucune borne min/max (repli sur 1..20).
- `min_qty <= max_qty` imposé par CHECK SQL ; non-chevauchement des paliers validé côté app
  uniquement (même choix que `stay_rates` côté legacy).

## 9. Cas limites

- **Échec de l'assignation de tags à la création** (`NewProductForm`) → absorbé silencieusement,
  le produit reste valide sans ses tags, corrigible depuis l'édition — même discipline que les
  photos (spec 04).
- **Nettoyage storage à la suppression d'une activité** → non fait (gap déjà présent dans
  `ProductPhotosBlock.handleDelete`, spec 04, pas introduit ici) — les fichiers du bucket
  `catalog-media` référencés par les `product_media` cascadés restent orphelins.
- **Quantité demandée dans une plage non couverte par les paliers** (ex. un "trou" entre deux
  tranches) → rejet en Phase 1, avant tout verrou (`no_matching_tier`).
- **Suppression d'un tag utilisé par une activité déjà commandée** → sans effet sur l'historique
  (`order_lines` ne référence jamais `catalog_tags`), le tag disparaît simplement de la fiche
  produit courante.
- **Un panier qui a passé la Phase 1 mais ne retrouve pas de palier en Phase 4** (incohérence
  interne, ne devrait jamais arriver) → pas de branche d'erreur silencieuse : l'insert
  `order_lines` échoue sur sa contrainte `NOT NULL price_cop` plutôt que de deviner un prix.

## 10. Décisions tranchées / points ouverts

- **Nom d'activité = champ unique** — tranché le 2026-08-15 (retour Jérôme), même décision que
  l'établissement (spec 03) : `nameEs`/`nameEn` retirés de `NewProductForm`/`EditProductForm` au
  profit d'un seul champ "Nombre", toujours stocké `{es: valeur}`. Scope volontairement limité aux
  écrans admin directs — les formulaires socio (`EditProposalForm.tsx`, `ModerateProposalForm.tsx`)
  gardent `name-es`/`name-en` inchangés (payload `product_proposals`, hors périmètre admin-only de
  cette spec). Si une cohérence totale est souhaitée plus tard, adapter ces deux écrans est un
  chantier de suivi séparé, pas tranché ici.
- **Coexistence `category`/tags** — tranchée pour cette spec (coexistence, retrait de l'écran admin
  direct seulement), mais le cahier des charges lui-même qualifie le lien final ("remplacées ou
  simple pré-remplissage") de non tranché. Une migration de données (6 catégories → 6 tags
  initiaux) + suppression de `category` + adaptation du flux socio (`submit_product_proposal`/
  `moderate_product_proposal_rpc`/`EditProposalForm.tsx`) reste un chantier de suivi séparé, pas
  chiffré ici.
- **Mécanisme de proposition de tag par un prestataire** — le cahier admin §3c mentionne "y compris
  ceux proposés par un prestataire" sans décrire de flux technique ; resté informel (hors système)
  pour l'instant. Si un vrai flux est attendu à court terme, c'est un chantier socio séparé.
- **Horaires d'ouverture/fermeture + créneaux + durée réelle** — explicitement renvoyés à une
  future spec dédiée (numéro non encore attribué — `09` a finalement été pris par la spec de
  design system admin, `10` par celle de standardisation des listes admin/socio, toutes deux
  écrites avant celle-ci) : structurellement une nouvelle dimension de capacité dans
  `create_order`/`product_availability`, avec sa propre suite de tests de concurrence dédiée — pas
  un champ de formulaire, cf. §2.
- **Nettoyage storage à la suppression d'une activité** — assumé absent, aligné sur le gap déjà
  présent dans la suppression de photo individuelle (spec 04) ; à documenter comme dette plutôt
  que corriger ici.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte | `hifago/docs/00-modele-de-donnees.md` §3, `hifago/docs/03-cahier-des-charges-admin.md` §3c, comparatif legacy (`src/services/catalogService.js`, `pricingService.js`, `stayService.js`, `public/admin.js`) |
| §3/§7 RPC `delete_product` | `hifago/supabase/migrations/20260813240000_set_product_sellable_rpc.sql` (patron audité imité) |
| §3/§7 Extension `create_order` | `hifago/supabase/migrations/20260814220000_camp_multiday_booking.sql` (version de base étendue), `hifago/tests/concurrency/create_order.concurrency.mjs` (barème de non-régression) |
| §5 Écrans | `hifago/apps/admin/app/admin/invitations/RevokeInvitationButton.tsx` (patron confirmation destructive), `hifago/apps/admin/components/searchable-combobox.tsx` (patron étendu pour `TagsMultiSelect`) |
| §6 Modèle | `hifago/supabase/migrations/20260815110000_gestion_images.sql` (patron cascade `catalog_*`) |

### Fichiers réellement livrés (2026-08-15)

| Élément | Fichier |
|---|---|
| Migration tags | `hifago/supabase/migrations/20260815210000_catalog_tags.sql` |
| Migration RPC suppression | `hifago/supabase/migrations/20260815220000_delete_product_rpc.sql` |
| Migration paliers/bornes qty | `hifago/supabase/migrations/20260815230000_product_price_tiers_and_qty_bounds.sql` |
| Migration extension `create_order` | `hifago/supabase/migrations/20260815240000_create_order_qty_bounds_and_tiers.sql` |
| Composants partagés | `hifago/apps/admin/components/tags-multiselect.tsx`, `hifago/apps/admin/lib/products/priceTiers.ts` |
| Écran tags | `hifago/apps/admin/app/admin/tags/page.tsx`, `NewTagForm.tsx`, `DeleteTagButton.tsx`, `RenameTagButton.tsx` |
| Écrans produit modifiés | `NewProductForm.tsx`, `products/new/page.tsx`, `EditProductForm.tsx`, `[id]/edit/page.tsx`, `[id]/edit/ProductTagsBlock.tsx`, `[id]/page.tsx`, `[id]/DeleteProductButton.tsx` |
| Navigation | `AdminSidebar.tsx`, `e2e/admin-home-navigation.spec.ts` (`SIDEBAR_ROUTES`) |
| Tests e2e | `e2e/admin-tags-catalog.spec.ts`, `e2e/admin-product-tags.spec.ts`, `e2e/admin-product-delete.spec.ts`, `e2e/admin-product-price-tiers.spec.ts` |
| Liste produits (lien Editar) | `hifago/apps/admin/app/admin/products/page.tsx` |

### Correctifs UX du 2026-08-15 (retour Jérôme après premier passage visuel)

Un premier passage n'avait été vérifié qu'en e2e par sélecteurs (`data-testid`), jamais visuellement
dans un navigateur — l'écart a été détecté par Jérôme, pas par les tests. Quatre correctifs, tous
revérifiés (screenshot + e2e) avant clôture :
- Nom d'activité passé à un champ unique "Nombre" (`nameEs`/`nameEn` retirés), scope limité aux
  écrans admin directs — cf. §10.
- `TagsMultiSelect` crée un tag à la volée si la frappe ne correspond à aucun tag existant.
- Lien "Editar" ajouté sur `/admin/products` (liste) ; bouton "Editar" (renommer) ajouté sur
  `/admin/tags`.
- Titre "Etiquetas" dupliqué retiré de `ProductTagsBlock.tsx`.

Contamination croisée trouvée en corrigeant : `admin-product-price-tiers.spec.ts` sélectionnait un
établissement seedé **partagé** par son nom affiché — cassé par `admin-establishment-edit.spec.ts`
(spec 06, autre session) qui renomme ce même établissement en testant l'édition. Corrigé en créant
un établissement dédié à ce test plutôt qu'un seedé partagé (jamais une sélection par nom sur une
ressource partagée mutable).

### Collision concurrente rencontrée pendant l'implémentation

La migration `20260815250000_admin_2fa_aal2.sql` (spec 07, autre session) a redéfini `is_admin()`
pour exiger AAL2 (2FA), pendant que cette spec était en cours d'implémentation — bloquant
temporairement toute vérification e2e (y compris des tests préexistants sans lien,
`admin-product-photos.spec.ts`), le temps que l'infrastructure de test (`loginAs`/
`createSignedInClient`) soit mise à jour pour compléter le challenge MFA. Vérification e2e complète
de cette spec effectuée une fois ce blocage levé (cf. entrée `hifago/CLAUDE.md`).

## 12. Documents liés

- `docs/specs/03-admin-creation-etablissement.md` — précédent du composant `SearchableCombobox`,
  étendu ici pour `TagsMultiSelect`.
- `docs/specs/04-gestion-images.md` — précédent du patron `catalog-*` et de la cascade sur
  suppression de contenu.
- `docs/specs/02-admin-accueil-et-navigation.md` — sidebar, invariant "toute route de la sidebar
  résout sans 404" (§8 du test `admin-home-navigation.spec.ts`).
- `hifago/docs/05-reference-technique.md` — squelette RPC anti-survente réutilisé pour
  `create_order`, barème de non-régression (5 runs propres).
- **Spec à venir** : ~~"horaires et créneaux" (numéro à confirmer, probablement `09`)~~ — écrite le
  2026-08-16, [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md).
  Ne remplace **pas** `schedule='slot'` (jamais câblé, toujours en place) : le nouveau module
  (`product_slot_rules`) reste indépendant, signalé par sa seule présence — la coexistence ou le
  remplacement du champ `slot` legacy est un point encore ouvert (cf. spec 11 §10).
