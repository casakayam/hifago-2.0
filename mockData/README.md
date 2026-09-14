#  mockData/ — données de test lisibles et rejouables

Lu par `supabase/scripts/seed-mock-data.mjs` (`/hifago-mock-data`). **Différent de
`supabase/seed.sql`** : pas de reset, pas de purge — chaque item est **créé s'il n'existe pas
encore, jamais retouché s'il existe déjà** (même si ce fichier JSON change ensuite, même si un
admin l'a modifié depuis via l'interface).

## ⚠️ Le piège à connaître avant d'éditer un fichier existant

Comme un item déjà en base n'est **jamais retouché**, éditer le JSON d'un établissement/activité
déjà créé (nouveau champ, nouvelle photo dans `photos/`) **n'a aucun effet** au prochain run. Pour
tester un changement, il faut soit renommer la clé (= créer un nouvel item), soit modifier l'item
existant directement via l'admin.

## Arborescence

```
mockData/
  partners/<clé>.json
  tags/<clé>.json
  tags/<clé>/photos/1.<ext>              # optionnel, une seule photo
  establishments/<clé>.json
  establishments/<clé>/photos/1.<ext>, 2.<ext>, ...
  activities/<clé>.json
  activities/<clé>/photos/1.<ext>, ...
  rooms/<clé>.json
  rooms/<clé>/photos/1.<ext>, ...
  events/<clé>.json                      # type='evento'
  events/<clé>/photos/1.<ext>, ...
  transport/<clé>.json                   # type='transport'
  transport/<clé>/photos/1.<ext>, ...
  camps/<clé>.json                       # type='camp'
  camps/<clé>/photos/1.<ext>, ...
```

`<clé>` = nom de fichier sans extension. C'est une clé de RÉFÉRENCE entre fichiers mock
(`establishment.partner`, `activity.establishment`, `activity.partner`, `activity.tags[]`) et le
nom du sous-dossier photos — **ce n'est jamais la clé d'idempotence en base**. Celle-ci est :
- `partners.email` pour un partenaire (et `person.email` pour son compte de connexion),
- `establishments.slug` / `products.slug` (calculé côté Postgres depuis `name.es`),
- `catalog_tags.slug` (calculé par le script depuis `label.es`).

Deux fichiers du même type ne doivent jamais partager le même `name.es`/`label.es` : le script
refuse de démarrer si c'est le cas (sinon la base créerait un `-2` silencieux au lieu d'un item
distinct).

## Photos — formats acceptés

`jpg`, `jpeg`, `png`, `webp`, tels quels, **aucune conversion**. Le tableau `photos` du JSON fixe
l'ordre d'affichage (`sort`) — ce n'est pas l'ordre alphabétique des fichiers sur disque.

## `partners/<clé>.json`

```jsonc
{
  "email": "hostal-centro-owner@mock.hifago.test",  // requis — clé d'idempotence de l'organisation
  "display_name": "Hostal Centro SAS",              // requis
  "roles": ["operator"],                            // requis, sous-ensemble de ["referrer","operator"]
  "legal_name": null,
  "identification_type": null,
  "identification_number": null,
  "partner_city": "Bogotá",
  "phone": null,
  "code": "MOCK-HOSTAL-CENTRO",   // requis dès que "person" est présent — un seul partenaire par code
  "commission_enabled": true,
  "crm_profile": null,
  "capability_status": "active", // "active" | "suspended"
  "person": {                    // optionnel — omis = organisation sans compte de connexion
    "email": "maria@mock.hifago.test",  // requis si "person" présent
    "password": "MockTest1234!",
    "full_name": "María Restrepo"
  }
}
```
Domaine dédié `@mock.hifago.test`, distinct de `@hifago.test` (comptes de `seed_auth_users.mjs`).

## `tags/<clé>.json`

```jsonc
{
  "label": { "es": "Aventura", "en": "Adventure" },  // es requis
  "photo": "1.jpg"                                   // optionnel
}
```

## `establishments/<clé>.json`

```jsonc
{
  "partner": "hostal-centro-owner",
  "name": { "es": "Casa Mock Centro", "en": "Mock House Centro" },  // es requis
  "description": { "es": "...", "en": "..." },
  "address": "Cra 5 #12-34", "lat": 4.598, "lon": -74.076,
  "operated_directly": false,
  "check_in_time": "14:00", "check_out_time": "11:00",
  "mode": "rooms",                       // "rooms" | "whole_house" | absent
  "contact_phone": "+573001234567",
  "status": "active",                    // "active" | "archived"
  "photos": ["1.jpg", "2.png", "3.jpg"]
}
```

## `activities/<clé>.json`

```jsonc
{
  "partner": "hostal-centro-owner",        // doit être le même partner que l'établissement référencé
  "establishment": "casa-mock-centro",
  "name": { "es": "Tour en lancha", "en": "Boat tour" },
  "description": { "es": "...", "en": "..." },
  "price_cop": 80000, "min_qty": 1, "max_qty": 6,
  "capacity": 6, "default_capacity": 2, "unit": "per_person",  // "per_person" | "per_two" | "per_house" (contrainte CHECK, pas de texte libre)
  "duration_minutes": 90, "start_time": "09:00",
  "external_booking_url": null,
  "slot_rules": [
    { "weekdays": [1,2,3,4,5], "start_time": "09:00", "end_time": "17:00", "slot_duration_minutes": 90, "capacity": 6 }
  ],
  "tags": ["aventura", "familiar"],       // clés de fichier mockData/tags/
  "photos": ["1.jpg", "2.jpg"],
  "_extra_columns": { "category": "aventura" }  // colonnes hors payload RPC, appliquées une seule fois à la création
}
```

## `rooms/<clé>.json` (chambres — `products.type='lodging'`)

Même mécanisme que `activities/`, même RPC (`create_product_from_proposal` gère tous les types de
produit), juste un dossier et des champs différents :

```jsonc
{
  "partner": "user2",
  "establishment": "etablissement2",
  "name": { "es": "Chambre 1" },
  "price_cop": 100000,
  "unit": "per_two",          // "per_person" | "per_two" | "per_house" (enum fermé)
  "capacity": 2,
  "unit_count": 2,            // ⚠️ voir ci-dessous — PAS un fichier par chambre identique
  "lodging_kind": "private",  // "private" | "dorm" | "whole_house"
  "photos": ["1.jpeg", "2.jpeg"]
}
```
`tags` et `photos` fonctionnent comme pour une activité. `activities/` et `rooms/` partagent le
MÊME espace de `slug` (`products.slug` est unique tous types confondus) : deux fichiers, l'un dans
`activities/`, l'autre dans `rooms/`, ne doivent jamais avoir le même `name.es`.

### ⚠️ Un fichier par TYPE de chambre, jamais un par unité identique

Il n'existe plus d'entité "chambre" séparée d'un "type de chambre" (`product_room_types` supprimée,
spec 24) — mais `products.unit_count` (« nombre d'unités de ce type ») sert exactement à ça. Si
l'établissement a 5 chambres doubles identiques au même prix, c'est **UN SEUL fichier**
`unit_count: 5`, jamais 5 fichiers `room1.json`…`room5.json` : la fiche établissement affiche une
carte par produit, donc 5 fichiers identiques donneraient 5 cartes visuellement dupliquées au lieu
d'une carte "Chambre double — 5 disponibles". `resolve_lodging_default_capacity`
(`supabase/migrations/20260913100000_lodging_default_availability.sql`) calcule la disponibilité en
conséquence : `unit_count` réservations concurrentes par nuit pour `private`/`whole_house`,
`unit_count × capacity` (vendu au lit) pour `dorm`.

## `events/<clé>.json` (`products.type='evento'`)

Vitrine éditoriale, jamais réservable (`availabilityScreenFor` renvoie `'none'` pour ce type — pas de
`product_availability`, pas de cupo). Même RPC générique que les autres dossiers.

```jsonc
{
  "partner": "hifago",
  "establishment": "hifago",
  "name": { "es": "Jam Session" },
  "description": { "es": "..." },
  "price_label": "Gratis",              // texte libre, PAS price_cop (nullable pour evento)
  "occurrence_type": "recurring",       // "once" | "recurring"
  "occurrence_date": "2026-09-17",      // "once" : la date ; "recurring" : la date d'ancrage
  "recurrence_frequency_days": 7,       // requis si "recurring"
  "recurrence_end_date": null,          // OU recurrence_end_count, jamais les deux — absents = indéfini
  "recurrence_end_count": null,
  "start_time": "21:00",
  "duration_minutes": 180,
  "external_booking_url": null,         // optionnel
  "tags": ["party"],
  "photos": []
}
```
⚠️ Le formulaire ADMIN n'expose ni `tags` ni `address`/`lat`/`lon` pour `evento`
(`productTypeGating.ts` : `hasTags`/`hasLocationAndTags` excluent `isEvento`) — mais
`create_product_from_proposal` (utilisé ici en direct, pas via le formulaire) écrit `tag_ids` sans
condition de type. Un tag posé par ce script sur un `evento` mock est donc réel en base, juste
invisible/non éditable depuis l'admin pour l'instant.

## `transport/<clé>.json` (`products.type='transport'`)

Même mécanisme que `activities/`, sans `slot_rules` (jamais whitelisté pour ce type) : disponibilité
générique par date via `default_capacity`, comme un `camp`.

```jsonc
{
  "partner": "hifago",
  "establishment": "hifago",
  "name": { "es": "Transporte Guatapé - Medellín" },
  "price_cop": 20000,
  "unit": "per_person",
  "capacity": 20,
  "default_capacity": 20,               // amorce product_availability, comme pour une activité
  "min_qty": 1, "max_qty": 20,
  "address": "Parque Principal, Guatapé", "lat": 6.2326, "lon": -75.1592,
  "tags": [], "photos": []
}
```

## `camps/<clé>.json` (`products.type='camp'`)

Un camp n'a PAS de calendrier ouvert par défaut ni de fenêtre glissante (contrairement à
lodging/activity/transport) : c'est un calendrier de DÉPARTS FIXES, posés une fois à la création via
`departures` — jamais retouchés au rerun (même règle que le reste du système). `price_tiers`
fonctionne pour ce type (branche générique de `create_order`, prix par personne selon la tranche de
`qty` réservée) même si le formulaire admin ne l'expose pas encore pour `camp`.

```jsonc
{
  "partner": "user4",
  "establishment": "etablissement4",
  "name": { "es": "Campamento 1" },
  "description": { "es": "..." },
  "price_cop": 1000000,           // requis (tarif de base / 1ère tranche)
  "price_tiers": [                // optionnel — prix par personne selon la taille du groupe
    { "min_qty": 1, "max_qty": 15, "price_cop": 1000000 },
    { "min_qty": 16, "max_qty": 20, "price_cop": 900000 }
  ],
  "capacity": 20,                 // participants par départ
  "duration_days": 7,             // requis pour camp (contrainte CHECK)
  "departures": ["2026-10-01", "2026-12-01"],  // requis, un par départ — jamais un tableau vide
  "group_discount_threshold_qty": 16,  // optionnel — remise si le remplissage CUMULÉ du départ
  "group_discount_pct": 0.20,          // optionnel — atteint ce seuil ; les deux ensemble ou aucun
  "tags": [], "photos": []
}
```
`group_discount_*` (migration `20260914130000`) est un mécanisme DIFFÉRENT de `price_tiers`
ci-dessus : il porte sur le remplissage cumulé de TOUTES les réservations d'un même départ
(`product_availability.booked`), pas la quantité d'UNE seule réservation — cf.
`docs/specs/36-remise-remplissage-camp.md`.
⚠️ Chaque date de `departures` pose DEUX choses en base, pas une seule : une ligne
`product_availability` (capacité du camp lui-même) ET `duration_days` lignes
`provider_resource_calendar` sur l'établissement (ressource partagée, feature 20) — sans la seconde,
`create_order` refuse toute réservation (`resource_unavailable`) même avec la première posée. Ne
JAMAIS mettre `default_capacity` sur un camp mock : ça réintroduirait un repli automatique sur
n'importe quelle date, contraire au calendrier de départs fixes voulu ici.

## Produit sans partenaire réel — le partenaire plateforme `hifago`

`products.establishment_id`/`partner_id` sont `NOT NULL` — **aucune dérogation** (casserait
`search_catalog`, la liste admin, `ledger_entries` ; précédent déjà tranché :
`docs/specs/14-admin-transporte.md`). Pour un produit géré par l'admin sans socio propriétaire
(événement général, transport inter-villes), rattacher au partenaire mock `partners/hifago.json` +
son établissement `establishments/hifago.json` — jamais laisser `establishment`/`partner` vide dans
le JSON, jamais inventer une dérogation de schéma pour ce cas.

## Limites connues

- Pas de synchro : un item existant n'est jamais mis à jour, seulement créé s'il manque.
- Un seul `code` d'attribution par partenaire (`partner_codes.code` est une clé primaire) : ne pas
  réutiliser le même `code` entre deux fichiers partenaires.
- `mockData/activities/` ne couvre que `type='activity'`, `mockData/rooms/` que `type='lodging'`,
  `mockData/events/` que `type='evento'`, `mockData/transport/` que `type='transport'`,
  `mockData/camps/` que `type='camp'` — un dossier par type, tous les types sont couverts.
