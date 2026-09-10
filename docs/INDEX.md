# Index de la documentation hifago/

> Généré par `npm run docs:index` — ne pas éditer à la main. Sommaire **humain** ; le
> `docs/ai-index.json` voisin sert le même contenu à une IA (table de routage sujet → document).
> Un seul fichier à ouvrir pour savoir ce qui existe : celui-ci.

## Cadrage — architecture, modèle de données, cahiers des charges
- [Audit du modèle de données cible — entités partagées](00-modele-de-donnees.md) · maj 2026-09-07
- [Cahier des charges — portail client (marketplace global, Guatapé = première localisation)](01-cahier-des-charges-client.md) · maj 2026-09-10
- [Cahier des charges — portail socio (aujourd'hui /partner)](02-cahier-des-charges-socio.md) · maj 2026-09-07
- [Cahier des charges — back-office admin (aujourd'hui /admin)](03-cahier-des-charges-admin.md) · maj 2026-09-07
- [Choix de stack et architecture cible](04-architecture-cible.md) · maj 2026-09-07
- [Référence technique — patterns validés et extensions requises](05-reference-technique.md) · maj 2026-08-16
- [Emails transactionnels — les 8 envois possibles, leur déclencheur et leur destinataire](06-emails-transactionnels.md) · maj 2026-09-01

## Specs — features prêtes à coder ou livrées
- [Admin crée un partenaire](specs/01-admin-creation-partenaire.md) — **Implémenté** · maj 2026-08-15
- [Admin : sidebar de navigation et page d'accueil](specs/02-admin-accueil-et-navigation.md) — **Implémenté** · maj 2026-08-15
- [Admin crée un établissement (identité, rattachement, présentation basique)](specs/03-admin-creation-etablissement.md) — **Implémenté** · maj 2026-08-15
- [Gestion des images — upload, droits, recadrage, affichage](specs/04-gestion-images.md) — **Implémenté** · maj 2026-08-15
- [Invitations partenaire : dashboard d'atterrissage, visibilité établissement, gestion admin](specs/05-invitations-onboarding-dashboard-partenaire.md) — **Implémenté** · maj 2026-09-07
- [Gestion d'un établissement — admin édite, partenaire propose (création et édition)](specs/06-gestion-etablissement.md) — **Implémenté** · maj 2026-09-07
- [Connexion/inscription complète : Google, email+mot de passe, vérification, mot de passe oublié, 2FA admin](specs/07-connexion-inscription-complete.md) — **Implémenté** · maj 2026-09-07
- [Admin gère une activité (tags, paliers de prix, bornes de quantité, suppression réelle)](specs/08-admin-gestion-activite.md) — **Implémenté** · maj 2026-08-16
- [Design system admin — fond beige, coins carrés (piste Argile)](specs/09-design-system-admin.md) — **Implémenté** · maj 2026-09-07
- [Listes admin/socio standardisées — pagination, tri, filtres, composant réutilisable](specs/10-listes-standardisees-admin-socio.md) — **Implémenté** · maj 2026-09-07
- [Admin : parcours unifié création/édition d'une activité — i18n nom/description, lieu, photos dès la création, module de créneaux horaires récurrents](specs/11-admin-activite-parcours-unifie-creneaux.md) — **Implémenté** · maj 2026-08-16
- [Admin : active products.type='lodging' (« house ») dans le parcours produit — check-in/check-out, capacité, extras de tarification (saison, week-end, dépôt, inclusiones)](specs/12-admin-alojamiento-house.md) — **Implémenté** · maj 2026-09-07
- [Admin : active products.type='hotel' — un hôtel a plusieurs sous-produits qui sont des chambres, chacune avec son propre prix/capacité](specs/13-admin-hotel-habitaciones.md) — **Supprimée** (reste : Supprimée le 2026-08-27 (T3 de la spec 24) — l'étage hôtel n'existe plus, ni en code ni…) · maj 2026-09-07
- [Admin : active products.type='transport' dans le parcours produit — lieu + tags + prix par tramos de capacité de véhicule, réutilisation intégrale du ProductForm unifié](specs/14-admin-transporte.md) — **Implémenté** · maj 2026-08-27
- [Socio : proposer la création d'une nouvelle fiche produit](specs/15-socio-creation-produit.md) — **Implémenté** · maj 2026-09-07
- [Notifications toast succès/échec sur toute création/édition/suppression (admin + socio)](specs/16-notifications-toast.md) — **Implémenté** · maj 2026-09-07
- [Calendrier/disponibilité — audit complet + refonte phasée (Tranches 0-2 prêtes à coder)](specs/17-calendrier-disponibilite-refonte.md) — **Partiel** (reste : Tranche 1 (crash price_cop null, Mis Reservas) et Tranche 2 (SVAR, moteur unifié…) · maj 2026-09-07
- [Créneaux horaires réellement réservables (product_slot_rules)](specs/18-creneaux-horaires-reservables.md) — **Implémenté** · maj 2026-09-07
- [Paiement en ligne Mercado Pago — acompte obligatoire, ledger de règlement, virement automatique au référent](specs/19-paiement-mercadopago-acompte-ledger.md) — **Partiel** (reste : Tranche 1 (capture d'acompte, CheckoutForm branché, ledger) livrée et vérifiée en…) · maj 2026-09-07
- [Agenda de réservations socio (vue jour/semaine/mois)](specs/20-agenda-reservations-socio.md) — **Implémenté** · maj 2026-09-07
- [Connecteur LobbyPMS — contrat générique multi-prestataire](specs/21-connecteur-lobbypms.md) — **Partiel** (reste : Tranche 1 implémentée le 2026-08-19, disponibilité live côté client comblée le…) · maj 2026-09-07
- [Vue référent restreinte — pas d'établissement/mis reservas, liste des ventes attribuées](specs/22-vue-referent-restreinte.md) — **Implémenté** (reste : Validé par Jérôme le 2026-08-20.) · maj 2026-09-07
- [Notifications email transactionnelles (invitation, modération, paiement, réconciliation)](specs/23-notifications-email-transactionnelles.md) — **Implémenté** (reste : Tranche 1 + Tranche 2 livrées. Envoi réel Resend confirmé le 2026-08-31 (8 emails reçus…) · maj 2026-09-07
- [Surface LobbyPMS exploitée, parcours front d'un produit lié, et cible du modèle hébergement](specs/24-modele-hebergement-et-surface-lobbypms.md) — **Partiel** (reste : Lot A implémenté le 2026-08-26 ; Lot B gelé (observation préprod requise) ; T1/T2/T3 de…) · maj 2026-09-07
- [Propagation d'une annulation hifago vers LobbyPMS (C2)](specs/25-propagation-annulation-lobbypms.md) — **Implémenté** (reste : Vérifiée en conditions réelles le 2026-08-27 (booking créé puis annulé chez Casa Kayam)…) · maj 2026-09-07
- [Référencement de la vitrine : Google et moteurs de réponse IA](specs/26-referencement-seo-et-moteurs-ia.md) — **Implémenté** (reste : Vérifiée en local le 2026-09-01 (build, serveur réel, 3 e2e). Validation par un outil…) · maj 2026-09-07
- [Architecture de la vitrine : routes, zones, coquilles et couche d'accès aux données](specs/27-architecture-vitrine-et-routage.md) — **Partiel** (reste : Livrés les 2026-09-07/08 : la couche lib/catalog et search_catalog, les quatre coquilles…) · maj 2026-09-08
- [Vitrine : l'accueil, qui est aussi l'écran de résultats de recherche](specs/28-vitrine-accueil-et-resultats.md) — **Partiel** (reste : Tranches 1 (l'accueil) et 2 (les suggestions de la barre) livrées le 2026-09-08. Reste…) · maj 2026-09-08
- [Vitrine : les pages de listing et l'index de catégories](specs/29-vitrine-listings-et-index-de-categories.md) — **Implémenté** · maj 2026-09-08
- [Vitrine : les fiches produit et établissement](specs/30-vitrine-fiches-produit-et-etablissement.md) — **Implémenté** · maj 2026-09-08
- [Identité anonyme de l'invité](specs/31-identite-anonyme.md) — **Brouillon** · maj 2026-09-10
- [Panier en base](specs/32-panier-en-base.md) — **Implémenté** · maj 2026-09-10
- [Specs — fonctionnalités prêtes à coder, une par une](specs/README.md) — **actif** · maj 2026-09-10
- [Gabarit de spec de feature (à copier, ne décrit aucune feature réelle)](specs/_modele.md) — **modele** · maj 2026-08-16
- [Avant d'écrire une spec — poser les bonnes questions](specs/avant-la-spec.md) — **modele** · maj 2026-08-16

## Journal — historique chronologique (jamais chargé automatiquement)
- [Backlog hifago — points ouverts et arbitrages en attente](backlog.md) · maj 2026-09-10
- [Dette technique et QA/UI connue — hifago](dette-technique.md) · maj 2026-09-10
- [Journal hifago — août 2026](journal/2026-08.md) · maj 2026-09-01
- [Journal hifago — septembre 2026](journal/2026-09.md) · maj 2026-09-10
- [Pièges empiriques hifago — index numéroté](pieges-empiriques.md) · maj 2026-09-09
