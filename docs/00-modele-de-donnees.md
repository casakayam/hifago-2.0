---
id: refonte-modele-donnees
titre: "Audit du modèle de données cible — entités partagées"
theme: cadrage
statut: brouillon
maj: 2026-08-13
resume: >
  Audit champ par champ des entités centrales (établissement, chambre, produit, compte,
  code partenaire), croisé avec le code actuel et les décisions déjà prises côté client/socio.
  Référence commune aux 3 cahiers des charges — pas de duplication des champs ici.
mots_cles: [modele de donnees, entites, etablissement, chambre, produit, compte, code partenaire]
repond_a:
  - "Quels champs porte chaque entité centrale du nouveau modèle de données ?"
---

# Audit du modèle de données cible

> Document transverse, référencé par `01-cahier-des-charges-client.md` §4,
> `02-cahier-des-charges-socio.md` §4, et `03-cahier-des-charges-admin.md`. Légende :
> ✅ champ existant et suffisant · ⚠️ existant mais à adapter/généraliser ·
> 🌙 **schéma dormant** (colonne déjà là, jamais exposée/utilisée) · ❌ manquant, à ajouter.
> Chaque affirmation est vérifiée dans le code actuel — migrations SQL lues intégralement
> (`src/services/migrations/001` à `014`), pas seulement le résumé de `05-data-model.md`.

## 🌙 Découverte majeure — du schéma dormant, jamais exposé

Une lecture complète des 14 migrations SQL (pas seulement leur résumé documenté) révèle plusieurs
colonnes déjà présentes en base, mais **jamais lues ni écrites par aucun endpoint actuel**. Ce
n'est pas la même chose qu'un vrai manque : c'est du travail de conception déjà fait, qu'il suffit
de brancher plutôt que d'inventer.

| Colonne dormante | Table | Ce qu'elle anticipait déjà |
|---|---|---|
| `cancel_free_days` (défaut 3), `noshow_reversal_pct` (défaut 0.12) | `products` | ~~Une politique d'annulation par produit~~ — **abandonné (2026-08-12)** : la politique d'annulation cible est finalement une règle **fixe et universelle** (jamais de remboursement côté client, cf. client §7/A3), pas un réglage par produit. Ces deux colonnes dormantes ne sont **pas** réutilisées pour cet usage — laissées ici pour l'historique de la découverte, pas comme une piste à suivre. |
| `payout_method` (JSON `{type:'nequi'\|'bancolombia',...}`) | `providers` | Des **coordonnées de paiement par établissement**, pas seulement par identité partenaire (`crm.json`) — exactement la décision « un jeu de coordonnées par établissement » (socio §3g). |
| `lobby_api_token` | `providers` | Un **jeton PMS par prestataire**, pas un compte Lobby unique global — cohérent avec le connecteur PMS généralisé/multi-prestataire déjà décidé (client §5). |
| `policy_snapshot` (JSON + `accepted_at` + `ip`) | `orders` | Un **enregistrement des CGU/CGV acceptées** au moment de la commande. **⚠️ Correction du 2026-08-12, elle-même révisée le 2026-08-12** : une première correction avait déplacé ce champ vers `order_lines`, au motif que chaque établissement d'une commande multi-établissements (client §3e) aurait sa propre politique d'annulation — **prémisse tombée** depuis que la politique d'annulation est devenue une règle **fixe et universelle** (client §7/A3, admin §3g : jamais de remboursement client, quel que soit le produit). Plus besoin de granularité par ligne pour cette raison : toutes les lignes d'une commande sont créées au même instant, donc sous la même version de règles — **`orders` (niveau commande) suffit à nouveau**. Utile pour tracer quelle version des CGV/du barème était en vigueur si ces règles évoluent un jour dans le temps, pas pour une variation par établissement qui n'existe plus. |
| Table `payments` entière (`wompi_transaction_id`, `reference`, `amount_cop`, `status`, `method`, `raw_event`) | — | Un vrai **paiement en ligne déjà scaffoldé pour Wompi** — alors que la direction évoquée (client §1/cadrage) est MercadoPago + Stripe, pas Wompi. **À trancher** : reprendre ce schéma en le généralisant (renommer `wompi_transaction_id` → `gateway_transaction_id`, `method` déjà générique), ou le considérer obsolète et repartir de zéro selon le gateway retenu ? |
| `ledger_entries` (`beneficiary_type/id`, `entry_type`, `status` due/paid/void, `comprobante`, `paid_at`) | — | Une vraie **machine à états de règlement financier** générique — à réutiliser pour le statut de commission acquise/reprise/payée (client §7/A3, socio §3c) plutôt que d'en inventer une autre. |
| `role_agreements` (`document_version`, `document_hash`, `accepted_at`, `ip`, `user_agent`, `revoked_at`) | — | **Ajouté (2026-08-12), repéré tardivement** — c'est très exactement le squelette de la décision « acceptation de contrat obligatoire par rôle » (socio §3a) : version du texte acceptée, horodatage, révocation. L'admin doit voir « accepté / en attente » par capacité (admin §3d) — cette table le permet déjà, il n'y a rien à concevoir, seulement à brancher. Cas d'école de la méthode ci-dessous : elle est restée invisible dans ce document jusqu'à l'audit du 2026-08-12. |

**Conséquence méthodologique** : avant de chiffrer une entité listée ci-dessous, vérifier si un
brouillon de solution existe déjà en base — le corriger/généraliser coûte moins cher que
l'inventer. **Confirmé le 2026-08-12** : un premier passage avait lui-même raté `role_agreements`
(ligne ci-dessus) — cette méthode se vérifie, elle ne se suppose pas une fois pour toutes.

## 🗺️ Google Maps — infrastructure déjà là, jamais branchée aux fiches

Google Maps JS API est **déjà intégrée**, mais uniquement pour géolocaliser les **socios** dans
le CRM admin (`Geocoder`, `DirectionsService`, marqueurs — `public/admin.js`). La clé
`GOOGLE_MAPS_API_KEY` existe déjà (`.env.example`), avec Geocoding + Directions activés. **Aucune
coordonnée lat/lon n'existe en base SQL** pour un établissement ou un produit — les seules lat/lon
du système vivent dans `data/crm.json` (position des socios, pas des lieux vendus).

**Décision (2026-08-11)** : réutiliser cette même infrastructure (clé, Geocoder) pour les fiches
établissement/produit — un lieu se saisit via une adresse **géocodée automatiquement** (comme le
fait déjà l'admin pour un socio), pas une saisie manuelle de lat/lon. Ajoute une vraie colonne
lat/lon en base pour les établissements et produits (aujourd'hui inexistante), condition de la
recherche par rayon déjà décidée (client §2).

## 🌐 Système multilingue — principe transverse (nouveau, 2026-08-11)

**Constat actuel** : le système ES/EN existant (`I18N`, ~230 clés) ne traduit que les **libellés
d'interface** (boutons, titres de section) — le **contenu** saisi par un partenaire ou l'admin
(nom d'un produit, description, accroche) reste toujours en espagnol, jamais traduit
(`docs/2-reference/04-app-reservar.md` : *« Noms produits/chambres... restent en ES »*). Ce sont
deux systèmes différents, à ne pas confondre.

**Décision (2026-08-11)** : la cible a besoin d'un vrai **contenu multilingue saisi par les
partenaires** — un prestataire doit pouvoir entrer sa description, le nom de sa fiche, etc., dans
plusieurs langues, pas uniquement en espagnol avec une interface traduite autour d'un contenu figé.

**Ce qui doit être traduisible** (par le partenaire ou l'admin, champ par champ) : nom de fiche,
accroche, description longue, inclusions/équipements en texte libre, libellés de prix textuels
(evento), libellé d'unité de quantité affiché au stepper (ex. « Horas », « Cant. » — 🌐 ajouté
2026-08-12, même nature que les autres champs de cette liste), pages légales/institutionnelles
(§1 client, mentions légales/confidentialité/CGV/FAQ — la règle d'annulation fixe et universelle,
§7/A3 client, en fait partie comme texte système, pas comme contenu par partenaire).

**Ce qui ne doit PAS être traduit** (reste identique quelle que soit la langue) : identifiants,
tags de catégorisation eux-mêmes (seul leur **libellé affiché** est traduit, comme une clé
d'interface), coordonnées géographiques, prix numériques, codes promo, adresses email/téléphone.

**Décision (2026-08-11) — liste de langues extensible** : ES/EN aujourd'hui, mais la cible ne
doit pas figer la liste des langues dans le code (cohérent avec l'ambition marketplace global,
cf. cadrage) — un pays/marché supplémentaire (ex. portugais pour le Brésil) doit pouvoir s'ajouter
sans redéploiement du code, juste une nouvelle langue de contenu.

**Comportement de repli obligatoire** : une fiche saisie dans une seule langue doit rester
affichable dans les autres — jamais un trou vide faute de traduction. *Détail à trancher au
chiffrage* : afficher la langue disponible telle quelle, ou une langue de repli par défaut
(probablement l'espagnol, langue de saisie la plus probable) ?

*Traçabilité : `public/reservar.js` (`I18N`), `docs/2-reference/04-app-reservar.md` § i18n ES/EN.*

## 1. Établissement / Propriété (hôtel, hostel, maison entière)

**Champs actuels** (`src/config/properties.js`, `products.stay_rates` pour les logements
entiers) : identifiant, prestataire propriétaire, nom (court + complet), badge de catégorie,
mode (`rooms` / `whole_house`), photo de bannière + cadrage, accroche courte (tagline), ordre
d'affichage ; en mode `whole_house` seulement : galerie de photos, grille tarifaire par palier,
saison haute, inclusions (texte libre), dépôt, horaires check-in/out.

| Champ | Statut |
|---|---|
| Photo de bannière, cadrage | ✅ |
| Nom, accroche courte | ✅ |
| Grille tarifaire par palier (logement entier) | ✅ |
| **Galerie de photos** | ✅ **livré (2026-08-14 placeholder Feature 28, généralisé 2026-08-15 par la spec "gestion d'image")** — `establishment_media` + RPC `add_catalog_media`/`reorder_gallery`, bucket partagé `catalog-media`, Route Handler `service_role` de recadrage/conversion. Remplace l'ancien `establishments.photo_urls` (drop), cf. `docs/specs/04-gestion-images.md` et `docs/specs/03-admin-creation-etablissement.md` en-tête. |
| **Coordonnées géographiques** (lat/lon) | ✅ **livré (2026-08-14, Feature 28)** — `establishments.lat`/`lon`, géocodage Google Places réutilisant l'infra déjà construite pour les partenaires. |
| **Adresse/quartier lisible** | ✅ **livré (2026-08-14, Feature 28)** — `establishments.address` (pas de colonne `barrio` séparée, ce niveau reste réservé au CRM partenaire). |
| **Description longue** | ✅ **livré (2026-08-14, Feature 28)** — `establishments.description` (jsonb `{es, en?}`, même pattern que `name`). |
| **Tags de catégorisation** | ❌ absent — aujourd'hui un badge fixe (« Hostel », « Full House ») codé en dur, pas les tags décidés (client §2) |
| **Politique d'annulation** | ✅ **plus un champ par produit (2026-08-12)** — règle fixe et universelle (jamais de remboursement côté client, client §7/A3, admin §3g), rien à stocker par fiche. Les colonnes dormantes `cancel_free_days`/`noshow_reversal_pct` ne sont pas réutilisées pour cet usage. |
| **Coordonnées de paiement par établissement** | 🌙 dormant sur `providers` (`payout_method`) — répond directement à la décision socio §3g, jamais exposée aujourd'hui |
| **Équipements structurés** (Wifi, piscine, etc.) | ❌ absent en mode `rooms` ; seulement du texte libre non structuré (`includes[]`) en `whole_house` |
| `promo_code` posé sur la propriété (Bania) | ⚠️ **incohérent avec la cible** — un code appartient à un partenaire (socio §3b), pas à un établissement. Un partenaire multi-établissements aurait un code par établissement sans raison métier. À corriger : le code reste sur l'identité partenaire, pas sur la fiche établissement. |
| **Horaires check-in/check-out** | ⚠️ existe pour `whole_house` (`stay_seed.check_in/check_out`) ; absent pour le mode `rooms` — à généraliser aux deux modes |
| **Capacité globale** (nb. chambres, capacité max) | ❌ absent au niveau établissement — se déduit aujourd'hui implicitement de la somme des chambres, jamais un champ propre (utile pour un affichage rapide en recherche/listing) |
| **Devise** | ⚠️ toujours COP, implicite nulle part sous forme de champ — non bloquant tant que mono-pays ; à expliciter si un établissement hors Colombie s'ajoute (hors périmètre immédiat, cf. README) |
| **Opéré directement par la plateforme vs partenaire indépendant** | ✅ **livré (2026-08-14, Feature 28)** — `establishments.operated_directly boolean` (attribut générique décidé, admin §3e, remplace le test câblé en dur sur le nom `kayam`). |
| **Identifiant public stable (slug)** | ❌ **toujours ouvert (revu 2026-08-14, Feature 28)** — envisagé puis explicitement écarté de la création d'établissement : aucune page publique établissement n'existe encore dans `apps/web` pour le consommer (contrairement à `products.slug`, réellement lu par `/[locale]/products/[slug]`), l'ajouter aurait été spéculatif. À reprendre quand une fiche établissement publique sera construite ; la question « slug global ou par langue » reste entière. Même besoin pour un tag de catégorie lui-même (aujourd'hui sans identifiant canonique propre). |
| Nom, accroche, description, inclusions/équipements en texte libre | 🌐 **tous multilingues** (cf. section transverse ci-dessus) — aucun n'a aujourd'hui de mécanisme de traduction, seulement une valeur unique en espagnol |

**❌ Gap critique — établissement en mode « chambres » SANS PMS** : le mode `rooms` n'existe
aujourd'hui QUE pour un établissement adossé à un PMS (Casa Kayam/LobbyPMS) — prix et
disponibilité par type de chambre viennent alors entièrement du PMS. **Il n'existe aucun
mécanisme pour un hôtel à plusieurs types de chambres qui gérerait lui-même ses prix et sa
disponibilité, sans PMS.** Seul le mode `whole_house` (une maison louée en bloc, un seul prix)
a un mécanisme non-PMS (`stay_rates` + `product_calendar`) — **et même celui-là ne permet pas un
prix par date précise** (vérifié dans `stayService.quote()`) : le seul levier temporel est un
pourcentage de majoration sur des **mois entiers** (`season.months`), jamais un prix jour par
jour ni même semaine/week-end. `product_calendar` ne porte d'ailleurs **aucune colonne de prix**
— seulement `open`/`capacity`/`closed_slot`.

**Décision (2026-08-11)** : sans PMS, le prix doit pouvoir varier **par date** (comme le
permettrait un vrai PMS), pas seulement par palier de personnes + majoration mensuelle. Ça
implique concrètement, pour la cible :
- une vraie **grille tarifaire par date** (ou par plage de dates), pas un pourcentage global sur
  des mois entiers — à la fois pour un logement entier (généralisation de `stay_rates`) et pour
  chaque type de chambre d'un hôtel non-PMS (aujourd'hui totalement absent, cf. §2) ;
- un identifiant de chambre **propre au système**, pas emprunté à un connecteur PMS (cf. §2) ;
- une fonction de calcul (successeur de `stayService.quote()`) qui cherche le prix par date en
  premier, avec un repli sur un tarif par défaut si aucune date spécifique n'est fixée — pas
  l'inverse.

**Décision (2026-08-12) — patron de stockage : exceptions par date, jamais une ligne par jour
pré-générée.** Point laissé ouvert le 2026-08-11 (« à trancher au chiffrage »), résolu après
audit : le risque exact à éviter est une table qui grossit en `nombre d'établissements × nombre
de chambres × horizon en jours`, non indexée, potentiellement générée des années à l'avance. Le
code actuel a **déjà résolu ce problème pour la disponibilité** — `product_calendar`
(`PRIMARY KEY(product_id, date)`) ne stocke QUE les dates qui dérogent au défaut ; l'absence de
ligne vaut état par défaut, donc la table reste petite quel que soit l'horizon. La future grille
tarifaire par date doit suivre le **même patron sparse/override** (une ligne = une dérogation de
prix à une date donnée, jamais une ligne systématique par jour) — pas le réinventer, et surtout
pas repartir sur une table pré-générée qui recréerait le problème que ce précédent a déjà évité.

Ce point reste le plus structurant de tout l'audit : sans lui, un hôtel indépendant sans PMS
n'a aujourd'hui aucune façon de vendre plusieurs chambres à des prix qui varient dans le temps.

## 2. Type de couchage / Chambre (à l'intérieur d'un établissement en mode « chambres »)

**Champs actuels** : nom, unité de vente (par personne / par deux), capacité, plafond
d'unités réservables — **l'identifiant de la chambre est directement l'identifiant de sa
catégorie côté PMS** (pas un identifiant interne indépendant).

| Champ | Statut |
|---|---|
| Nom, capacité, unité de vente, plafond | ✅ |
| **Identifiant interne indépendant du PMS** | ✅ **livré hors PMS (2026-08-16, spec 13)** — `product_room_types.id` (uuid propre au système), pour un hôtel géré via le nouveau `type='hotel'`. Le gap reste entier pour le mode `rooms` legacy adossé à LobbyPMS (hors périmètre spec 13, cf. §1 gap critique) — deux mécanismes distincts, pas une continuité de celui-ci. |
| **Prix propre** | ✅ **livré hors PMS (2026-08-16, spec 13)** — `product_room_types.price_cop`/`price_tiers`, même mécanisme que `products.price_tiers` (spec 08/12) posé par chambre. |
| **Calendrier de disponibilité propre** | ❌ toujours absent hors PMS — spec 13 est définitionnelle seulement (prix/capacité déclarés, jamais consommés par une réservation réelle), calendrier renvoyé à une Tranche 2 |
| Photos par chambre | ✅ **livré (2026-08-16, spec 13)** — nouvelle table `room_media` (miroir de `product_media`/`establishment_media`), `add_catalog_media`/`reorder_gallery` étendus à `p_entity_type='room_type'` — même chokepoint d'abord signalé, puis étendu le jour même à la demande de Jérôme. Aligné sur `photos[]` de `GET /rooms` LobbyPMS |
| Prix par période (chambre) | ✅ **livré, définitionnel seulement (2026-08-16, spec 13)** — `product_room_types.stay_rates`, réutilise tel quel le mécanisme `stay_rates`/`StayRatesEditor` de l'alojamiento (spec 12). Jamais consommé par `create_order`, cf. §1 |
| Description par chambre | ✅ **livré (2026-08-16, spec 13)** — `product_room_types.description` (jsonb `{es, en?}`), miroir de `descriptions[]` LobbyPMS — 🌐 multilingue |
| **Équipements propres à la chambre** (salle de bain privée, climatisation…) | ❌ absent — aucun champ structuré, seulement le nom de la chambre porte l'information de façon informelle aujourd'hui |
| Nom de la chambre | ✅ **livré (2026-08-16, spec 13)** — `product_room_types.name` (jsonb `{es, en?}`) — 🌐 multilingue |
| **Quantité de chambres du même type** | ✅ **livré (2026-08-16, spec 13)** — `product_room_types.quantity`, absent de tout audit précédent, ajouté par alignement volontaire sur `quantity` de `GET /rooms` LobbyPMS (distinct de `capacity`, jamais demandé avant) |

## 3. Produit vendable classique (activité, transport, alojamiento loué en entier — hors hôtel à
chambres, cf. §2)

Inclut désormais l'alojamiento loué en entier (`type='lodging'`, activé par la spec 12) — les deux
partagent aujourd'hui l'essentiel de leurs champs (cf. tableau ci-dessous).

**Champs actuels** (registre SQLite `products`, cf. `05-data-model.md`) : identifiant, type,
prix, vendable, planification (`schedule`), unité de quantité, capacité par défaut, calendrier
ouvert par défaut, catégorie (liste fixe), ordre d'affichage, prestataire propriétaire, mapping
PMS optionnel, photos.

| Champ | Statut |
|---|---|
| Prix, planification, capacité, photos, description | ✅ |
| **Tags de catégorisation** | ✅ **livré (2026-08-15, spec 08)** — `catalog_tags`/`product_tag_assignments`, multi-valeurs, remplace la catégorie fixe (`products.category`) à l'écran admin direct. Colonne `category` conservée en base, toujours utilisée par le flux socio (`product_proposals`) — migration complète non tranchée, cf. spec 08 §10. |
| **Prix par palier de quantité/personnes** | ⚠️ **livré sous une forme différente (2026-08-15, spec 08 ; étendu 2026-08-16, spec 12)** — `products.price_tiers` (tranches de quantité avec un prix absolu par tranche, résolu côté `create_order`), pas le modèle "seuil + pourcentage de remise sur un prix de base" décrit ci-dessus au moment de l'audit — jamais construit tel quel. Activité **et alojamiento** (`type='lodging'`, spec 12 — `qty` = nombre de personnes, mécanisme réutilisé tel quel plutôt que dupliqué). Toujours hors périmètre pour un hôtel à chambres sans PMS (§2). |
| **Bornes min/max de quantité par réservation** | ✅ **livré (2026-08-15, spec 08)** — `products.min_qty`/`max_qty`, appliquées réellement dans `create_order` (remplace le plafond générique codé en dur `qty > 20`). N'existait dans aucun audit précédent — demandé par Jérôme en cours de session, absent aussi côté legacy pour une activité (`max_units` y est un vestige lodging sans UI). |
| **Suppression réelle d'une activité** | ✅ **livré (2026-08-15, spec 08)** — RPC `delete_product`, garde-fou anti-commande (`order_lines`) fidèle au comportement déjà en place côté legacy (`catalogService.deleteProduct`) — la seule des quatre demandes de la spec 08 qui soit une reprise, pas une extension. |
| **Coordonnées géographiques propres** | ✅ **livré (2026-08-16, spec 11 ; étendu specs 12/13/14)** — `products.address`/`lat`/`lon` (mirror `establishments`), nullable, exposé au formulaire pour `activity`/`lodging`/`hotel`/`transport` |
| **Créneaux horaires récurrents** | ✅ **livré, définition seulement (2026-08-16, spec 11)** — nouvelle table `product_slot_rules` (jours de semaine + plage horaire + durée de créneau + capacité par règle). Aucune génération de créneaux réels ni décrément de capacité live : la réservation anti-survente d'un créneau précis reste une Tranche 2 future, cf. spec 11 §2/§10 |
| **Alojamiento en tant que produit** (`type='lodging'`) | ✅ **activé, définition seulement (2026-08-16, spec 12)** — `type='lodging'` et `products.stay_rates` (jsonb) existaient déjà en base depuis le tout premier schéma catalogue (copiés de la V1), jamais branchés à un écran avant cette spec. Check-in/check-out (`check_in_time`/`check_out_time`, nouvelles colonnes `time`) et capacité de couchage (`capacity`, nouvelle colonne) ; `stay_rates` réactivée pour les extras (saison mensuelle + majoration week-end **nouvelle, absente de la V1** + inclusiones + dépôt + note). Paliers de prix = réutilisation de `price_tiers` (ligne ci-dessus). **Purement définitionnel** : `create_order` ne lit pas `stay_rates`, aucun calendrier de nuitées ni affichage public — Tranche 2 future, cf. spec 12 §2/§10. |
| **Transporte en tant que produit** (`type='transport'`) | ✅ **activé (2026-08-16, spec 14)** — `type='transport'` accepté par le CHECK depuis le tout premier schéma catalogue, jamais exposé à un écran avant cette spec. Aucune nouvelle colonne : réutilise tel quel lieu/tags/`price_tiers`/`min_qty`/`max_qty` déjà posés pour activité/alojamiento. Contrairement à la V1 (une ligne de produit par tarif « hasta N pers. »), les paliers de capacité de véhicule deviennent des tramos de `price_tiers` d'un même produit. Pas de check-in/checkout ni de capacité produit (`schedule='date'`/`capacity_default=NULL` en V1). Aucun changement côté `apps/web` (portail déjà générique) ; pas de reconstruction de la carte transport multi-transporteurs groupée de la V1 — décision explicite, cf. spec 14 §2/§10. |
| **Politique d'annulation** | ✅ plus un champ par produit (2026-08-12) — règle fixe et universelle, cf. §1 ci-dessus |
| **Inclusions/exclusions** (ce qui est compris dans le prix) | ⚠️ **livré pour l'alojamiento (2026-08-16, spec 12)** — `products.stay_rates.includes[]` (texte libre, réactive le champ V1 `stay_seed.includes[]`). Toujours absent pour une activité classique (ex. « casque inclus ») — *à considérer, pas encore décidé*. |
| **Restrictions** (âge minimum, niveau requis, contre-indications) | ❌ absent — pertinent pour des activités type nautique/adrénaline, mais **pas décidé** : à challenger avec Jérôme avant d'ajouter (risque de sur-ingénierie si peu de produits en ont réellement besoin) |
| Nom, description, inclusions en texte libre | 🌐 multilingues (cf. section transverse) |

## 4. Camp et Evento — deux objets fonctionnels distincts

La cible ne doit plus traiter « camp/evento » comme une seule famille dans le parcours client. Ils
peuvent partager certaines briques éditoriales, mais leurs règles métier restent séparées.

### 4a. Camp

Un **camp** est une offre multi-jours réellement vendable : prix numérique, capacité/cupos, date de
départ, durée, programme, publication et calendrier. Sa réservabilité dépend à la fois de sa propre
publication et de la **ressource de disponibilité du prestataire** décrite en §4c.

| Champ | Statut |
|---|---|
| Dates / date de départ, programme, statut | ✅ base existante à généraliser |
| **Durée multi-jours explicite** | ❌ à modéliser proprement pour calculer toute la période consommée |
| **Ressource de disponibilité partagée** | ❌ ajout 2026-08-13 — lien obligatoire vers le calendrier/ressource du prestataire qui organise le camp |
| Lieu structuré / géolocalisation | ⚠️ à unifier avec le champ géographique du produit (§3) |
| Programme et textes éditoriaux | 🌐 multilingues |

### 4b. Evento

Un **evento** est une fiche événementielle distincte du camp. Il naît comme contenu éditorial et
n'est réservable en ligne que si l'admin active explicitement cette possibilité.

| Champ | Statut |
|---|---|
| Dates, programme, statut | ✅ |
| **Occurrence** (ponctuel / récurrent tous les N jours) | ❌ absent — décidé (admin §3c) |
| **Durée propre** (heure de début + longueur) | ❌ absent — décidé (admin §3c) |
| **Lien de réservation externe générique** | ⚠️ aujourd'hui `experiences.whatsapp` uniquement — à généraliser |
| **Ressource de disponibilité partagée si réservable en ligne** | ❌ ajout 2026-08-13 — même moteur d'anti-double-booking que le camp |
| Lieu structuré / géolocalisation | ⚠️ à unifier avec le champ géographique du produit (§3) |
| Programme, libellé de date, libellé de prix | 🌐 multilingues |

### 4c. Ressource de disponibilité / calendrier partagé du prestataire — ajout 2026-08-13

Le calendrier ne peut plus être modélisé uniquement comme une propriété isolée de chaque produit.
Un prestataire doit disposer d'une **ressource de disponibilité partagée** à laquelle sont reliées
les offres qui se concurrencent pour le même temps/équipe. Une réservation sur l'une peut donc
rendre les autres indisponibles.

**Entités/relations à prévoir** :
- `availability_resources` (ou nom équivalent) : ressource/calendrier appartenant au prestataire ou
  à l'établissement ;
- liaison `product ↔ availability_resource` : plusieurs produits peuvent consommer la même
  ressource ;
- blocage de disponibilité sur une **plage** (`start_at`, `end_at` ou dates inclusives), avec
  `source_type` (réservation, fermeture manuelle, PMS...), `source_order_line_id`/commande et motif ;
- la fermeture effective des autres produits est **dérivée de ce blocage partagé**, pas copiée sans
  provenance dans N calendriers de produits.

**Règle camp multi-jours** : pour un camp de N jours démarrant à D, le moteur vérifie toute la
période D…D+N−1. Si UFit a ouvert ses dates du 1 au 6 et que son camp dure 5 jours, le départ du 1
peut être proposé dès lors que les cinq jours nécessaires sont libres.

**Réservation atomique** : la confirmation du camp ou de l'evento réservable crée le blocage de toute la
période dans la même transaction que la réservation. Les autres activités liées deviennent
immédiatement indisponibles sur ces dates. Le message au prestataire est une notification
post-confirmation (« réservation reçue, dates bloquées »), pas une étape dont dépendrait le
blocage.

## 5. Commande / Ligne de commande

Déjà entièrement traité côté cahier des charges client (§3b commission, §3f cycle de vie et
statut d'intégration PMS séparé, §7/A3 statut de commission acquise/reprise) — pas de nouveau
champ à ajouter ici, seulement un rappel : chaque ligne porte désormais un **statut métier**
(réservée/réalisée/absence/annulée/expirée), un **statut d'intégration PMS** séparé, et un
**statut de règlement de commission** (estimée/acquise/reprise/payée) — trois axes indépendants,
jamais un seul champ à statuts multiples qui les confondrait.

**Décision 2026-08-13 — granularité des changements client** : une **modification** de réservation
peut ajouter une ligne, annuler une ligne précise ou remplacer une ligne (date/quantité) ; les
snapshots financiers de la ligne d'origine restent intacts. Une **annulation de réservation** est
une transition de niveau commande qui annule toutes les lignes encore actives. Le modèle doit donc
conserver l'historique des lignes remplacées/annulées plutôt que d'écraser leur contenu.

**🌙 À réutiliser plutôt qu'à réinventer** : la table `ledger_entries` (bénéficiaire, type
d'écriture, statut due/paid/void, justificatif, date de paiement) est déjà une machine à états de
règlement générique — c'est probablement le bon squelette pour le statut de règlement de
commission (estimée/acquise/reprise/payée) décidé plus haut, plutôt qu'un nouveau mécanisme.
La table `payments` (scaffoldée pour Wompi) est le squelette d'un futur paiement en ligne — à
généraliser si le gateway retenu change (cf. découverte majeure), pas à dupliquer.

**❌ Lien commande ↔ compte client, absent.** Le compte client (§6) doit porter l'historique de
ses réservations. Une commande créée pendant que le client est connecté doit donc référencer ce
compte. Une commande invité conserve ses coordonnées de contact mais **ne devient pas une source
d'attribution partenaire persistante par simple rapprochement WhatsApp/email** (décision
2026-08-13). Le rattachement historique éventuel d'une commande invité à un compte est un sujet
d'identité séparé de l'attribution référent.

**⚠️ Ajouté (2026-08-12) — sécurité/conformité : PII rédactible vs données financières
intouchables.** Les mêmes champs de contact (`holder_*`, `comments`) sont de la **PII directe**
sur `orders`, sans lien vers une identité canonique pour un client invité (le parcours par défaut,
client §1). L'outil Habeas Data minimal décidé (admin §3e — retrouver/exporter/supprimer les
données d'une identité) entre en tension avec l'immutabilité déjà actée du ledger (une ligne de
commande n'est jamais recalculée, client §3b/§7-A3) : le modèle doit distinguer explicitement ce
qui peut être **rédigé** sur demande (nom, contact, document — remplaçable par un marqueur type
« supprimé sur demande, le AAAA-MM-JJ ») de ce qui reste **intouchable** (montants, taux,
statuts financiers figés), avec une trace de qui/quand a rédigé — sur le même principe que
`role_agreements.revoked_at`. Sans cette distinction dès la conception, une suppression Habeas
Data littérale casserait soit l'intégrité financière, soit ne sera jamais implémentée par
prudence.

**❌ Ajouté (2026-08-12) — file de réconciliation : le schéma réel ne porte pas encore le cycle
cible.** Le cycle décidé (client §3f) — ouverte → retry automatique (quelques essais espacés) →
résolue manuellement (avec note) ou échec permanent — n'est pas qu'une reformulation : la colonne
réelle `exceptions_queue.status` n'accepte aujourd'hui que `'open'`/`'resolved'` (aucun compteur
de tentative, aucune distinction résolution-manuelle vs échec-permanent-après-retries-épuisés).
À concevoir explicitement, pas à supposer déjà couvert par la table existante.

**❌ Ajouté (2026-08-12) — journal des synchronisations PMS, entité distincte de la file
d'exceptions.** Décidé (admin §3a) : « un journal des synchronisations passées (quand, combien
traité, combien en erreur) — pas seulement le résultat de la dernière ». Aucune table de ce type
n'existe aujourd'hui ; ce n'est pas la même chose que la file de réconciliation ci-dessus (qui ne
trace qu'un incident isolé par commande, pas l'historique des runs de synchronisation eux-mêmes).

## 6. Compte utilisateur (identité unifiée client/socio/admin)

**Champs actuels, fusionnés selon la décision d'identité unifiée** (socio §1) : email,
mot de passe ou identifiant Google, rôles composables (client / référent / prestataire / admin),
profil de base.

| Champ | Statut |
|---|---|
| Connexion, rôles composables | ✅ décidé, à construire |
| **Rattachement « membre d'une organisation »** avec niveau d'accès | ❌ absent — décidé nécessaire (socio §1, multi-utilisateurs), niveaux d'accès non détaillés (renvoyé au chiffrage) |
| **Rôle « propriétaire » de l'organisation** | ❌ **corrigé (2026-08-12)** — à distinguer clairement de la ligne ci-dessus : le socio §1 décide un **invariant ferme**, pas un point ouvert — un propriétaire est *toujours* désigné, seul habilité à retirer un membre, ne peut se retirer lui-même sans transférer ce statut au préalable (anti-compte-orphelin). Noyé jusqu'ici dans la même ligne que les niveaux d'accès (qui, eux, restent réellement à trancher) — deux champs de nature différente, l'un décidé, l'autre ouvert. |
| **Liste des établissements gérés** | ❌ relation multi-établissements (socio §1) à modéliser en plusieurs-à-plusieurs, pas la colonne unique actuelle |
| **Statut de la capacité Prestataire, par établissement** | ⚠️ **corrigé (2026-08-12)** — la ligne ci-dessus ne portait que la cardinalité du lien ; le socio §3a décide une différence structurelle plus profonde : le **statut** de la capacité Prestataire (en préparation/en revue/suspendue/active) doit vivre **sur le lien établissement↔identité**, pas sur l'identité seule — une organisation peut avoir un établissement suspendu et les autres actifs. Aujourd'hui `partner_capabilities` a pour clé `(partner_id, role)` : un seul statut par identité, aucune dimension établissement. La capacité Référent, elle, reste au niveau de l'identité (pas de changement pour elle). |
| **Langue préférée de communication** | ❌ absent — nécessaire pour envoyer les notifications proactives décidées (socio §1) dans la bonne langue ; `orders.lang` existe déjà pour une commande ponctuelle, mais rien n'est mémorisé au niveau du compte lui-même |
| **Canal de notification préféré + journal d'envoi** | ❌ **ajouté (2026-08-12), décidé** — les notifications proactives décidées (socio §1, admin §2 : nouvelle commission, proposition traitée, paiement effectué, nouvelle proposition à modérer, nouvelle exception) n'ont ni préférence de canal (email/WhatsApp) par compte, ni la moindre entité pour les tracer. **Décision (2026-08-12)** : un vrai **journal d'envoi tracé** — quoi, quand, à qui, quel canal, quel statut de remise — même rigueur que les campagnes groupées (migration 014, résout G13) et le journal de synchronisation PMS (§5), pas un mécanisme plus léger. |
| **Attribution partenaire active du compte** | ❌ **ajouté (2026-08-13)** — uniquement pour un compte client enregistré : référence au dernier code partenaire valide reçu + horodatage/source. Un nouveau code valide **remplace** l'attribution active pour les prochaines réservations ; les commandes passées gardent leur snapshot d'origine. Aucun équivalent durable n'est créé pour un invité par simple contact. |

## 7. Code partenaire / attribution référent (ancien code promo)

**Champs actuels** (`partner_codes`) : code, activation de la commission, attribution JSON. Le nom
historique « code promo » ne décrit plus correctement sa fonction cible.

| Champ | Statut |
|---|---|
| **Code partenaire + référent propriétaire** | ⚠️ existant à normaliser/généraliser |
| **Plusieurs codes par partenaire, format lisible + suffixe** | ⚠️ le modèle actuel suppose un code = une identité ; à généraliser (socio §3b) |
| **Actif/inactif + paramètres de commission** | ⚠️ nécessaires au moteur d'attribution 17/10/7 |
| **Avantage client / discount** | 🌙 **capacité dormante, désactivée** — l'ancien 10 % sur l'hébergement n'est plus une règle active. Si un incentive est réintroduit plus tard, il doit être activable séparément de l'attribution (ex. `customer_benefit_enabled=false` par défaut) et ne jamais conditionner la commission. |
| **Attribution persistante** | ❌ vit sur le **compte client enregistré** (§6), pas sur un contact WhatsApp/email : le dernier code valide devient actif pour les réservations futures. |
| **Snapshot par commande** | ✅/⚠️ chaque commande doit conserver le code/référent effectivement utilisé à sa création, même si l'attribution active du compte change ensuite. |

**Supprimé de la cible active le 2026-08-13** : politique « à vie / usage unique par contact »,
choix entre plusieurs codes mémorisés côté navigateur et recherche globale `contact → attribution`.
Ces mécanismes sont remplacés par une règle simple : persistance seulement sur compte enregistré,
**dernier code valide prioritaire**.

## 8. Liaison Établissement ↔ Utilisateur

**Aujourd'hui** : une colonne unique (`providers.partner_id`) — un établissement pointe vers
UNE identité. **Cible** : avec le multi-établissements ET le multi-utilisateurs décidés (socio
§1), c'est une vraie relation **plusieurs-à-plusieurs** (une organisation gère N établissements,
N personnes accèdent à cette organisation) — pas une colonne à généraliser, une table de liaison
à concevoir.

**⚠️ Précision (2026-08-12)** : cette table de liaison ne porte pas que la relation elle-même —
elle doit aussi porter le **statut de la capacité Prestataire** pour cet établissement précis
(cf. §6, corrigé) : suspendre un établissement ne doit pas suspendre les autres gérés par la même
organisation. Un chiffrage qui ne concevrait que la cardinalité, sans y déplacer ce champ statut
depuis l'identité, manquerait la moitié de la décision socio §3a.

## 9. Avis / notes clients (noté pour mémoire — différé, cf. README)

Si activé plus tard : touchera Établissement + Produit (la note se rattache à la fiche) et
Commande (une note ne peut être laissée qu'après une ligne réalisée — pas avant, pas sans achat).
Aucun champ à ajouter maintenant, seulement à garder cette dépendance en tête si le sujet est
rouvert.

## 10. Pages légales/institutionnelles (contenu multilingue)

Décidées en client §1 (mentions légales, confidentialité, contact, FAQ, CGV) — **aucune donnée
n'existe aujourd'hui**, ces pages n'existent pas dans le système actuel.

| Champ | Statut |
|---|---|
| Contenu de chaque page | ❌ absent — à créer, 🌐 multilingue par nature (cf. section transverse) |
| Date de dernière mise à jour (utile pour des CGV/confidentialité) | ❌ absent — à ajouter dès la conception, pas après coup |

## 11. Proposition de fiche (`product_submissions`) — ajouté 2026-08-12

Entité citée en traçabilité par les cahiers socio (§3e/§3f) et admin (§3b), mais jamais auditée
pour elle-même dans ce document — corrigé ici.

**Champs actuels** : type de contenu, cible (`product_id` nullable — NULL = création, renseigné =
modification), statut (en revue/publiée/rejetée/retirée), charge utile JSON, motif de rejet.

| Champ | Statut |
|---|---|
| Distinction création/modification (`product_id` nullable) | ✅ existant |
| **Type de proposition explicite** (fiche classique / correction de camp / nouvelle date de camp / correction d'evento / nouvelle date d'evento / photos seules / grille tarifaire) | ⚠️ **partiellement couvert** — le `product_id` nullable distingue création/modification, mais ne porte ni la nature de la proposition ni la distinction Camp vs Evento. Les règles de cohérence et le geste « corriger » vs « annoncer une autre date » doivent être vérifiables mécaniquement pour chacune des deux familles, sans déduction implicite. |

*Traçabilité : `src/services/migrations/010_product_submissions.sql` ; socio §3e/§3f ; admin §3b.*

## Synthèse

**Premier gap urgent — établissement à chambres sans PMS** : prix variable **par date** (§1/§2).
Sans lui, la généralisation multi-hôtels déjà actée (client §1/§3a) reste théorique pour tout hôtel
à plusieurs chambres sans PMS. Aucun schéma dormant ne couvre ce cas.

**Deuxième gap structurant ajouté le 2026-08-13 — ressource de disponibilité partagée** (§4c) :
le schéma actuel sait ouvrir/fermer un produit, mais ne représente pas qu'un camp multi-jours peut
consommer la même ressource qu'une série d'activités et les rendre indisponibles automatiquement.
Cette relation produit↔ressource et ses blocages avec provenance sont à concevoir explicitement.

**Le plus rentable — du schéma dormant à brancher, pas à concevoir** : coordonnées de paiement
par établissement (`providers.payout_method`), jeton PMS par prestataire
(`providers.lobby_api_token`), CGV/CGU acceptées snapshotées (`orders.policy_snapshot`), machine
à états de règlement (`ledger_entries`). Quatre décisions déjà prises dans ce chantier (socio
§3g, client §5/§1) trouvent déjà un squelette en base — le chiffrage doit vérifier ce schéma
existant avant de concevoir quoi que ce soit à partir de zéro. **Contre-exemple instructif
(2026-08-12)** : `products.cancel_free_days`/`noshow_reversal_pct` semblaient au premier passage
correspondre exactement à la politique d'annulation — ce n'est plus vrai depuis que cette
politique est devenue une règle fixe et universelle (client §7/A3) ; tout schéma dormant qui
« correspond bien » doit être revérifié à chaque nouvelle décision, pas supposé acquis.

**Décision (2026-08-11), rouverte le 2026-08-18** — le paiement en ligne est désormais tranché :
Mercado Pago remplace Wompi comme gateway cible, acompte obligatoire, nouvelle table `payments`
(schéma propre, ne reprend pas le scaffolding Wompi noté ci-dessous comme legacy), nouveau ledger
de règlement (`ledger_entries`) pour tracer les rétributions dues au référent et à l'établissement
avant leur virement Mercado Pago automatique. Voir
`docs/specs/19-paiement-mercadopago-acompte-ledger.md` pour le modèle de données complet et le
découpage en tranches.

**Le troisième axe structurant — contenu multilingue** : quasiment **tout champ texte libre**
saisi par un partenaire ou un admin (noms, descriptions, accroches, inclusions, programmes
d'evento, pages légales) a besoin d'un mécanisme de traduction qui n'existe pas aujourd'hui — le
système actuel ne traduit que l'interface, jamais le contenu. C'est transversal à toutes les
entités listées ci-dessus, pas une entité de plus : à concevoir une seule fois (mécanisme de
stockage par langue + repli), pas champ par champ.

## Deuxième passe — audit multi-agents adversarial (2026-08-12)

Cette première version a elle-même été challengée par 5 angles indépendants (fidélité au code
réel, cohérence avec les 3 cahiers des charges, sécurité/conformité, complétude marketplace,
scalabilité/concurrence), chaque trouvaille vérifiée une seconde fois de façon adversariale avant
correction. 34 trouvailles brutes → 17 confirmées → 14 corrigées directement dans ce document
(ci-dessus, marquées « corrigé/ajouté 2026-08-12 »), et 3 points remontés à Jérôme, tous
désormais tranchés :

1. **Notifications proactives** (§6) — tranché : un vrai journal d'envoi tracé (quoi/quand/qui/
   canal/statut), même rigueur que les campagnes groupées et la synchro PMS — pas un mécanisme
   plus léger.
2. **Grille tarifaire par date** (§1) — tranché : patron sparse/override (cf. §1), pas une table
   pré-générée.
3. **Attribution partenaire** (§7) — décision du 2026-08-13 : la recherche durable par contact est abandonnée au profit d'une attribution attachée au compte enregistré, dernier code valide prioritaire.

Enseignement le plus important de cette passe : même la méthode « vérifier le schéma dormant
avant de concevoir » énoncée par ce document ne s'est pas appliquée à elle-même parfaitement — la
table `role_agreements` (découverte majeure, ligne ajoutée) était restée invisible dans la
première version. Une méthode se re-vérifie, elle ne se suppose pas acquise.

## Troisième passe — clarification du modèle de paiement (2026-08-12)

Correction de fond apportée par Jérôme, pas par un audit : la politique d'annulation devient une
**règle fixe et universelle** (jamais de remboursement côté client, quel que soit le délai ; le
seul reversement possible est une annulation par le prestataire lui-même) — abandon des colonnes
dormantes `cancel_free_days`/`noshow_reversal_pct` qui semblaient pourtant, après le premier audit,
correspondre exactement au besoin. Détail complet et raison d'être en
`hifago/docs/01-cahier-des-charges-client.md` §7/A3 et `hifago/docs/03-cahier-des-charges-admin.md`
§3g. Deuxième enseignement de méthode, en plus de celui ci-dessus : un schéma dormant qui
« correspond bien » à une décision n'est une preuve que jusqu'à la prochaine clarification
métier — se revérifier, ne jamais se figer.


## Quatrième passe — corrections métier du 2026-08-13

Décisions apportées directement par Jérôme et intégrées dans les trois cahiers/architecture :
1. **Camps et eventos séparés** dans le parcours et le modèle fonctionnel.
2. **Remise quantité/personnes hors nuits uniquement** ; aucun palier de ce type sur l'hébergement.
3. **Code partenaire** : plus de champ client ni de remise 10 % active ; attribution/commission
   conservée, incentive futur dormant et découplé. Persistance uniquement pour un compte enregistré,
   avec **dernier code valide prioritaire**.
4. **Modification vs annulation** : modification partielle par lignes ; annulation = commande entière.
5. **Calendrier partagé du prestataire** : un camp ou evento réservable consomme sa durée sur une
   ressource commune ; la réservation bloque automatiquement cette période pour les autres activités
   afin d'empêcher le double booking, puis notifie le prestataire.
