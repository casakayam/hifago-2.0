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
| [13 · Hôtel et habitaciones](13-admin-hotel-habitaciones.md) | ⛔ **Supprimée le 2026-08-27** (T3 de la spec 24). Activait `type='hotel'` et `product_room_types` — un troisième étage qui n'existait ni chez LobbyPMS ni dans la v1, pour zéro hôtel réel. L'hôtel est devenu l'établissement, la chambre un produit | Hifago | **Supprimée** |
| [14 · Transporte](14-admin-transporte.md) | Active `type='transport'` dans le même ProductForm unifié : lieu (point de départ) optionnel + tags comme l'activité/alojamiento/hôtel, prix par tramos + bornes de quantité pour « hasta 4/7 pers. » (un produit à deux tramos plutôt que deux produits séparés comme en V1), pas de check-in/checkout ni de capacité produit (`schedule='date'` en V1, le transporteur dispatche son propre parc) | Hifago | Implémenté |
| [15 · Socio propose la création d'un produit](15-socio-creation-produit.md) | Un partenaire prestataire propose la création d'une nouvelle fiche produit (6 types, parité totale avec le parcours admin) sur un de ses établissements, modérée par un admin — photos différées après approbation, révise la règle « jamais un hébergement directement » du cahier socio §3e pour la création | Hifago | Implémenté |
| [16 · Notifications toast succès/échec](16-notifications-toast.md) | Remplace les messages inline (`role="alert"`/`role="status"`) par des popups toast HeroUI v3 (vert/rouge) sur toute création/édition/suppression, admin + socio + authentification — piège critique `Toast.Provider` (jamais un wrapper) et `noValidate` requis sur tout `<form>`, cf. CLAUDE.md §11 | Hifago | Implémenté |
| [17 · Calendrier/disponibilité — audit + refonte phasée](17-calendrier-disponibilite-refonte.md) | Corrige le crash `price_cop null` sur un hôtel, restaure « Mis Reservas » côté socio et ajoute la modification d'une réservation (Tranche 1), pose le moteur unifié chambre d'hôtel + alojamiento par nuits avec comparatif technologique du calendrier (Tranche 2) — créneaux réservables et ressource partagée généralisée renvoyés à une future spec | Hifago | Brouillon |
| [18 · Créneaux horaires réellement réservables](18-creneaux-horaires-reservables.md) | Rend `product_slot_rules` (définition posée par la spec 11, jamais consommée) réellement réservable côté client avec anti-survente — « Tranche 3 » de la spec 17, motivée par un produit réel bloqué (jetski), conçue compatible avec le futur connecteur LobbyPMS | Hifago | Brouillon |
| [19 · Paiement Mercado Pago — acompte, ledger, virement référent](19-paiement-mercadopago-acompte-ledger.md) | Rouvre le « hors périmètre v1 » du paiement en ligne : capture obligatoire de l'acompte (moteur 17/10/7 déjà validé) via Mercado Pago, construit le ledger de règlement absent côté hifago 2.0, et rend Mercado Pago obligatoire pour le virement automatique post-fulfillment au référent — jamais un split en temps réel, pour respecter la règle de redistribution no-show déjà actée | Hifago | Brouillon |
| [20 · Agenda de réservations socio](20-agenda-reservations-socio.md) | Remplace la page d'accueil du socio par un agenda type Google Calendar (jour/semaine/mois, MUI X Scheduler) affichant chaque réservation individuelle, ajout manuel (walk-in) et fiche de réservation cliquable — calendrier de cupos existant (FullCalendar) inchangé | Hifago | Brouillon |
| [21 · Connecteur LobbyPMS](21-connecteur-lobbypms.md) | Porte le connecteur LobbyPMS (Casa Kayam, seul établissement PMS-backed réel) vers un contrat générique multi-prestataire : disponibilité/prix par nuit, création de booking, miroir d'activité générique, poll automatique et file de réconciliation déjà scaffoldée (feature 22) — absence confirmée de sandbox LobbyPMS, job nocturne en lecture seule sur le compte réel | Hifago | Implémenté (Tranche 1) — gap connu : disponibilité live non branchée côté client |
| [22 · Vue référent restreinte](22-vue-referent-restreinte.md) | Ferme "Mi establecimiento y actividades"/"Mis reservas" pour un référent pur (nav + garde serveur sur 3 layouts), enrichit `/partner/commissions` (déjà la liste des ventes attribuées) avec établissement, client et pourcentage — aucune migration, aucun trou de sécurité à combler | Hifago | Implémenté |
| [23 · Notifications email transactionnelles](23-notifications-email-transactionnelles.md) | Premier fournisseur email applicatif (Resend) : file Postgres + journal d'envoi + Edge Function, même patron que le connecteur LobbyPMS. 8 événements en 2 tranches — Tranche 1 (invitation, nouvelle proposition, proposition traitée, exception réconciliation) puis Tranche 2 (commission attribuée, paiement effectué, confirmation client, blocage camp/evento), toutes deux dans `create_order`/`apply_payment_webhook` | Hifago | Implémenté — envoi réel Resend non vérifié (domaine non configuré, hors périmètre) |
| [24 · Surface LobbyPMS, parcours front d'un produit lié, cible du modèle hébergement](24-modele-hebergement-et-surface-lobbypms.md) | Audite ce que l'API LobbyPMS expose réellement face à ce que hifago en consomme (la charge utile de `GET /rooms` était intégralement jetée), refond le parcours front d'un produit lié — voir ce qu'on a choisi, importer ce que Lobby en sait — et acte la cible du modèle hébergement : l'hôtel devient l'établissement, dortoir/chambre privée deviennent des produits vendables | Hifago | Lot A implémenté ; observation préprod requise pour le Lot B ; cible modèle non implémentée |
