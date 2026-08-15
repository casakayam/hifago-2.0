---
id: specs-admin-creation-etablissement
titre: "Admin crée un établissement (identité, rattachement, présentation basique)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-14
resume: >
  Spec de l'écran admin de création d'un établissement — recherche du partenaire propriétaire
  (au lieu d'un dropdown brut), présentation basique (nom, description bilingue, adresse
  géocodée, photos provisoires) et écran redessiné en blocs, sur le modèle de la création
  partenaire. Le modèle de "ce que vend un établissement" (chambres/logement entier, tarification)
  reste explicitement hors périmètre.
mots_cles: [admin, creation etablissement, rattachement partenaire, recherche, combobox,
  google places, supabase storage, hifago]
repond_a:
  - "Comment l'admin rattache-t-il un établissement à un partenaire sans dropdown brut ?"
  - "Quels champs de présentation ajouter à la création d'un établissement, et lesquels renvoyer
    à plus tard ?"
  - "Comment gérer des photos alors qu'aucune infrastructure Storage n'existe encore ?"
---

# Admin crée un établissement

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`), pas l'app legacy. **Feature n°28**
> (Feature 27 prise en parallèle par une autre session le même jour — page d'accueil admin,
> `docs/specs/02-admin-accueil-et-navigation.md` ; dernière feature migrée avant celle-ci côté
> établissement : 26, `partner_direct_creation.sql`, 2026-08-14) — numéro de build, distinct du
> `03-` de ce fichier qui est un compteur de docs.
>
> **Implémentée le 2026-08-14**, spec rédigée après un brainstorm en deux temps avec Jérôme dans
> la même session (un premier périmètre de champs jugé trop chargé, resserré ensuite) — migration,
> RPC, composants, formulaire et tests e2e livrés d'un seul tenant. Fichiers réels en annexe §11.
>
> **Mise à jour le 2026-08-15** : `docs/specs/04-gestion-images.md` (Jérôme, en parallèle) a
> remplacé le mécanisme `photo_urls` de cette feature par son service définitif —
> `establishment_media` + RPC `add_catalog_media` + bucket partagé `catalog-media` (migration
> `20260815110000_gestion_images.sql`, qui **retire `p_photo_urls` de `create_establishment`** et
> **drop `establishments.photo_urls`**). Exactement l'issue anticipée par cette spec elle-même
> (§3, §10 : *"un placeholder appelé à être remplacé"*). `NewEstablishmentForm.tsx` a été mis à
> jour en deux temps le même jour : un premier correctif de reprise (upload direct au bucket
> `catalog-media` puis un appel `add_catalog_media` par photo une fois l'établissement créé —
> `establishment_media.establishment_id` étant une FK non nullable, impossible d'écrire la ligne
> média avant que l'établissement existe, contrairement à l'ancien tableau plat), puis la spec 04
> a livré son propre pipeline définitif (Route Handler `service_role` `POST /api/upload/
> establishment` + composant partagé `ImageCrop`, `packages/ui/src/components/image-crop.tsx`) et
> l'a câblé sur ce même écran — c'est ce pipeline complet (recadrage avant upload, conversion
> WebP/strip EXIF côté serveur) qui est réellement en place aujourd'hui, pas le dépôt direct
> intermédiaire. `admin-establishment.spec.ts` a été mis à jour en conséquence (étape de recadrage
> avant l'apparition de la miniature). §6/§7 ci-dessous restent tels quels rédigés le 2026-08-14
> (traçabilité historique) ; voir §10 pour le détail de ce qui a changé et ce qui reste ouvert.

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

Contrairement à la création d'un partenaire (`01-admin-creation-partenaire.md`, Feature 26,
implémentée la veille), **aucune spec n'existait pour la création d'un établissement** — la
fonctionnalité existait déjà en code (Feature 1, antérieure à la convention `docs/specs/`) mais
n'avait jamais été documentée ni retravaillée depuis.

L'écran (`hifago/apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx`, avant cette
feature : 107 lignes) était réduit à 3 champs : nom ES, nom EN, et un `Select` HeroUI **brut**
listant tous les partenaires sans recherche ni pagination — le même défaut existait à l'identique
dans l'écran "Transférer un établissement" côté fiche partenaire
(`hifago/apps/admin/app/admin/partners/[id]/EstablishmentsSection.tsx`). La RPC `create_establishment`
(`hifago/supabase/migrations/20260813220000_create_establishment_rpc.sql`) n'appelait par ailleurs
jamais `log_admin_action` — une dette assumée depuis l'introduction du journal d'audit
(`20260813201000_admin_audit_log.sql` : *"les écritures admin des features 1-3 restent non
auditées rétroactivement (dette assumée, cf. plan)"*), jamais réglée depuis faute d'avoir dû
retoucher cette RPC.

Par ailleurs, l'audit `hifago/docs/00-modele-de-donnees.md` §1 ("Établissement / Propriété")
documentait de longue date une série de champs manquants — adresse/géolocalisation, description
longue, tags, capacité, "opéré directement par la plateforme vs partenaire indépendant" — dont
certains étaient des **décisions déjà actées** au cahier des charges admin (§3c/§3e), pas de
nouvelles hypothèses.

## 2. Portée

Un premier brouillon de cette spec envisageait de fermer l'essentiel de ces lacunes en un seul
geste (adresse, description, tags, capacité, slug, "opéré directement"). Après discussion avec
Jérôme, le périmètre a été **volontairement resserré** en deux points :

1. **"Ce que vend un établissement" est un niveau en dessous et hors périmètre.** Le mode
   chambres/logement entier, le catalogue de produits qu'un établissement propose et sa
   tarification relèvent d'un lot séparé, à construire une fois l'identité de l'établissement
   posée — pas de ce formulaire de création.
2. **Champs explicitement écartés après proposition** : tags de catégorisation et nombre de
   chambres — proposés puis non retenus par Jérôme pour garder l'écran resserré. Le slug public a
   été écarté indépendamment : aucune page publique établissement n'existe encore dans `apps/web`
   pour le consommer (contrairement à `products.slug`, réellement lu par
   `/[locale]/products/[slug]`) — l'ajouter aurait été spéculatif.

**In** — un écran admin unique qui crée, en une transaction (`create_establishment`) :
- l'identité (`name`, `operated_directly`) ;
- le rattachement au partenaire propriétaire, via un champ de **recherche** (pas un dropdown) ;
- une présentation basique optionnelle : description bilingue, adresse géocodée (lat/lon), et un
  upload de photos **volontairement basique**.

**Out, explicitement renvoyé ailleurs :**
- Mode chambres/logement entier, produits, tarification (cf. ci-dessus).
- Tags de catégorisation, nombre de chambres (proposés, écartés par Jérôme).
- Slug public (aucun consommateur aujourd'hui).
- Galerie de photos avancée (réordonnancement, couverture, service partagé admin/socio) — cf. §3.
- `payout_method` — déjà punté explicitement dans la spec 01 §10, rien de nouveau ne débloque ce
  point ici.
- Horaires check-in/checkout, équipements structurés — dépendent du modèle "ce qu'on vend dedans",
  explicitement hors périmètre (cf. ci-dessus).
- Devise — audit : "non bloquant tant que mono-pays".

## 3. Décisions retenues

Ne pas rouvrir :
- **Rattachement = recherche, jamais création inline.** Si le partenaire n'existe pas encore,
  l'admin est renvoyé le créer d'abord via `/admin/partners/new` (déjà construit) — pas de
  raccourci de création de partenaire depuis cet écran (écarté explicitement).
- **Pattern visuel en blocs `<fieldset>`**, repris tel quel de `/admin/partners/new`
  (`NewPartnerForm.tsx`) — cohérence visuelle entre les deux écrans de création.
- **Nom = un seul champ**, pas de saisie ES/EN séparée — un nom d'établissement est généralement
  un nom propre, pas traduit. Reste stocké `{es: valeur}` dans la colonne `name` (jsonb existante,
  schéma inchangé) ; le repli déjà en place de `resolveLocalizedField` (`@hifago/domain`, consommé
  par une quinzaine de fichiers) renvoie naturellement cette valeur à un lecteur EN.
- **Description = switcher de langue**, pas deux champs empilés — un nouveau pattern d'UI choisi
  explicitement par Jérôme parmi 3 options (onglets au-dessus d'un champ unique, deux champs côte
  à côte, ou un champ par défaut + "ajouter une traduction"). S'étend à une 3e langue sans
  redesign, cohérent avec la décision "liste de langues extensible"
  (`hifago/docs/00-modele-de-donnees.md`).
- **Photos = version basique et provisoire, assumée comme temporaire.** Aucune infrastructure
  Storage/média n'existait dans `hifago/` avant cette feature (confirmé par recherche exhaustive :
  aucun bucket, aucune table media, aucun composant). Le cahier des charges admin §3c décide déjà
  qu'un établissement doit avoir "le même service de rangement/couverture que celui ouvert au
  prestataire" (réordonnancement, couverture) — **une décision de conception validée, jamais
  codée**. Construire ce service complet maintenant aurait largement dépassé le périmètre de cet
  écran de création ; Jérôme écrira une spec dédiée "gestion d'image" séparée pour le service
  définitif. Ici : upload simple vers un bucket `establishment-photos`, sans réordonnancement ni
  couverture — un **placeholder appelé à être remplacé**.
- **Correction jumelle d'`EstablishmentsSection.tsx`** dans le même geste : le sélecteur
  d'établissement du flux "Transférer" avait le même défaut (dropdown brut sur tout le registre) —
  corrigé avec le même composant de recherche, sans toucher à la RPC `transfer_establishment`.
- **`grant-establishment-select` (`CapabilitiesSection.tsx`) et `capability-status-select` restent
  des `Select` simples** — listes bornées (établissements du partenaire courant, ou énumération
  fixe à 4 valeurs), pas le registre entier : les convertir en recherche serait de la
  sur-ingénierie non justifiée par leur taille.

## 4. Parcours cible

1. L'admin ouvre `/admin/establishments/new`.
2. Il remplit l'identité : nom, case "opéré directement par la plateforme" (décochée par défaut).
3. Il cherche le partenaire propriétaire dans le champ de recherche (`SearchableCombobox`) — s'il
   ne le trouve pas, un lien renvoie vers `/admin/partners/new` pour le créer d'abord, puis
   revenir.
4. Il remplit, en option, la présentation : description (bascule ES/EN), adresse (recherche
   Google Places assistée, ou saisie manuelle directe), et des photos (upload immédiat au fil de
   la sélection, miniatures avec retrait possible avant soumission).
5. Soumission → un seul appel RPC (`create_establishment`, §7) crée l'établissement avec tous les
   champs remplis, rattache/crée la capacité `operator` "en attente" du partenaire comme avant, et
   journalise l'action (`log_admin_action`, correctif §1).
6. Redirection vers `/admin/establishments`, l'établissement créé y est visible.

## 5. Écran(s)

Un seul écran, trois blocs visuels (`<fieldset>`/`<legend>`, pattern repris de
`/admin/partners/new`) :

1. **Identidad** — `Nombre` (requis, un seul champ), `Operado directamente por la plataforma`
   (case, décochée par défaut).
2. **Partner propietario** — `SearchableCombobox` (composant partagé, §5 technique ci-dessous) sur
   les partenaires existants, avec un lien "¿No encuentras el partner? Créalo primero" vers
   `/admin/partners/new`.
3. **Presentación — opcional** — `Descripción` (switcher ES/EN au-dessus d'un `TextArea` unique),
   `Dirección` (recherche Google Places + repli manuel, repris tel quel du bloc "Perfil comercial"
   de `NewPartnerForm.tsx`) avec `lat`/`lon` détectées ou manuelles, `Fotos` (upload basique,
   miniatures, retrait avant soumission).

**Composant partagé `SearchableCombobox`** (`hifago/apps/admin/components/searchable-combobox.tsx`) :
choix du `ComboBox` HeroUI v3 (pas `Autocomplete`, qui reste un bouton-déclencheur comme `Select` —
vérifié dans les `.d.ts` de `@heroui/react`, seul `ComboBox` est un vrai champ texte filtrant une
liste). Recherche 100 % client-side sur les données déjà chargées par le Server Component parent
(volume actuel : dizaines de partenaires/établissements, pas de pagination sur ces écrans
aujourd'hui) ; filtrage insensible aux accents en réutilisant `slugify()`
(`apps/admin/lib/utils.ts`) plutôt que de dupliquer une normalisation. Deux consommateurs :
`NewEstablishmentForm.tsx` (recherche de partenaire) et `EstablishmentsSection.tsx` (recherche
d'établissement pour le transfert).

**Écran jumeau touché** : `EstablishmentsSection.tsx` — même composant, RPC `transfer_establishment`
inchangée.

## 6. Modèle de données

| Colonne (`establishments`) | Statut |
|---|---|
| `description jsonb` | **Ajoutée.** Nullable, même pattern que `name` (`{es, en?}`). |
| `address text` | **Ajoutée.** Nullable. |
| `lat double precision`, `lon double precision` | **Ajoutées.** Nullables — réutilisent l'infra Google Places déjà construite pour les partenaires (spec 01 §5). |
| `operated_directly boolean not null default false` | **Ajoutée.** Déjà décidée (cahier admin §3e) — remplace le test câblé en dur sur le nom `kayam`. |
| `photo_urls text[] not null default '{}'` | **Ajoutée, basique et provisoire.** Pas de table media dédiée — ordre = ordre d'upload, première position = couverture par convention d'affichage future, pas par mécanisme. Remplacée par la future spec "gestion d'image". |

**Nouveau bucket Supabase Storage `establishment-photos`** — premier usage de Storage dans tout le
projet `hifago/` (aucun précédent, confirmé par recherche exhaustive avant d'écrire cette feature).
Public en lecture (les photos doivent s'afficher côté vitrine plus tard) ; écriture (`insert`)
réservée à l'admin (`is_admin(auth.uid())`) ; pas de policy `update`/`delete` — cohérent avec
"basique et provisoire".

RLS de `establishments` inchangée (`establishments_select`/`establishments_write_admin`,
`20260813210000_establishments_core_table.sql`) : aucun des critères RPC-only
(`hifago/CLAUDE.md` §3) ne s'applique à de simples colonnes de présentation.

## 7. Contrat API/RPC

`create_establishment` étendue (migration
`hifago/supabase/migrations/20260814234500_establishment_presentation_fields.sql`) :

```sql
create_establishment(
  p_partner_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false,
  p_photo_urls text[] default '{}'
) returns uuid
```

Squelette de sécurité inchangé : `security definer`, `set search_path = ''`, `is_admin()`
interne — pas de `select ... for update`, aucune ressource à capacité limitée touchée par une
simple création (même raisonnement que `create_partner_direct`, spec 01 §7). Rattachement de la
capacité `operator` "en attente" du partenaire inchangé.

**Piège technique traité** : changer l'arité d'une fonction PL/pgSQL ne la remplace pas
(Postgres identifie par nom + types de paramètres) — un `drop function if exists
create_establishment(uuid, jsonb);` explicite précède le nouveau `create or replace`.

**Correctif d'audit réglé au passage** : la RPC appelle désormais `log_admin_action
('establishment.create', 'establishments', v_establishment_id, ...)`, comme toute RPC admin créée
depuis `20260813201000_admin_audit_log.sql` — la dette assumée de la Feature 1 est soldée ici,
puisque la fonction était de toute façon réécrite pour les nouveaux champs.

## 8. Règles et invariants

- `operated_directly` gouverne l'exclusion des KPIs de performance externe (cahier admin §3e) — le
  calcul lui-même (côté reporting) reste hors périmètre de cette feature, seul le champ existe
  désormais.
- Toute écriture admin est auditée (§7) — invariant transverse désormais respecté par cette RPC
  comme par ses voisines.
- Bucket `establishment-photos` : lecture publique, écriture admin seule — aucun autre rôle ne
  peut y déposer un fichier.
- Le rattachement établissement↔partenaire reste 1:1 (`establishments.partner_id not null`),
  inchangé par cette feature — la généralisation multi-établissements/multi-partenaires
  (`00-modele-de-donnees.md` §8) n'est pas rouverte ici.

## 9. Cas limites

- **Partenaire introuvable dans la recherche** → l'admin est renvoyé vers `/admin/partners/new`
  pour le créer d'abord ; aucun blocage silencieux, aucune création à la volée.
- **Description/adresse/photos tous vides** → création valide quand même, tous ces champs sont
  optionnels (seuls `name` et `partner_id` sont obligatoires, inchangé depuis Feature 1).
- **Upload d'une photo échoué** (réseau, quota) → le champ concerné reste simplement absent de la
  liste, un message d'erreur s'affiche, la création n'est pas bloquée pour autant — l'admin peut
  soumettre sans cette photo ou réessayer.
- **Recherche partenaire sans résultat** → l'état vide du `ListBox` affiche un message dédié
  (`emptyMessage`), pas une liste qui semble juste vide sans explication.

## 10. Décisions tranchées / points ouverts

- **Slug public** — **laissé explicitement ouvert**, pas tranché ici : à reprendre quand une fiche
  établissement publique existera dans `apps/web` (aujourd'hui aucune page ne le consommerait).
- **Galerie/réordonnancement/couverture avancés** — la future spec "gestion d'image"
  (`docs/specs/04-gestion-images.md`) est désormais écrite, implémentée et intégrée à cet écran :
  modèle de données/RPC (`establishment_media`, `add_catalog_media`, `reorder_gallery`), Route
  Handler `service_role` (recadrage, conversion WebP/strip EXIF, spec 04 §7) et composant partagé
  `ImageCrop` (`packages/ui/src/components/image-crop.tsx`) sont tous consommés par
  `NewEstablishmentForm.tsx` — voir la mise à jour du 2026-08-15 en tête de ce document. Plus rien
  d'ouvert côté upload de la photo elle-même ; le réordonnancement/la gestion de couverture après
  création restent en revanche hors de cet écran de création (spec 04 les couvre côté fiche
  établissement existante, pas à la création).
- **Tags de catégorisation, nombre de chambres** — proposés dans un premier brouillon de cette
  spec, **explicitement écartés par Jérôme** pour garder l'écran resserré — pas oubliés, à
  reconsidérer si le besoin se confirme plus tard (probablement avec le lot "ce qu'on vend dans
  l'établissement", hors périmètre ici).
- **Recherche partenaire 100 % client-side** — tranché : suffisant au volume actuel (dizaines
  d'entrées), la vraie recherche globale multi-entités reste un chantier séparé déjà identifié
  (cahier admin §2). À revoir si le registre grossit significativement.

## 11. Annexe — traçabilité code→règle

### Sources ayant informé la spec

| Section | Fichiers sources |
|---|---|
| §1 Contexte | `hifago/apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` (avant réécriture), `20260813220000_create_establishment_rpc.sql`, `20260813201000_admin_audit_log.sql`, `hifago/docs/00-modele-de-donnees.md` §1 |
| §3 Décisions | `hifago/docs/03-cahier-des-charges-admin.md` §3c/§3e, `docs/specs/01-admin-creation-partenaire.md` (précédent de style et de composant adresse) |
| §5 Écran | `hifago/apps/admin/app/admin/partners/new/NewPartnerForm.tsx` (pattern `<fieldset>`), `node_modules/@heroui/react/dist/components/combo-box/` (choix technique) |
| §6/§7 Modèle et RPC | `20260813210000_establishments_core_table.sql`, `hifago/CLAUDE.md` §3 (checklist RLS/RPC-only) |

### Fichiers réellement livrés (2026-08-14)

| Élément | Fichier |
|---|---|
| Migration (colonnes, bucket Storage + policies, RPC étendue, correctif audit) | `hifago/supabase/migrations/20260814234500_establishment_presentation_fields.sql` |
| Types TypeScript régénérés | `hifago/packages/supabase/src/database.types.ts` |
| Composant recherche partagé | `hifago/apps/admin/components/searchable-combobox.tsx` |
| Widget adresse relocalisé (partagé création partenaire/établissement) | `hifago/apps/admin/components/address-autocomplete.ts` (déplacé depuis `partners/new/`) |
| Écran établissement réécrit | `hifago/apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` |
| Écran partenaire (import mis à jour) | `hifago/apps/admin/app/admin/partners/new/NewPartnerForm.tsx` |
| Écran transfert corrigé | `hifago/apps/admin/app/admin/partners/[id]/EstablishmentsSection.tsx` |
| Tests e2e | `hifago/apps/admin/e2e/admin-establishment.spec.ts` (étendu), `hifago/apps/admin/e2e/admin-partner-registry.spec.ts` (sélecteurs corrigés), fixture `hifago/apps/admin/e2e/fixtures/pixel.png` |

### Correctif du 2026-08-15 — reprise par la spec 04

Deux catégories de fichiers touchés en réaction à `20260815110000_gestion_images.sql`
(`docs/specs/04-gestion-images.md`) :

| Élément | Fichier |
|---|---|
| Écran établissement — upload photo migré vers `add_catalog_media`/bucket `catalog-media` (au lieu de `p_photo_urls`, retiré de `create_establishment` par cette même migration) | `hifago/apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` |
| Tests e2e utilisant la création d'établissement comme fixture — sélecteurs `input[name="name-es"]`/`partner-select` (obsolètes depuis le 2026-08-14, jamais propagés au-delà des 2 fichiers ci-dessus) corrigés en `input[name="nombre"]`/`partner-search` | `admin-camp-booking.spec.ts`, `admin-partner-offboarding.spec.ts`, `admin-product-create.spec.ts`, `admin-product-publish.spec.ts` |

### Écart connu, sans lien avec cette feature

`admin-partner-registry.spec.ts` (bascule du switch "código activo", RPC `set_partner_code_active`)
échoue de façon reproductible sur un registre partenaires chargé par des runs e2e répétés sans
`db reset` — bug préexistant déjà consigné dans `docs/specs/01-admin-creation-partenaire.md` §11
(observé à nouveau en testant cette feature, y compris juste après un `db reset` complet ; toutes
les étapes précédant cette assertion, y compris les deux nouveaux `SearchableCombobox`, passent
systématiquement). Non provoqué ni corrigé ici.

## 12. Documents liés

- `hifago/docs/00-modele-de-donnees.md` §1 — audit des champs manquants, base du premier brouillon
  de périmètre de cette spec.
- `hifago/docs/03-cahier-des-charges-admin.md` §3c (présentation éditable sans déploiement), §3d
  (rattachement/transfert d'établissement), §3e ("opéré directement" et galerie partagée
  admin/socio).
- `docs/specs/01-admin-creation-partenaire.md` — précédent direct de style (blocs `<fieldset>`,
  RPC unique) et du composant de recherche d'adresse Google Places réutilisé ici.
- `hifago/CLAUDE.md` §2.1 (règle de promotion vers `packages/`), §3 (checklist RLS/RPC-only), §11
  (pièges empiriques HeroUI).
- **Spec à venir, non encore écrite** : "gestion d'image" dédiée (Jérôme) — remplacera le champ
  `photo_urls` basique de cette feature par le service partagé admin/socio décidé au cahier des
  charges admin §3c (réordonnancement, couverture).
