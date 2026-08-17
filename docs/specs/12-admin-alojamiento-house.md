---
id: specs-admin-alojamiento-house
titre: "Admin : active products.type='lodging' (« house ») dans le parcours produit — check-in/check-out, capacité, extras de tarification (saison, week-end, dépôt, inclusiones)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-16
resume: >
  Active le type de produit `lodging`, dormant depuis la toute première migration catalogue et
  explicitement renvoyé hors périmètre par la spec 08. Réutilise le parcours ProductForm unifié
  (spec 11) et ses mécanismes déjà construits (price_tiers/min_qty/max_qty, tags, photos, lieu) ;
  le seul volet horaires diverge : check-in/check-out (colonnes time) + capacité dédiée au lieu de
  créneaux. Réactive la colonne dormante products.stay_rates pour les extras sans équivalent
  hifago (saison mensuelle, dépôt, inclusiones) et y ajoute une majoration week-end (absente de la
  V1). Tranche 1 : définition admin seulement, aucune consommation au checkout.
mots_cles: [admin, alojamiento, lodging, house, check-in, check-out, capacity, stay_rates,
  temporada alta, recargo fin de semana, product-form, hifago]
repond_a:
  - "Comment l'admin crée-t-il et édite-t-il un hébergement loué en entier (« house ») ?"
  - "Où saisir l'heure de check-in/check-out et la capacité de couchage d'un alojamiento ?"
  - "Comment définir une majoration de prix en saison haute ou le week-end pour un alojamiento ?"
  - "products.stay_rates sert à quoi, et pourquoi n'était-il pas utilisé jusqu'ici ?"
---

# Admin : activer `type='lodging'` (« house ») dans le parcours produit

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). Suite directe de
> [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md)
> (parcours `ProductForm` unifié réutilisé tel quel) et de
> [`08-admin-gestion-activite.md`](08-admin-gestion-activite.md), qui avait explicitement renvoyé
> « hébergement (lodging) » hors périmètre (§2). **Implémentée le 2026-08-16**, à la demande de
> Jérôme, après vérification de la V1 legacy (`src/services/stayService.js`,
> `src/services/migrations/012_stay_rates.sql`, `src/services/catalogService.js`) — cf. §1.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 6-9 | *(fusionnées dans 0)* | — |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

Aucune RPC nouvelle et aucune modification de `create_order` : ce dernier plafonne déjà `lodging`
(`lodging_cap_exceeded`, 4 lignes/12 unités par commande) depuis sa toute première version — un
alojamiento se commande aujourd'hui comme un produit à `qty` simple, exactement comme une activité.
Toutes les écritures admin (colonnes `products`, `stay_rates`) restent RLS-directe — aucun des 4
critères RPC-only de `hifago/CLAUDE.md` §3.1 ne s'applique (données définitionnelles, pas un
compteur de capacité vivant).

### Modèle de données (delta)

| Colonne | Statut | Détail |
|---|---|---|
| `products.check_in_time` | **nouvelle** | `time`, nullable |
| `products.check_out_time` | **nouvelle** | `time`, nullable |
| `products.capacity` | **nouvelle** | `int`, nullable, `check (capacity is null or capacity > 0)` — « nombre de couchage », distinct de `min_qty`/`max_qty` qui bornent une commande |
| `products.type` | **déjà en base** | `'lodging'` accepté depuis `20260813190232_catalog_core_tables.sql`, jamais exposé à l'écran |
| `products.stay_rates` | **déjà en base, réactivée** | `jsonb`, copiée du schéma V1 dans la même migration fondatrice, jamais branchée. Réutilisée pour les extras sans équivalent hifago : `{ season: {months, surcharge_pct, note}, weekend_days, weekend_surcharge_pct, includes, deposit_cop, extra_note }`. `null` = pas d'extras définis |

Les paliers de prix par nombre de personnes **ne vivent pas** dans `stay_rates` : ils réutilisent
`price_tiers`/`min_qty`/`max_qty`, déjà construits pour l'activité (spec 08/11) et déjà câblés dans
`create_order` — `qty` sur une ligne de commande `lodging` = nombre de personnes.

### Invariants

- Le parcours de création/édition d'un alojamiento est le **même composant** `ProductForm` que
  l'activité — nom/description i18n, lieu, photos, tags, prix (simple ou par tramos), bornes
  min/max de quantité : identiques, aucune divergence de mécanisme.
- Contrairement aux créneaux d'activité (table enfant `product_slot_rules`, staging obligatoire en
  création), `check_in_time`/`check_out_time`/`capacity`/`stay_rates` sont de **simples colonnes
  `products`** — éditables directement dans les deux modes (création et édition), sans bloc séparé
  ni staging.
- `stay_rates` (saison/week-end/inclusiones/dépôt/note) est **purement définitionnel dans cette
  tranche** : jamais lu par `create_order`, jamais affiché côté `apps/web`. La consommation réelle
  au checkout (calcul de prix par nuit, majorations appliquées) est une Tranche 2 future — même
  calibrage que `product_slot_rules` en spec 11.
- La majoration week-end (`weekend_days`/`weekend_surcharge_pct`) est une **extension consciente**
  au-delà de la V1 (demande explicite de Jérôme) — la V1 n'avait qu'un levier temporel mensuel
  (`season.months`), jamais hebdomadaire, cf. `docs/00-modele-de-donnees.md` §1.

### Cas limites

- Grille `stay_rates` entièrement vide (aucun mois, aucune majoration, aucune inclusion, aucun
  dépôt, aucune note) → colonne stockée `null`, même convention que `price_tiers`/V1 (« NULL = pas
  de grille »). Les jours de week-end présélectionnés par défaut (Ven+Sam) dans l'éditeur ne
  comptent pas comme « non vide » tant qu'aucune majoration n'est saisie.
- Majoration saison ou week-end saisie sans mois/jours choisis → erreur de validation bloquante
  (« Elige al menos un mes/día… »), même discipline que `product_slot_rules` (jours obligatoires si
  la règle existe).
- `capacity` renseignée plus basse que le plafond des tramos de prix (ou l'inverse) → accepté sans
  validation croisée, les deux notions peuvent diverger sans se contredire (cf. §3).

### Fichiers touchés

Créés : `apps/admin/lib/products/stayRates.ts`, `apps/admin/components/stay-rates-editor.tsx`,
`apps/admin/lib/products/stayRates.test.ts`, `apps/admin/components/stay-rates-editor.test.tsx`,
`apps/admin/e2e/admin-product-lodging.spec.ts`,
`supabase/migrations/20260816100000_product_lodging_fields.sql`.
Modifiés : `apps/admin/components/product-form.tsx`,
`apps/admin/app/admin/products/[id]/edit/page.tsx`.
Détail complet et traçabilité : §11.

---

## 1. Contexte et problème

Jérôme veut pouvoir créer/éditer un hébergement loué en bloc (« house »/alojamiento) avec le même
parcours admin qu'une activité (spec 11), à l'exception du volet horaires : pas de créneaux, mais
une heure de check-in/check-out et une capacité de couchage. Clarification obtenue en cours de
session : mélanger le mécanisme déjà construit pour l'activité (tramos de prix, bornes de quantité)
**et** les fonctionnalités de prix de la V1 (majoration de saison, + une majoration week-end/semaine
citée en exemple par Jérôme, absente de la V1).

**Découverte de recherche clé** — `products.type` accepte déjà `'lodging'` depuis la toute première
migration catalogue (`20260813190232_catalog_core_tables.sql`) et `create_order` applique déjà un
plafond dédié (`lodging_cap_exceeded`) à ce type, sans jamais avoir été exposé à un écran admin.
Encore plus notable : `products.stay_rates` (jsonb) existe déjà en base, copiée telle quelle du
schéma V1 dans cette même migration, jamais branchée non plus. `apps/admin/lib/lists/filters.ts`
liste déjà `lodging` comme valeur de filtre sur `/admin/products`. La spec 08 avait explicitement
renvoyé « hébergement (lodging) » hors périmètre (§2, « Out, explicitement renvoyé ailleurs »).

**Vérification V1 (« refaire pas réinventer », [[hifago_rebuild_not_reinvent]])** —
`src/services/stayService.js` (module pur, déjà audité) : une grille `stay_rates` par produit =
paliers de prix par **nombre de personnes** (`tiers[].min_guests/max_guests/price_cop`, triés, non
chevauchants) + majoration **saison par mois entiers** (`season.months[]` + `surcharge_pct` 0-1) +
`includes[]` (texte libre, max 20) + `check_in`/`check_out` (texte libre) + `deposit_cop` +
`extra_note`. **Aucune majoration week-end/semaine en V1** — gap déjà identifié dans
`docs/00-modele-de-donnees.md` §1 (« le prix doit pouvoir varier par date… jamais même
semaine/week-end ») : la demande de Jérôme comble ce gap connu, pas une reprise pure V1.

## 2. Portée

**In** :
- Nouveau type `lodging` (« Alojamiento ») dans le sélecteur `Tipo` de `ProductForm`, même point
  d'entrée que camp/evento (lien existant « + Actividad », aucun nouveau lien/écran).
- Réutilisation intégrale du parcours activité : nom/description i18n, lieu optionnel, photos dès
  la création, tags, prix simple ou par tramos, bornes min/max de quantité (réinterprétées comme
  nombre de personnes pour un alojamiento).
- Check-in/check-out (`products.check_in_time`/`check_out_time`, colonnes `time`) et capacité de
  couchage (`products.capacity`), éditables en création **et** en édition directement dans
  `ProductForm` (pas de staging, ce sont de simples colonnes `products`).
- Extras de tarification réactivant `products.stay_rates` : majoration de saison (mois + %),
  majoration week-end (jours + %, nouveau par rapport à la V1), inclusiones (liste libre), dépôt,
  note additionnelle.

**Out, explicitement renvoyé à une Tranche 2** :
- Consommation réelle de `stay_rates`/tramos par le calcul de prix au checkout (aujourd'hui,
  `create_order` traite `lodging` comme un produit à `qty` simple, sans lire `stay_rates`).
- Calendrier de nuitées / sélection de dates de séjour côté `apps/web`, et toute RPC anti-survente
  associée.
- Affichage public (`apps/web`) de check-in/check-out/capacité/stay_rates — aucun dans cette
  tranche.
- Un hôtel « à chambres » sans PMS (`docs/00-modele-de-donnees.md` §2, gap distinct — un alojamiento
  est toujours un logement loué **en entier**, pas un type de chambre parmi d'autres).

## 3. Décisions retenues

- **Le « mélange »** — pas de duplication d'un système de tramos déjà existant : paliers de prix
  par nombre de personnes → réutilise tel quel `price_tiers`/`min_qty`/`max_qty` (spec 08/11) ;
  majoration saison + majoration week-end (nouveau) + inclusiones + dépôt + note → seule partie
  sans équivalent hifago, stockée dans la colonne dormante `stay_rates` réutilisée telle quelle
  (zéro nouvelle colonne pour cette partie).
- **Check-in/check-out en colonnes `time` dédiées**, pas en texte libre dans le JSON comme la V1 —
  cohérence avec le pattern déjà en place pour l'heure de l'evento (`products.start_time`,
  `<Input type="time">`), un vrai gain de structure sans coût.
- **`capacity` distinct de `max_qty`** — `max_qty` borne ce qu'une commande peut demander,
  `capacity` décrit la maison elle-même (« nombre de couchage »). Les deux peuvent diverger sans se
  contredire (ex. tramos plafonnés à 6 personnes alors que la maison dort 8).
- **Aucun nouveau point d'entrée de création** — même lien « + Actividad » déjà réutilisé pour
  camp/evento, l'admin bascule simplement le sélecteur `Tipo` sur « Alojamiento ».
- **RLS directe** pour toutes les nouvelles colonnes — même raisonnement que spec 08/11 (aucun des
  4 critères RPC-only ne s'applique).

## 4. Parcours cible

1. L'admin ouvre `/admin/products/new` depuis le lien « + Actividad » d'un établissement, bascule
   le sélecteur `Tipo` sur « Alojamiento ».
2. Il saisit le nom (ES/EN) et la description (ES/EN, optionnelle) via `LocalizedTextField` —
   identique à l'activité.
3. Il renseigne optionnellement un lieu, des photos, des tags — identique à l'activité.
4. Il définit le prix (simple ou par tramos de personnes) et les bornes min/max d'huéspedes —
   identique à l'activité, mécanisme réutilisé tel quel.
5. Il renseigne optionnellement l'heure de check-in/check-out et la capacité de couchage.
6. Il définit optionnellement les extras (`StayRatesEditor`) : mois de temporada alta + recargo,
   jours de week-end + recargo, inclusiones, dépôt, note.
7. Un seul clic sur « Crear alojamiento » : le produit est créé avec toutes ces colonnes en une
   seule écriture (pas de staging, contrairement aux créneaux d'activité).
8. Redirection vers `/admin/establishments`. L'admin peut ensuite éditer le même alojamiento depuis
   `/admin/products/[id]/edit` — tous les champs, y compris check-in/check-out/capacité/extras,
   dans le même composant `ProductForm`, sans bloc séparé.

## 5. Écran(s)

- **`/admin/products/new`** et **`/admin/products/[id]/edit`** — même composant `ProductForm` que
  l'activité (spec 11), section « Alojamiento » (check-in/check-out/capacité + `StayRatesEditor`)
  gated `type === 'lodging'`, sans condition `!isEditing` (simples colonnes `products`).
- **`StayRatesEditor`** (nouveau, composant UI pur) : 12 cases mois + % saison + note ; 7 cases jour
  + % week-end ; liste d'inclusiones (add/remove) ; dépôt ; note additionnelle.
- Blocs édition existants (`ProductStatusBlock`/`ProductPhotosBlock`/`ProductTagsBlock`) :
  inchangés, `ProductTagsBlock` désormais aussi rendu pour `lodging` (même gating partagé que
  l'activité). `ProductSlotRulesBlock` reste réservé à `activity`.

---

## 10. Décisions tranchées / points ouverts

- **`stay_rates` non consommé au checkout dans cette tranche** — purement définitionnel, comme
  `product_slot_rules` en spec 11. La Tranche 2 (calcul de prix par nuit, calendrier de séjour,
  affichage public) reste à cadrer par Jérôme.
- **Majoration week-end** : extension consciente au-delà de la V1, jours de la semaine configurables
  par produit (`weekend_days`) plutôt qu'une définition fixe Vendredi/Samedi — plus flexible pour
  un établissement dont le week-end commercial diffère (ex. inclut le dimanche).
- **Pas de validation croisée `capacity` vs plafond des tramos de prix** — les deux notions peuvent
  légitimement diverger, cf. §0 cas limites. Limite connue, pas une lacune accidentelle.
- **Titre d'écran contextuel** (« Editar alojamiento » vs « Editar actividad ») ajouté à la marge
  pour cette spec — le libellé générique du lien « + Actividad » sur la fiche établissement, lui,
  reste inchangé (précédent déjà établi avec camp/evento, jamais renommé).

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte, vérification V1 | `src/services/stayService.js`, `src/services/migrations/012_stay_rates.sql`, `src/services/catalogService.js` (racine legacy) ; `docs/00-modele-de-donnees.md` §1 (gap majoration par date/week-end déjà identifié) |
| §0 `type='lodging'` déjà en base | `hifago/supabase/migrations/20260813190232_catalog_core_tables.sql` ; plafond `lodging_cap_exceeded` dans `create_order` (ex. `20260815240000_create_order_qty_bounds_and_tiers.sql`) ; `apps/admin/lib/lists/filters.ts` |
| §3 Check-in/check-out en colonnes `time` | `apps/admin/components/product-form.tsx` (`start_time` de l'evento, précédent direct) |
| §3 Réutilisation `price_tiers`/`min_qty`/`max_qty` | `apps/admin/lib/products/priceTiers.ts` (spec 08, inchangé) |
| §3 `capacity` distincte de `max_qty` | `docs/00-modele-de-donnees.md` §3 ligne « Bornes min/max de quantité par réservation » |

## 12. Documents liés

- [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md) —
  parcours `ProductForm` unifié réutilisé tel quel.
- [`08-admin-gestion-activite.md`](08-admin-gestion-activite.md) — spec qui renvoyait
  « hébergement (lodging) » hors périmètre, désormais couvert ici.
- `hifago/docs/00-modele-de-donnees.md` §1/§3 — audit champ par champ mis à jour par cette spec.
