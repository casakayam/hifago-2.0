---
id: specs-readme
titre: "Specs — fonctionnalités prêtes à coder, une par une"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: actif
maj: 2026-08-14
resume: >
  Sommaire des specs de feature : chaque document raffine une fonctionnalité précise en un
  parcours, un modèle de données et un contrat d'API prêts à coder, sur n'importe quel stack.
mots_cles: [specs, gabarit, feature, hifago, cahier des charges, prêt à coder]
repond_a:
  - "Existe-t-il une spec déjà écrite pour cette fonctionnalité ?"
  - "Comment écrire une nouvelle spec de feature ?"
  - "Quelle est la différence entre une spec et un cahier des charges ?"
---

# Specs — fonctionnalités prêtes à coder

## Ce qu'est une spec ici

Une spec = **une fonctionnalité précise**, décrite jusqu'au niveau où elle est prête à coder :
parcours utilisateur, champs exacts, modèle de données, contrat d'API/RPC, cas limites, et les
points encore laissés au jugement de qui code. Elle n'est pas limitée à un stack — ce premier
document couvre une feature du nouveau stack Hifago, mais rien n'empêche une future spec de
couvrir l'app legacy.

**Ce qu'une spec n'est pas :**
- Pas un cahier des charges de rôle entier (`hifago/docs/0X-cahier-des-charges-*.md` reste la
  vision globale d'un portail — client, socio, admin — validée section par section avec Jérôme).
  Une spec **raffine** une portion précise d'un cahier des charges déjà validé ; elle ne le
  contredit jamais, elle le rend actionnable.
- Pas un plan d'architecture transverse multi-features (`docs/5-conception/*.md`, qui décrit des
  cibles pour le stack legacy).

## Convention

- **Avant de copier le gabarit** : suivre la checklist de clarification
  [`avant-la-spec.md`](avant-la-spec.md) — comment poser les bonnes questions à Jérôme pour que
  l'ambiguïté soit tranchée avant l'écriture, pas découverte en codant.
- **Nommage** : `NN-slug-kebab.md`, `NN` = ordre de création — jamais réordonné, jamais réutilisé
  même si une spec est un jour archivée.
- **Gabarit** : copier [`_modele.md`](_modele.md).
- **Statut** : `brouillon` → `en relecture` → `validé par Jérôme le AAAA-MM-JJ`, porté à la fois
  par le frontmatter (`statut`, un résumé global) et par une table interne « Sommaire et statut »
  où **chaque section** a son propre statut — convention reprise de
  `hifago/docs/03-cahier-des-charges-admin.md`.
- **Enregistrement obligatoire** dans `docs/ai-index.json` dans le même commit
  (`npm run docs:index` puis `npm run docs:check`).

## Sommaire

| Document | Périmètre | Stack | État |
|---|---|---|---|
| [01 · Admin crée un partenaire](01-admin-creation-partenaire.md) | Écran admin de création directe d'un partenaire (identité + capacités + profil commercial), sans passer par l'auto-enregistrement | Hifago | Implémenté |
| [02 · Admin : sidebar et page d'accueil](02-admin-accueil-et-navigation.md) | Sidebar de navigation persistante + vue d'ensemble (KPIs, graphiques, alertes), pagination serveur, écrans clients/campagnes/produits manquants | Hifago | Implémenté |
| [03 · Admin crée un établissement](03-admin-creation-etablissement.md) | Écran admin de création d'un établissement : recherche du partenaire propriétaire (pas un dropdown brut), présentation basique (description, adresse géocodée, photos provisoires) | Hifago | Implémenté |
| [04 · Gestion des images](04-gestion-images.md) | Upload + droits + recadrage admin/socio sur produits et établissements, modération des propositions photo, carrousel client optimisé (WebP, lazy loading, mobile) — remplace le mécanisme `photo_urls` provisoire du spec 03 | Hifago | Implémenté |
| [05 · Invitations partenaire : dashboard, visibilité établissement, gestion admin](05-invitations-onboarding-dashboard-partenaire.md) | Dashboard d'atterrissage `/partner` après inscription, visibilité/action sur le rattachement établissement d'un Prestador, liste et révocation des invitations côté admin — le jeton opaque déjà en place n'a rien à corriger | Hifago | Implémenté |
| [06 · Gestion d'un établissement](06-gestion-etablissement.md) | Admin édite un établissement après création (gap décision §3c) ; partenaire propose la création (premier ou établissement supplémentaire) et l'édition du sien, toujours via modération admin | Hifago | Implémenté |
| [07 · Connexion/inscription complète](07-connexion-inscription-complete.md) | Google OAuth, inscription email/mot de passe avec vérification par email, mot de passe oublié/réinitialisation, 2FA TOTP obligatoire pour le rôle admin — back-end générique, front `apps/admin` | Hifago | Implémenté |
| [08 · Admin gère une activité](08-admin-gestion-activite.md) | Tags multi-valeurs remplaçant la catégorie fixe, prix par palier de quantité/personnes, bornes min/max par réservation appliquées dans `create_order`, suppression réelle avec garde-fou anti-commande — activité uniquement | Hifago | Implémenté |
| [09 · Design system admin](09-design-system-admin.md) | Tokens du thème `admin` HeroUI v3 : fond beige (piste « Argile », réf. Muji), coins carrés à 0 partout, accent terracotta remplaçant le bleu-violet froid | Hifago | Brouillon |
| [10 · Listes admin/socio standardisées](10-listes-standardisees-admin-socio.md) | Composant `DataList` réutilisable pour les 13 listes admin+socio : pagination et tri pilotés par l'URL, filtres déclaratifs, clic-vers-détail, boutons d'action selon ce qui est possible, pleine largeur | Hifago | Brouillon |
| [11 · Activité : parcours unifié + créneaux](11-admin-activite-parcours-unifie-creneaux.md) | Fusion création/édition d'une activité en un seul parcours, i18n nom/description, lieu optionnel, photos dès la création, module de définition de créneaux horaires récurrents (réservation cliente renvoyée à une Tranche 2) | Hifago | Implémenté |
| [12 · Alojamiento (« house »)](12-admin-alojamiento-house.md) | Active `type='lodging'` dans le parcours ProductForm unifié : check-in/check-out, capacité, réutilise price_tiers/tags/photos de l'activité, réactive la colonne dormante `stay_rates` pour saison/week-end/dépôt/inclusiones (définition seulement, consommation au checkout renvoyée à une Tranche 2) | Hifago | Implémenté |
| [13 · Hôtel et habitaciones](13-admin-hotel-habitaciones.md) | Active `type='hotel'` : le prix vit sur ses chambres (nouvelle table `product_room_types`, même mécanisme prix/tramos que l'alojamiento), check-in/check-out réutilisés de la spec 12, alignement partiel sur la forme des données LobbyPMS (`quantity`/`description`/colonnes dormantes) en anticipation d'une Tranche 2 | Hifago | Implémenté |
| [14 · Transporte](14-admin-transporte.md) | Active `type='transport'` dans le même ProductForm unifié : lieu (point de départ) optionnel + tags comme l'activité/alojamiento/hôtel, prix par tramos + bornes de quantité pour « hasta 4/7 pers. » (un produit à deux tramos plutôt que deux produits séparés comme en V1), pas de check-in/checkout ni de capacité produit (`schedule='date'` en V1, le transporteur dispatche son propre parc) | Hifago | Implémenté |
