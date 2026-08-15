---
id: specs-gestion-images
titre: "Gestion des images — upload, droits, recadrage, affichage"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-15
resume: >
  Spec du module images hifago : upload + droits + recadrage côté admin/socio sur produits et
  établissements, affichage carrousel optimisé (WebP, lazy loading, mobile) côté client, et le
  remplacement du mécanisme provisoire déjà livré (`establishments.photo_urls`).
mots_cles: [images, photos, upload, storage, crop, recadrage, carrousel, webp, lazy loading, supabase storage, galerie, hifago]
repond_a:
  - "Comment l'admin ajoute-t-il, recadre-t-il et range-t-il les photos d'un produit ou d'un établissement ?"
  - "Comment un socio propose-t-il une photo, et qui la publie ?"
  - "Comment le carrousel client affiche-t-il une galerie, avec quelle optimisation ?"
  - "Supabase seul suffit-il pour stocker et transformer les images, ou faut-il autre chose ?"
---

# Gestion des images — upload, droits, recadrage, affichage

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`, `hifago/apps/web`), pas l'app legacy —
> le legacy est cité tout au long de ce document comme source de vérité comportementale, jamais
> comme cible de modification. Pas de numéro de feature de build attribué (spec écrite puis codée
> dans la même session, comme les specs 01/03).
>
> **Implémenté le 2026-08-15**, dans la foulée de la spec, sans repasser par une approbation
> intermédiaire séparée (même précédent que la spec 01) — migration, Route Handler, composants
> partagés, écrans admin/socio et tests e2e livrés d'un seul tenant. Fichiers réels en annexe §11.
> Point signalé à Jérôme lors du gate `/hifago-review` : deux nouvelles dépendances UI
> (`react-easy-crop`, `embla-carousel-react`) hors de la carte `/hifago-ui` déjà tranchée — choix
> documenté et justifié en §10, mais jamais tranché seul par convention, à confirmer.
>
> **Remplace un mécanisme déjà livré.** `docs/specs/03-admin-creation-etablissement.md` (Feature
> 28, implémenté) a posé, en `hifago/supabase/migrations/
> 20260814234500_establishment_presentation_fields.sql`, `establishments.photo_urls text[]` + un
> bucket Storage public en écriture admin seule — en se qualifiant lui-même explicitement de
> version « basique et provisoire » : *« Photos = version basique et provisoire, assumée comme
> temporaire [...] Jérôme écrira une spec dédiée "gestion d'image" séparée pour le service
> définitif »* (`03-admin-creation-etablissement.md:129-136`). Ce document **est** cette spec.

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

**En production (app legacy), la gestion d'image est fragmentée en deux pipelines radicalement
asymétriques pour une même finalité — la photo de produit.**

- **Admin** (`src/middleware/imageUpload.js:12-28`) : Multer en `diskStorage`, écrit directement
  sur le volume persistant, nom de fichier UUID. **Aucune transformation** — le fichier original
  (JPG/PNG/WebP selon ce qu'envoie l'admin) est stocké tel quel. Limite `8 Mo`/1 fichier
  (`imageUpload.js:26`), formats filtrés à l'upload (`imageUpload.js:27`), **aucune limite de
  nombre de photos**.
- **Socio** (`src/services/mediaService.js:157-229`, `processPartnerImageAsWebp`) : Multer en
  `memoryStorage` (`imageUpload.js:30-36`), conversion **forcée** en WebP côté serveur via Sharp —
  relit le vrai type de fichier, applique la rotation EXIF puis strip les métadonnées, redimensionne
  à 2400 px max sans agrandir, encode WebP qualité 82 (alpha 90), écriture atomique. Garde-fou
  d'admission avant lecture du multipart (`imageUpload.js:66-127`) : 5 requêtes concurrentes max,
  timeout 90 s. Limite 8 Mo, **6 photos max par fiche** (`MAX_PHOTOS`, `src/services/
  submissionService.js:29`), rate-limit 30 req/15 min par partenaire (`src/routes/
  partnerRoutes.js:18-29`).

**Aucune lib de crop côté front nulle part** (ni admin ni socio) — le recadrage n'existe pas dans
le produit actuel. Le seul palliatif est `hero_position`/`hero_size` (`src/config/
properties.js:38-41`), une position CSS (`object-position`) tapée à la main par l'admin *parce
qu'il ne peut pas recadrer l'image envoyée* — un contournement de l'absence de crop, pas une
fonctionnalité à reproduire.

**Carrousels et galeries client sont 100 % faits maison en JS vanilla** (aucune lib Swiper/Slick/
Splide) : carrousel 3D des activités (`public/reservar.js:1993-2200`, transform CSS calculé à la
main), lightbox photo chambres/maison (`public/reservar.js:1590-1730,1839-1865`, dots, prev/next,
apparaît seulement si `photos.length > 1`), swipe tactile seuil 45 px avec `touch-action: pan-y`.
Le lazy loading n'est posé qu'ponctuellement (`loading="lazy"` en JS, `public/reservar.js:2574`),
jamais sur le carrousel 3D ni le lightbox, sans `IntersectionObserver`.

**Le stockage est un filesystem local sur le volume Fly.io** (`fly.toml:11-14`,
`src/services/db.js:29`, `MEDIA_DIR` dans `src/services/mediaService.js:13`), servi en lecture
publique directe par `express.static` (`server.js:159`) — aucun CDN, aucune URL signée, aucune
génération de variantes responsives/srcset. `data/media/` **n'est pas sauvegardé par l'app**
(`src/services/backupService.js:26,46-65` ne couvre que les JSON + le `.db` SQLite) — angle mort
déjà documenté (`docs/2-reference/07-operations.md:103-105`).

**Une faille de sécurité est ouverte sur ce périmètre en legacy** (`docs/4-pilotage/
backlog.md:871-894`, carte C29) : sur les routes d'upload, Multer parse le corps multipart **avant**
que l'authentification soit vérifiée — un fichier peut être écrit sur disque avant tout contrôle
d'identité. Contrainte à ne pas reproduire (§8).

**Côté hifago, un mécanisme provisoire a déjà été livré et appelle son propre remplacement.** La
migration citée en tête de document a ajouté `establishments.photo_urls text[]` (tableau plat,
sans id de ligne ni service de rangement partagé) et un bucket `establishment-photos` public,
écriture réservée à l'admin, **sans update/delete**. Cette spec la remplace par un vrai modèle
relationnel (§6). Deux gaps déjà identifiés dans les cahiers des charges validés motivent aussi ce
travail : la galerie d'un établissement **n'existe aujourd'hui qu'en mode `whole_house`**
(`hifago/docs/00-modele-de-donnees.md:105`, à généraliser aux deux modes) et le payload de
`product_proposals` (`hifago/supabase/migrations/20260813234500_product_proposals.sql:98-100`) ne
whiteliste que `name/description/price_cop/category` — **aucun champ photo**, alors que le cahier
des charges socio décrit un type de proposition « photos seules » (§3f) non encore codé.

## 2. Portée

**In** :
- Upload, recadrage et droits admin sur produits et établissements (galerie généralisée aux modes
  `rooms` et `whole_house`, comble `00-modele-de-donnees.md:105`).
- Proposition « photos seules » côté socio + écran de modération admin dédié.
- Retrait/réordonnement direct par le socio de sa propre galerie déjà publiée.
- Affichage client : carrousel/galerie paramétrable, swipe mobile, lazy loading, conversion WebP.
- Remplacement du mécanisme provisoire `establishments.photo_urls` / bucket `establishment-photos`
  (migration corrective, §6).

**Out, explicitement renvoyé ailleurs** :
- **Comprobantes de paiement** — nature différente (justificatif, pas photo catalogue), déjà
  couverte par un service de stockage à part (`src/services/storageService.js` en legacy) ; sujet
  à la contrainte G5 (§3) mais hors du service de rangement d'images de ce spec.
- **Avatar utilisateur / logo partenaire** — n'existent pas en legacy, aucune décision validée à
  ce jour ; à spécifier séparément si le besoin apparaît.
- **Import des photos LobbyPMS** — l'API Lobby renvoie un champ `photos` par propriété/chambre
  (`docs/3-integrations/lobby_pms_api.md:115-116`), mais `src/services/lobbyService.js` ne le
  consomme jamais en legacy (vérifié, zéro référence à `photo`/`image`). Comportement déjà
  volontairement ignoré par le produit actuel, pas un gap que ce spec doit corriger.
- **Options de transformation avancées** (Supabase Storage Image Transformations payantes) —
  écartées pour ce périmètre (§10), pas un prérequis bloquant si un besoin futur de srcset plus
  fin apparaît.

## 3. Décisions retenues

Décisions déjà actées ailleurs, non rouvertes ici :

- Supabase Storage, buckets Supabase, **aucun service tiers** (`hifago/docs/
  04-architecture-cible.md:644-654`).
- **Photos de catalogue publiques en lecture.** La règle « buckets privés uniquement, jamais
  d'URL publique permanente » (`04-architecture-cible.md:646-649`) visait à l'origine les fichiers
  porteurs de PII (justificatifs — gap G5, fuite déjà survenue en legacy). Décision explicite avec
  Jérôme (2026-08-14) : les photos de catalogue (produits, établissements) restent **publiques en
  lecture** — nécessaire pour le SEO, le cache CDN et l'`og:image` déjà en place en legacy
  (`docs/2-reference/01-architecture.md:145-161`), et fidèle à la prod qui sert déjà tout en
  public. **Le vrai levier de droits n'est pas lecture publique/privée, mais qui peut créer /
  éditer / supprimer** — matrice complète en §8.
- **Plafond de galerie : 6 photos, uniforme** entre produits et établissements (décision explicite
  avec Jérôme, 2026-08-14) — fidèle au `MAX_PHOTOS` legacy, pas de règle spéciale par entité.
- **Invariant socio §3f textuel** (`hifago/docs/02-cahier-des-charges-socio.md:455-464`, validé
  2026-08-11) : *« un prestataire n'introduit jamais de contenu non modéré dans le catalogue
  public »* — retirer/réordonner = écriture directe, **ajouter** = toujours modération.
- **Admin et socio partagent le même service de rangement/couverture** (`hifago/docs/
  03-cahier-des-charges-admin.md:275-276`, §3c, validé 2026-08-11) : *« un classement fait d'un
  côté est vu de l'autre, une seule vérité sur l'ordre d'une galerie »*.
- Toute écriture admin est auditée nominativement (`log_admin_action`, pattern déjà en place dans
  `create_establishment`/`moderate_product_proposal`).
- **Aucun fichier utilisateur dans le dépôt versionné** (`03-cahier-des-charges-admin.md:604-608`,
  G5) — lié à la fuite PII déjà survenue en legacy (justificatif de paiement retrouvé dans
  l'historique git).
- Vider entièrement une galerie est permis, repli générique déduit du nom conservé (socio §3f,
  `02-cahier-des-charges-socio.md:483-493`).
- **Preview socio confinée à `apps/admin`** (décision explicite avec Jérôme, 2026-08-14, tranchant
  le point renvoyé « au chiffrage » par `02-cahier-des-charges-socio.md:473-481`) : un aperçu isolé
  qui rejoue photo + texte proposés, pas de mode preview sur la route publique `apps/web`.

## 4. Parcours cible

1. **Admin ajoute/recadre/réordonne une photo** (produit ou établissement) — dépôt → aperçu →
   recadrage (modal crop) → confirmation → upload → écriture directe RPC (`add_catalog_media`,
   §7), auditée.
2. **Socio propose une photo sur sa fiche déjà publiée** — dépôt → recadrage → soumission
   (`submit_photos_proposal`, §7) → apparaît dans l'écran de modération admin, avec l'aperçu isolé
   décidé en §3 → l'admin approuve (n'ajoute QUE les images, jamais d'autre champ, miroir de
   l'invariant déjà codé pour `moderate_product_proposal` sur le texte) ou rejette avec motif.
3. **Socio retire/réordonne ses propres photos déjà publiées** — action immédiate, écriture directe
   RLS (`reorder_gallery`/suppression de ligne, §7), jamais de passage par modération pour ce sens.
4. **Client sur `/guatape` ouvre une fiche** — galerie/carrousel avec lazy loading, swipe si mobile,
   dots visibles seulement si `photos.length > 1` (comportement legacy exact conservé,
   `public/reservar.js:1649`).

## 5. Écran(s)

Trois emplacements d'upload admin, un bloc réutilisable commun :

1. **Fiche produit** (create/edit, `apps/admin`) — galerie ordonnée, couverture = première photo.
2. **Fiche établissement** — galerie généralisée aux deux modes `rooms`/`whole_house` (remplace
   `photo_urls`).
3. **Écran de modération des propositions socio** (`/admin/proposals`, extension de l'écran déjà
   utilisé pour les propositions de contenu) — l'admin voit l'aperçu isolé de la photo proposée
   côte à côte avec la galerie déjà publiée, peut corriger/recadrer avant d'approuver (même pattern
   que la correction de payload texte déjà en place), approuve ou rejette avec motif.

Bloc réutilisable, un seul composant partagé (`packages/ui`) : zone de dépôt (drag & drop +
sélection fichier) → aperçu → modal de recadrage (§10, `react-easy-crop`) → confirmation → barre de
progression → grille de galerie réordonnable par glisser (drag), bouton de suppression par photo.

Côté socio (`apps/admin`, section `/partner`) : même grille de galerie en lecture/réordonnement
pour ses propres fiches publiées, plus un point d'entrée « proposer une photo » qui ouvre le même
bloc de dépôt/recadrage mais soumet en `submit_photos_proposal` au lieu d'écrire directement.

Côté client (`apps/web`) : un composant carrousel unique paramétrable (mode « galerie »/dots pour
fiche produit et établissement, mode « hero » pour la mise en avant) — voir §10 pour le choix de
la lib.

## 6. Modèle de données

| Table | Statut |
|---|---|
| `product_media` *(nouvelle)* | N'existe pas encore côté hifago. Miroir du `product_media` legacy (`src/services/migrations/006_experiences_media.sql`) : `id uuid`, `product_id uuid references products(id) on delete cascade`, `storage_path text not null`, `sort int`, `created_at timestamptz not null default now()`. Couvre **tous** les types `products` existants sans distinction — `lodging`/`activity`/`transport`/`tour`/`camp`/`evento` : `products.type` a déjà été étendu à `camp` (feature 20, `20260814220000_camp_multiday_booking.sql`) et `evento` (feature 21, `20260814190000_products_evento_vitrine.sql`), consolidant ce que le legacy séparait en `products`/`experiences` — `product_media` n'a donc **pas besoin** d'un `experience_media` séparé, contrairement à ce qu'une première lecture du schéma (limitée à `20260813190232_catalog_core_tables.sql:13`, avant ces deux migrations) avait laissé penser. |
| `establishment_media` *(nouvelle)* | Mêmes colonnes, `establishment_id uuid references establishments(id) on delete cascade`. Remplace `establishments.photo_urls` — généralise la galerie aux deux modes d'établissement, comble `hifago/docs/00-modele-de-donnees.md:105`. |
| `establishments.photo_urls` | **Dépréciée par migration corrective** de `20260814234500_establishment_presentation_fields.sql` — colonne droppée directement (table encore sans donnée réelle en dehors du seed synthétique, même raisonnement que la migration d'origine, qui s'appuyait déjà sur ce fait pour ne pas prévoir de backfill). |
| Bucket Storage `establishment-photos` | Renommé en bucket unique **`catalog-media`** (ou équivalent), objets nommés en UUID, dossiers `products/`/`establishments/` pour la lisibilité — miroir exact de `data/media/` legacy, qui sert déjà produits et expériences depuis un même répertoire. Policies réécrites (§8) pour couvrir création/suppression socio sur sa propre galerie, pas seulement l'admin. |
| `product_proposals.kind` *(nouvelle colonne)* | `text not null default 'content' check (kind in ('content', 'photos'))` — distingue une proposition de contenu (déjà existante, `20260813234500_product_proposals.sql`) d'une proposition « photos seules » (socio §3f). Payload pour `kind = 'photos'` : `{photos: [{storage_path, sort}, ...]}`. |
| `hero_position` / `hero_size` (`src/config/properties.js:38-41`) | **Explicitement non repris.** Palliatif de l'absence de crop en legacy — obsolète une fois le recadrage posé côté upload (l'image stockée est déjà cadrée au pixel près, plus besoin d'un second champ de repositionnement au rendu). À documenter comme un retrait assumé, pas un oubli. |

## 7. Contrat API/RPC

Squelette de sécurité repris de `hifago/docs/05-reference-technique.md` (identique aux RPC admin
voisines `create_establishment`/`grant_capability`) — `security definer`, `set search_path = ''`,
vérification de rôle en entrée, `log_admin_action` pour toute écriture admin.

```
add_catalog_media(
  p_entity_type text,      -- 'product' | 'establishment'
  p_entity_id uuid,
  p_storage_path text,
  p_sort int default null
) returns uuid
```
Admin uniquement (`is_admin(auth.uid())`), RPC — audit nominatif, pas de compteur de capacité donc
pas de `SELECT ... FOR UPDATE`.

```
submit_photos_proposal(
  p_entity_type text,      -- 'product' | 'establishment'
  p_entity_id uuid,
  p_storage_paths text[]
) returns uuid
```
Socio, miroir de `submit_product_proposal` — mêmes garde-fous d'identité/propriété/capacité
(`assertCanSubmit`, ownership), plus un plafond **COUNT-based** dans la RPC elle-même : nombre de
photos de la galerie existante + proposées ≤ 6 (§3), nombre de propositions en attente par
partenaire ≤ `MAX_PENDING_PER_PARTNER` (déjà en place pour les propositions de contenu, réutilisé
tel quel).

```
reorder_gallery(
  p_entity_type text,          -- 'product' | 'establishment'
  p_entity_id uuid,
  p_ordered_media_ids uuid[]
) returns void
```
Seule RPC dédiée au geste socio « retirer/réordonner », malgré l'absence de compteur de capacité —
justifiée non par l'audit (une RLS directe suffirait pour un simple `UPDATE`/`DELETE` ligne par
ligne) mais par l'**atomicité** exigée par l'invariant admin §3c (« liste complète réécrite en une
seule opération ») : un enchaînement de `.update()` PostgREST depuis le navigateur ne garantit pas
cette atomicité en cas d'échec partiel. Le simple **retrait** (suppression d'une ligne) reste une
opération **RLS directe**, déjà atomique en soi (§8).

```
POST /api/upload/[entity]   (Route Handler Next.js, apps/admin)
```
Vérifie la session Supabase **avant** `request.formData()`/toute lecture du body (contre C29, §1) ;
buffer 100 % en mémoire, **jamais** `fs.writeFile` (contre G5, §3) ; pipe vers `sharp` — rotate EXIF
→ strip métadonnées → resize 2400 px max sans agrandir → encode WebP q82/alpha90 (paramètres
legacy repris à l'identique, `src/services/mediaService.js:165-229`) ; écrit dans Storage via
`service_role`. La file d'admission en mémoire de process (`activePartnerImageRequests`,
`mediaService.js:38-122`) **n'est pas portée** — état de process Node partagé, structurellement
impossible à reproduire sur des invocations serverless isolées (chaque appel de Route Handler a sa
propre mémoire) ; le filet de concurrence devient la limite de la plateforme + le plafond Postgres
ci-dessus (§10).

## 8. Règles et invariants

**Matrice de droits :**

| Action | Admin | Socio |
|---|---|---|
| Ajouter une photo à un produit/établissement | Écriture directe (RPC `add_catalog_media`) | Propose seulement (RPC `submit_photos_proposal`), jamais de publication directe |
| Retirer/réordonner une photo déjà publiée | Écriture directe, sur n'importe quelle fiche | Écriture directe (`reorder_gallery`/suppression), **uniquement sur sa propre fiche** (ownership `partner_id`↔établissement/produit vérifiée dans la RPC) |
| Approuver/rejeter une proposition photo | Seul chemin qui publie une image socio | — |
| Recadrer une image avant upload | Oui (composant partagé, §5) | Oui (même composant partagé) |

- Auth vérifiée **avant** tout traitement du fichier (contre C29) — invariant testable en e2e :
  upload sans session → 401, aucun objet créé dans le bucket.
- **Aucune écriture disque locale à aucune étape** (contre G5) — recadrage en mémoire navigateur
  (canvas), upload en mémoire Route Handler, écriture directe Storage.
- L'approbation d'une proposition « photos seules » n'écrit **que** les tables média — jamais les
  colonnes de contenu, même si l'écran affiche les deux côte à côte (miroir exact de l'invariant
  admin §3b déjà codé pour le texte).
- Échec d'effacement du fichier physique après suppression réussie en base **jamais** remonté comme
  une erreur à l'utilisateur (reprise verbatim de l'invariant socio §3f).
- Dots/contrôles de navigation du carrousel visibles **seulement si** `photos.length > 1`
  (comportement legacy exact conservé).
- Le premier slide visible d'un carrousel (LCP) est toujours chargé en **priorité** (`priority`),
  jamais `lazy` — les slides suivants restent `loading="lazy"` même montés hors-écran par la lib de
  carrousel (nuance `next/image` + carrousel à respecter explicitement, sinon régression Core Web
  Vitals silencieuse, §10).

## 9. Cas limites

- **Proposition photo sur une fiche déjà à 6/6** → refus explicite avec motif, pas un ajout
  partiel.
- **Galerie vidée entièrement par le socio** → repli générique déduit du nom (déjà décidé, socio
  §3f) — à vérifier lors du chiffrage si ce repli est déjà câblé côté hifago pour produits et
  établissements ; sinon, signaler comme dépendance non couverte par ce spec, pas silencieusement
  supposée acquise.
- **Upload interrompu en cours de conversion Sharp** (timeout/déconnexion) → aucun objet orphelin
  dans Storage, aucune ligne en base (best-effort cleanup si l'écriture Storage a réussi mais pas
  l'insertion en base).
- **Format non supporté (HEIC notamment)** — jamais géré ni en legacy ni prévu ici → message
  d'erreur explicite, pas un plantage silencieux. Gap connu, non résolu par ce spec (§10).
- **Admin corrige/remplace une photo pendant la modération d'une proposition socio** → le contenu
  corrigé prime, jamais silencieusement écrasé par l'original proposé (même pattern que pour le
  texte).
- **Deux admins réordonnent la même galerie en même temps** → dernière écriture gagne, pas de
  verrou optimiste nécessaire — cohérent avec le calibrage bas-risque déjà retenu pour
  `moderate_product_proposal` (pas le harnais de concurrence réservé à l'anti-survente).

## 10. Décisions tranchées / points ouverts

**Décisions actées avec Jérôme (2026-08-14, à ne pas rouvrir)** — bucket public en lecture pour le
catalogue (§3), plafond de galerie 6 photos uniforme (§3), preview socio confinée à `apps/admin`
(§3).

**Recommandations tranchées ici, ancrées dans l'existant ou un gap explicite :**

- **Supabase seul ne suffit pas à tout gérer, mais aucun service tiers n'est requis.** `sharp` en
  Route Handler pour le pipeline canonique d'upload (reprise 1:1 des paramètres déjà prouvés côté
  socio legacy), **pas** les Image Transformations payantes de Supabase Storage
  (`04-architecture-cible.md:650-654`, ~5 $/1000 images au-delà de 100 gratuites) pour ce
  périmètre. Trois raisons : (1) Transformations ne fait qu'un rendu à la volée sur l'**original**
  stocké tel quel — l'original brut (EXIF potentiellement géolocalisé) resterait présent dans
  Storage, contrairement au ré-encodage à l'upload qui neutralise ça structurellement ; (2) le
  recadrage interactif choisi par l'admin/socio doit de toute façon se produire côté client
  (canvas) — Transformations ne fait que resize/format via paramètres d'URL fixes, pas un
  recadrage arbitraire ; (3) `next/image` (déjà dans le stack Vercel, gratuit) couvre déjà le
  besoin de variantes responsives/lazy à la livraison. Transformations reste une option future non
  bloquante, jamais un prérequis pour ce spec.
- **`react-easy-crop`**, pas `cropperjs`, pour le module de recadrage. Argument : headless (aucune
  UI/CSS embarquée, juste la géométrie de crop + un callback pixel) — l'admin/socio habille avec
  des composants HeroUI (Slider pour le zoom, Button pour confirmer) sans dupliquer un second
  design system, contrainte non négociable `hifago/CLAUDE.md` §2 point 2. `cropperjs` embarque sa
  propre UI, imposerait un habillage bien plus lourd. À wrapper dans
  `packages/ui/src/components/image-crop.tsx`.
- **Embla**, pas un portage fidèle du carrousel 3D maison (~400 lignes vanilla), pour le composant
  carrousel client — seul endroit de ce spec où la recommandation s'écarte explicitement d'un
  portage fidèle de l'implémentation legacy, tout en préservant le *comportement* (swipe, dots
  conditionnels, navigation clavier, style visuel par-dessus). Le carrousel maison n'est pas une
  décision de conception délibérée à préserver, c'est un palliatif de l'absence de composant
  réutilisable à l'époque — porter fidèlement cette logique de gestes tactiles en React
  réinventerait une physique de swipe déjà résolue par une lib mûre, avec plus de risque de
  régression (bugs de gestes tactiles notoirement subtils) que de bénéfice de fidélité. Embla est
  headless (même raisonnement que pour le crop), suit le patron déjà validé pour les libs
  additionnelles tranchées (react-day-picker, FullCalendar, TanStack Table, `hifago/CLAUDE.md` §2
  point 2). Un seul composant `packages/ui/src/components/carousel.tsx`, sert aussi à généraliser
  la galerie établissement.
- **`next/image` suffit** pour le lazy loading/srcset, une fois `images.remotePatterns` configuré
  vers le host Supabase Storage — avec la nuance obligatoire du premier slide `priority` (§8), à
  écrire noir sur blanc plutôt que supposée acquise.
- **RPC vs RLS** : ajout (admin, toute entité) = RPC (audit nominatif, `CLAUDE.md` §3.1). Ajout
  (socio) = RPC via la file de modération étendue — jamais de RLS d'écriture directe, cohérent avec
  l'invariant « jamais de contenu non modéré ». Retrait (socio, sa propre galerie déjà publiée) =
  RLS direct. Réordonnement = seule exception, RPC dédiée `reorder_gallery` justifiée par
  l'atomicité, pas l'audit (détail §7).
- **Rate-limit** : plafond Postgres COUNT-based à l'intérieur de la RPC (réutilise le pattern déjà
  en place `MAX_PENDING_PER_PARTNER`), pas un rate-limiter en mémoire de process (ne porte pas sur
  du serverless) ni un service externe (Upstash etc.) à ajouter pour ce seul besoin.
- **Bornes reprises telles quelles**, sauf raison contraire déjà documentée : 8 Mo/fichier,
  formats JPG/PNG/WebP (HEIC explicitement non supporté), WebP q82/alpha90, 2400 px max sans
  agrandir, 6 photos/galerie.

**Points réellement laissés ouverts** (à trancher au chiffrage, pas dans ce spec) :
- Support HEIC — gap connu, non résolu ici.
- Confirmation que le repli générique (photo déduite du nom) est déjà câblé côté hifago pour
  produits et établissements, ou reste à construire (§9).

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte (pipelines legacy) | `src/middleware/imageUpload.js:12-127`, `src/services/mediaService.js:1-229`, `src/config/properties.js:31-45`, `public/reservar.js:1590-2200,2574`, `src/services/backupService.js:26,46-65`, `docs/2-reference/07-operations.md:103-105`, `fly.toml:11-14`, `server.js:159-160`, `docs/4-pilotage/backlog.md:871-894` (C29) |
| §1 Contexte (déclencheur hifago) | `docs/specs/03-admin-creation-etablissement.md:129-136`, `hifago/supabase/migrations/20260814234500_establishment_presentation_fields.sql`, `hifago/docs/00-modele-de-donnees.md:105`, `hifago/supabase/migrations/20260813234500_product_proposals.sql:98-100` |
| §2 Portée (exclusions) | `docs/3-integrations/lobby_pms_api.md:115-116`, `src/services/lobbyService.js` (absence confirmée) |
| §6 Modèle de données (camp/evento déjà unifiés dans `products`) | `hifago/supabase/migrations/20260814190000_products_evento_vitrine.sql`, `20260814220000_camp_multiday_booking.sql` |
| §3 Décisions retenues | `hifago/docs/04-architecture-cible.md:644-654`, `hifago/docs/02-cahier-des-charges-socio.md:443-497`, `hifago/docs/03-cahier-des-charges-admin.md:251-320,604-608` |
| §5-7 Écrans, modèle, contrat | `src/services/migrations/006_experiences_media.sql`, `010_product_submissions.sql`, `hifago/supabase/migrations/20260813240500_moderate_product_proposal_rpc.sql`, `hifago/docs/05-reference-technique.md` |
| §8 Invariants | `hifago/CLAUDE.md` §2-3, `docs/4-pilotage/backlog.md:871-894` (C29), `docs/4-pilotage/backlog.md:1030,1045-1046` (carrousel/WebP legacy déjà livrés) |

### Fichiers réellement livrés (2026-08-15)

| Élément | Fichier |
|---|---|
| Migration (`product_media`, `establishment_media`, dépréciation `photo_urls`, bucket `catalog-media`, `product_proposals.kind`, 3 RPC, extension `moderate_product_proposal`, `create_establishment` sans `p_photo_urls`) | `hifago/supabase/migrations/20260815110000_gestion_images.sql` |
| Types TypeScript régénérés | `hifago/packages/supabase/src/database.types.ts` |
| Client `service_role` (premier usage dans hifago/) | `hifago/packages/supabase/src/service.ts` |
| Route Handler d'upload (sharp : rotate EXIF, resize 2400px, WebP q82) | `hifago/apps/admin/app/api/upload/[entity]/route.ts` |
| Composants partagés (`packages/ui`, réexportés par le barrel) | `image-crop.tsx`, `carousel.tsx`, `media-gallery.tsx` |
| Écran admin — galerie produit | `hifago/apps/admin/app/admin/products/[id]/edit/ProductPhotosBlock.tsx` |
| Écran admin — galerie établissement (remplace `photo_urls`) | `hifago/apps/admin/app/admin/establishments/[id]/EstablishmentPhotosBlock.tsx`, `NewEstablishmentForm.tsx` (pipeline crop mis à jour) |
| Écran admin — modération photos seules | `hifago/apps/admin/app/admin/proposals/[id]/ModeratePhotosProposalForm.tsx`, extension de `page.tsx`/`ProposalsTable.tsx` |
| Écran socio — proposer/retirer/réordonner | `hifago/apps/admin/app/partner/products/[id]/edit/ProductPhotosSocioBlock.tsx` |
| Carrousel client | `hifago/apps/web/app/[locale]/products/[slug]/ProductPhotos.tsx` |
| Tests E2E (Playwright) | `admin-product-photos.spec.ts`, `partner-propose-photo.spec.ts`, `admin-establishment.spec.ts` (mis à jour pour le nouveau pipeline crop) |
| Fixture de test | `hifago/apps/admin/e2e/fixtures/test-photo.jpg` |

## 12. Documents liés

- `hifago/docs/04-architecture-cible.md` — décision « Stockage et images » (§ dédiée).
- `hifago/docs/02-cahier-des-charges-socio.md` §3f — photos proposition vs galerie publiée.
- `hifago/docs/03-cahier-des-charges-admin.md` §3b/§3c, G5 — gestion directe catalogue, hygiène
  fichiers.
- `hifago/docs/00-modele-de-donnees.md` §1 — gap galerie établissement.
- `docs/specs/03-admin-creation-etablissement.md` — prédécesseur direct : a livré le mécanisme
  provisoire (`photo_urls`, bucket `establishment-photos`) que ce spec remplace.
- `docs/specs/02-admin-accueil-et-navigation.md` — référence de style/niveau de détail.
- `hifago/CLAUDE.md` §2-3 — design system unique, frontière RLS/RPC-only.

### Point à trancher par Jérôme (remonté au gate `/hifago-review`)

Deux dépendances UI ajoutées (`react-easy-crop`, `embla-carousel-react`, toutes deux confinées à
`packages/ui/`) ne figurent pas dans la carte besoin→bibliothèque déjà tranchée de `/hifago-ui`.
Choix documenté et justifié ci-dessus (§10) au moment d'écrire ce spec, mais jamais un agent ne
doit trancher ce type d'ajout seul par convention — à confirmer explicitement, ou remplacer si
Jérôme préfère une autre direction.

### Points laissés ouverts (non résolus par cette implémentation, cf. §10)

- **Support HEIC** — toujours non géré (gap connu, hérité du legacy).
- **Repli générique (photo déduite du nom) quand une galerie est vidée** — non construit ici ; à
  vérifier/construire séparément si le besoin se confirme pour produits/établissements côté hifago.

### Écarts connus, sans lien avec cette feature

- **`admin-partner-registry.spec.ts`** (bascule « código activo ») : échec déjà documenté comme
  préexistant dans `docs/specs/01-admin-creation-partenaire.md` §11 et reproduit à l'identique en
  travaillant sur cette feature — non provoqué ni corrigé ici.
- **Tailwind v4 ne scanne pas de façon fiable `packages/ui/src` depuis les apps consommatrices**
  dans ce monorepo (constaté en ajoutant `image-crop.tsx`/`carousel.tsx`/`media-gallery.tsx` : des
  classes utilisées uniquement dans un composant `packages/ui` fraîchement créé n'apparaissaient
  pas dans le CSS compilé, même après redémarrage complet des serveurs dev). Corrigé une fois pour
  toutes par un `@source "../**/*.{ts,tsx}"` explicite dans `packages/ui/src/styles/globals.css` —
  bénéficie à tout futur composant du package, pas seulement à celui-ci.
- **Next 16 introduit une garde anti-SSRF sur `next/image`** qui refuse par défaut d'optimiser une
  image dont l'hôte résout vers une IP privée (bloquant pour Supabase Storage local,
  `127.0.0.1`) — `images.dangerouslyAllowLocalIP = true` ajouté dans `apps/web/next.config.ts`,
  sans risque ici puisque `remotePatterns` scope déjà l'hôte exact au bucket `catalog-media`. À
  garder en tête pour tout futur usage de `next/image` contre un hôte local.
