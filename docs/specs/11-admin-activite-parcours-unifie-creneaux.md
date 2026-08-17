---
id: specs-admin-activite-parcours-unifie-creneaux
titre: "Admin : parcours unifié création/édition d'une activité — i18n nom/description, lieu, photos dès la création, module de créneaux horaires récurrents"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-16
resume: >
  Fusionne NewProductForm/EditProductForm en un seul parcours (créa=édition) pour une activité,
  ajoute nom/description i18n ES/EN via un composant partagé, un lieu optionnel, des photos
  disponibles dès la création, et un nouveau module de règles de créneaux horaires récurrents
  (Tranche 1 : définition admin seulement, la réservation cliente anti-survente est renvoyée à une
  Tranche 2). Activité uniquement.
mots_cles: [admin, gestion activite, parcours unifie, i18n, localized-text-field, lieu, address,
  lat, lon, creneaux, product_slot_rules, horarios, tramos, hifago]
repond_a:
  - "Comment l'admin crée-t-il et édite-t-il une activité dans le même parcours ?"
  - "Comment saisir un nom/une description en espagnol ET en anglais pour une activité ?"
  - "Comment définir un lieu propre à une activité, distinct de celui de l'établissement ?"
  - "Comment définir des créneaux horaires récurrents (ex. jetski, 1h, 10h-21h, lundi-samedi) ?"
---

# Admin : parcours unifié création/édition d'une activité + module de créneaux

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). Suite directe de
> [`08-admin-gestion-activite.md`](08-admin-gestion-activite.md), qui renvoyait explicitement les
> créneaux horaires à « une future spec dédiée » (§2/§10, numéro jamais attribué — `09`/`10` pris
> entre-temps par d'autres sujets). **Implémentée le 2026-08-16**, à la demande de Jérôme, après
> vérification exhaustive de la V1 legacy (`src/services/migrations/*.sql`,
> `src/services/catalogService.js`, `public/admin.js`) pour confirmer qu'aucun champ important n'y
> est laissé de côté — cf. §1.

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

Aucune RPC nouvelle. Toutes les écritures (colonnes lieu, `product_slot_rules`) restent RLS-directe
— aucun des 4 critères RPC-only de `hifago/CLAUDE.md` §3.1 ne s'applique (pas de compteur de
capacité vivant tant que la Tranche 2 n'existe pas ; la `capacity` d'une règle est un paramètre de
définition, jamais un `booked` décrémenté). Même raisonnement déjà tenu pour
`catalog_tags`/`price_tiers`/`min_qty`/`max_qty` (spec 08 §3).

### Modèle de données (delta)

| Table | Statut | Détail |
|---|---|---|
| `products` | colonnes ajoutées | `address text`, `lat double precision`, `lon double precision` — nullable, générique tout type, exposé au formulaire pour `type='activity'` seulement en Tranche 1 |
| `product_slot_rules` | **nouvelle table** | `id uuid pk`, `product_id uuid not null references products(id) on delete cascade`, `weekdays smallint[] not null` (ISO 1=lundi..7=dimanche), `start_time time not null`, `end_time time not null`, `slot_duration_minutes int not null`, `capacity int not null`, `created_at timestamptz not null default now()`. RLS : lecture héritée du produit parent, écriture admin (`is_admin(auth.uid())`) |

Contraintes `product_slot_rules` : `array_length(weekdays,1) > 0`, `weekdays <@ array[1..7]`,
`end_time > start_time`, `slot_duration_minutes > 0`, `capacity > 0`. Pas de CHECK sur la
divisibilité durée/plage ni sur le non-chevauchement entre règles (validation app-side, même
calibrage que `price_tiers`, spec 08).

### Invariants

- Le nom et la description d'une activité sont i18n ES/EN via un composant unique
  (`LocalizedTextField`), utilisé identiquement en création et en édition.
- Le parcours de création et d'édition d'une activité est le **même composant**
  (`ProductForm`) — plus de divergence de champs entre les deux modes.
- Une photo ou une règle de créneau ajoutée pendant la création est rattachée au produit dans le
  **même clic** de soumission que la création elle-même (upload différé, rattachement DB immédiat
  après l'insert) — jamais un second écran/étape visible.
- Un échec de rattachement (photo, tag ou règle de créneau) après un insert produit réussi
  n'annule jamais la création — même discipline que les tags aujourd'hui (spec 08 §9).
- `products.schedule='slot'` n'est **jamais** réutilisé comme marqueur du nouveau module — ce champ
  porte déjà une sémantique différente et documentée (créneau binaire matin/après-midi,
  `docs/01-cahier-des-charges-client.md` lignes 265/489). La seule présence de lignes
  `product_slot_rules` signale qu'une activité utilise des créneaux.
- Lieu et créneaux ne sont exposés dans le formulaire que pour `type === 'activity'` (même gating
  que tags/tramos/min-max, spec 08).

### Cas limites

- Règle de créneau dont la plage n'est pas un multiple exact de la durée (ex. 10:00-10:50, 60 min)
  → le reliquat est simplement ignoré dans la prévisualisation/génération, pas une erreur.
- Échec de l'upload d'une photo ou de l'ajout d'une règle de créneau pendant la création →
  `console.warn`, création déjà réussie non annulée, corrigible depuis l'édition (même discipline
  que spec 08 §9 / spec 04).
- Lieu partiellement renseigné (adresse sans coordonnées, ou l'inverse) → accepté tel quel, aucune
  validation croisée (mêmes colonnes toutes nullables indépendamment, comme `establishments`).
- Suppression d'une activité (`delete_product`, RPC existante) → `on delete cascade` sur
  `product_slot_rules` suffit, aucune modification de la RPC nécessaire.

### Fichiers touchés

Créés : `apps/admin/components/{localized-text-field,slot-rules-editor,product-photos-staged,product-form}.tsx`,
`apps/admin/lib/products/slotRules.ts`,
`apps/admin/app/admin/products/[id]/edit/ProductSlotRulesBlock.tsx`,
`supabase/migrations/<TS1>_product_activity_location.sql`,
`supabase/migrations/<TS2>_product_slot_rules.sql`.
Modifiés : `apps/admin/app/admin/products/new/page.tsx`,
`apps/admin/app/admin/products/[id]/edit/page.tsx`.
Supprimés : `NewProductForm.tsx`, `EditProductForm.tsx`.
Détail complet et traçabilité : §11.

---

## 1. Contexte et problème

`NewProductForm.tsx` et `EditProductForm.tsx` sont aujourd'hui deux composants séparés et
divergents, malgré une note de la spec 08 §3 affirmant à tort un « écran partagé conservé » : la
description n'existe pas du tout à la création, les photos/tags/statut n'existent qu'après coup
(blocs édition séparés), et le nom reste un simple champ ES sans sélecteur de langue (retiré le
2026-08-15, spec 08 §10). Jérôme demande d'unifier ce parcours et d'y ajouter deux briques
manquantes : un lieu optionnel pour l'activité (absent en base, gap déjà noté
`docs/00-modele-de-donnees.md` §3 ligne « Coordonnées géographiques propres ❌ ») et un module de
créneaux horaires récurrents — explicitement renvoyé par la spec 08 (§2/§10) à « une future spec
dédiée » jamais écrite depuis (09/10 pris entre-temps par d'autres sujets).

**Vérification V1 (« refaire pas réinventer », [[hifago_rebuild_not_reinvent]])** — avant d'ajouter
quoi que ce soit, comparaison exhaustive avec l'app legacy en production
(`src/services/migrations/*.sql`, `catalogService.js`, `public/admin.js`) :
- **Tags** (point soulevé explicitement par Jérôme) : aucun système de tags libres n'a jamais
  existé en V1 pour un produit — seulement `products.category`, une valeur unique parmi 6, qui ne
  sert qu'à choisir le carrousel d'affichage sur `/reservar`. Le système multi-tags déjà livré côté
  hifago (spec 08, `catalog_tags`/`product_tag_assignments`) dépasse déjà ce que faisait la V1 —
  rien à ajouter, ce plan garde le mécanisme tel quel dans le parcours unifié.
- **Créneaux horaires** : zéro précédent legacy, même partiel — le seul niveau de granularité
  horaire jamais implémenté en production est un choix binaire matin/après-midi
  (`products.schedule='slot'`). Terrain vierge confirmé, pas une reprise.
- **`cancel_free_days`** (délai d'annulation gratuite par produit, existe en V1) : déjà abandonné
  consciemment côté hifago (`docs/01-cahier-des-charges-client.md` lignes 834-836, décision
  2026-08-11/13 — règle d'annulation désormais fixe et universelle, rien à stocker par produit).
  Rien à ajouter ici.
- Champs jamais structurés en V1 (âge minimum, difficulté, inclusions/exclusions, langue du guide,
  taille de groupe, matériel fourni, point de rendez-vous distinct) : confirmés absents partout,
  toujours noyés dans `description` texte libre — pas un gap par rapport à la V1, hors périmètre de
  cette spec (jamais demandés par Jérôme ici).

## 2. Portée

**In** :
- Fusion `NewProductForm.tsx`/`EditProductForm.tsx` en un seul composant `ProductForm`, consommé
  par les deux pages (`new`, `[id]/edit`).
- Nom et description en i18n ES/EN via un composant partagé (`LocalizedTextField`), identiques en
  création et en édition — réouvre consciemment la décision spec 08 §10 sur le nom (cf. §3).
- Lieu optionnel de l'activité (`products.address`/`lat`/`lon`), distinct de celui de
  l'établissement.
- Photos disponibles dès la création (pas seulement après, comme aujourd'hui).
- Module de définition de créneaux horaires récurrents (`product_slot_rules`) : jours de semaine +
  plage horaire + durée de créneau + capacité, par règle, plusieurs règles par activité.

**Out, explicitement renvoyé à une Tranche 2 (confirmé par Jérôme)** :
- Réservation réelle d'un créneau précis par un client : nouvelle dimension de capacité
  anti-survente dans `create_order` (verrouillage `SELECT...FOR UPDATE` par `(product_id,
  slot_date, slot_start_time)`), sa suite de tests de concurrence dédiée (`CLAUDE.md` §4), et l'UI
  cliente (`apps/web`) de sélection d'un créneau.
- Coexistence ou remplacement de `products.schedule='slot'` (matin/après-midi) par le nouveau
  module — point ouvert, cf. §10.
- Evento/camp : gaps préexistants (formulaire de création jamais éditable) non traités, hors scope
  Jérôme (« on va rester encore sur une activité »).
- Rebranchement de `LocalizedTextField` sur les 4 usages établissement existants — mécanique,
  laissé en lot séparé pour garder ce diff revuable.

## 3. Décisions retenues

- **Réouverture assumée de la décision nom i18n** — spec 08 §10 (2026-08-15) avait retiré
  `nameEs`/`nameEn` au profit d'un champ unique ES. Jérôme redemande explicitement un vrai
  sélecteur ES/EN pour nom **et** description le 2026-08-16 — réouverture tracée ici, pas
  silencieuse.
- **Un seul composant `ProductForm`**, pas deux formulaires séparés ni un wizard multi-étapes —
  résout la divergence create/edit constatée en §1.
- **Photos et règles de créneaux « stagées » en création** : uploadées/définies avant que le
  produit existe, rattachées en base dans le même clic de soumission juste après l'insert —
  reprend le pattern déjà éprouvé en production pour l'établissement (`NewEstablishmentForm.tsx`).
- **`products.schedule='slot'` non réutilisé** comme marqueur du nouveau module — sémantique déjà
  prise (matin/après-midi, cahier des charges client §3a/§3e). La présence de lignes
  `product_slot_rules` suffit comme signal.
- **Une règle de créneau couvre plusieurs jours** (`weekdays smallint[]`), pas une ligne par jour —
  reflète littéralement l'exemple de Jérôme (jetski, lundi à samedi = une seule règle).
- **RLS directe** pour le lieu et `product_slot_rules` — même raisonnement que spec 08 §3 (aucun
  des 4 critères RPC-only ne s'applique).

## 4. Parcours cible

1. L'admin ouvre `/admin/products/new`, choisit l'établissement et le type "Actividad".
2. Il saisit le nom (ES, puis bascule EN si besoin) et la description (ES/EN, optionnelle) via
   `LocalizedTextField`.
3. Il renseigne optionnellement un lieu (recherche d'adresse ou lat/lon manuels).
4. Il ajoute optionnellement des photos (upload/recadrage immédiat, rattachement différé).
5. Il définit le prix (simple ou par tramos) et les bornes min/max de quantité (inchangé, spec 08).
6. Il définit optionnellement une ou plusieurs règles de créneaux (jours, heure début/fin, durée,
   capacité), avec prévisualisation des créneaux générés.
7. Il assigne optionnellement des tags (inchangé, spec 08).
8. Un seul clic sur "Crear actividad" : le produit est créé, puis (non-bloquant) les photos, tags
   et règles de créneaux sont rattachés.
9. Redirection vers `/admin/establishments`. L'admin peut ensuite éditer la même activité depuis
   `/admin/products/[id]/edit` — mêmes champs nom/description/lieu/prix/min-max dans le même
   composant `ProductForm` ; photos/tags/créneaux restent des blocs à sauvegarde immédiate séparés.

## 5. Écran(s)

- **`/admin/products/new`** et **`/admin/products/[id]/edit`** — même composant `ProductForm`
  (prop `product?` optionnelle). Champs `type`/`establishment_id` création-seule (comportement
  préexistant, non modifié). Nom/description/lieu/prix-tramos/min-max/créneaux identiques dans les
  deux modes, réservés à `type === 'activity'` pour lieu/tramos/min-max/créneaux (comme
  aujourd'hui pour tramos/min-max).
- **Bloc `ProductSlotRulesBlock`** (nouveau, édition seulement, même patron que
  `ProductTagsBlock`) : sauvegarde immédiate (« Guardar horarios » → remplace tout le jeu de
  règles).
- `ProductPhotosBlock`/`ProductStatusBlock`/`ProductTagsBlock` existants : inchangés.

---

## 10. Décisions tranchées / points ouverts

- **`schedule='slot'` (matin/après-midi) vs le nouveau module de créneaux libres** — coexistence ou
  remplacement ? Non tranché ici, à trancher par Jérôme avant de concevoir la RPC anti-survente de
  Tranche 2 (le premier n'a jamais été câblé côté hifago de toute façon).
- **Pas de CHECK SQL sur la divisibilité durée/plage ni sur le non-chevauchement entre règles de
  créneaux** — validation app-side uniquement, même calibrage que le non-chevauchement de
  `price_tiers` (spec 08). Limite connue de la Tranche 1, pas une lacune accidentelle.
- **Rebranchement de `LocalizedTextField` sur les 4 formulaires établissement existants** —
  mécanique et à risque quasi nul, mais délibérément laissé en dehors de ce diff (lot séparé).
- **Gap infra test découvert en cours de tâche** : `apps/admin/vitest.config.ts` et
  `apps/web/vitest.config.ts` n'avaient pas `test.environment: "jsdom"` ni `jsdom` en
  devDependency — aucun `.test.tsx` n'existait encore dans le monorepo. Corrigé en prérequis léger
  (une ligne par config), bénéficie à tout le projet, pas seulement cette spec.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte, vérification V1 | `src/services/migrations/*.sql`, `src/services/catalogService.js`, `public/admin.js` (racine legacy) ; `docs/01-cahier-des-charges-client.md` lignes 265/489/834-836 |
| §3 Lieu | `hifago/supabase/migrations/20260814234500_establishment_presentation_fields.sql` (patron `address`/`lat`/`lon`), `apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` (widget `mountAddressAutocomplete`) |
| §3 Photos stagées | `apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` lignes 81-183 (pattern déjà en production) |
| §3 i18n nom/description | `apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` lignes 243-272 (sélecteur de langue à extraire) |
| §0 Créneaux | `apps/admin/lib/products/priceTiers.ts` (miroir de structure), `docs/05-reference-technique.md` §1 (squelette anti-survente, référence pour la Tranche 2 future) |

## 12. Documents liés

- [`08-admin-gestion-activite.md`](08-admin-gestion-activite.md) — spec précédente (tags/tramos/
  min-max/suppression), qui renvoyait explicitement les créneaux ici.
- [`04-gestion-images.md`](04-gestion-images.md) — module photos réutilisé tel quel.
- [`03-admin-creation-etablissement.md`](03-admin-creation-etablissement.md) — précédent lieu +
  patron photos stagées avant existence de l'entité.
- `hifago/docs/00-modele-de-donnees.md` §3 — audit champ par champ mis à jour par cette spec.
