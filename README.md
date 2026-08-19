# hifago/ — refonte complète Casa Kayam / Hifago

Ce dossier contient tout ce qui concerne la refonte du produit : d'abord le cahier des charges
fonctionnel, plus tard le nouveau code. Le projet actuel (racine du dépôt) reste en production
sans interruption pendant toute la durée de ce chantier — rien ici ne le modifie.

## Philosophie

On repart d'une base saine. Le cahier des charges décrit le comportement métier réel du produit
actuel, mais ne reproduit rien passivement : chaque règle — y compris les lacunes connues du
code actuel — est challengée avant d'être reprise dans la cible, avec l'aval de Jérôme.

## État du chantier

1. **Cahier des charges fonctionnel** (✅ terminé 2026-08-11) — un document par portail, validé
   section par section avec Jérôme, jamais d'un bloc :
   - `docs/00-modele-de-donnees.md` — audit transverse des entités de données (champ par champ)
   - `docs/01-cahier-des-charges-client.md` — portail client, marketplace global (✅ validé)
   - `docs/02-cahier-des-charges-socio.md` — portail socio (aujourd'hui `/partner`) (✅ validé)
   - `docs/03-cahier-des-charges-admin.md` — back-office (aujourd'hui `/admin`) (✅ validé)
2. **Choix de stack et architecture cible** (✅ validé par Jérôme le 2026-08-12) —
   `docs/04-architecture-cible.md`. Next.js (App Router, une seule app) sur Vercel + Supabase
   utilisé pleinement (Postgres/PostGIS, Auth, Storage, Realtime, Edge Functions/pg_cron), sans
   Fly.io. Chaque brique a été comparée à des alternatives réelles (Neon, Convex, Clerk/WorkOS,
   Cloudflare, plateformes CRM/low-code, six familles de bibliothèques UI) plutôt que confirmée
   par confort, puis soumise à une revue adversariale avant validation.
3. **Plan de bascule** (👉 prochaine étape) — nouvelle app construite en parallèle, migration de
   données, cutover. L'app actuelle reste la seule en production jusqu'à ce moment.

## Décisions de cadrage déjà prises

- **Identité unifiée (2026-08-11)** : une seule base d'utilisateurs pour tout le produit — client,
  socio (référent/prestataire) et admin sont des **rôles composables** sur une même identité, pas
  des systèmes de comptes séparés. Résout au passage la lacune connue de l'admin actuel (mot de
  passe unique partagé, aucune action attribuable à une personne). Voir
  `docs/01-cahier-des-charges-client.md` §1/§4 et `docs/02-cahier-des-charges-socio.md` §1.

- **Lacunes connues** : challengées une à une (vrai besoin métier vs artefact du code legacy),
  correction proposée si besoin, décision finale avec l'aval explicite de Jérôme. Pas de
  reproduction par défaut.
- **LobbyPMS** : traité comme un connecteur optionnel par propriété (comme aujourd'hui : Casa
  Kayam est PMS-backed, Bania ne l'est pas), pas un lien en dur — pour rester valable si d'autres
  hébergements s'ajoutent sans PMS ou avec un PMS différent.
- **Paiement en ligne** : **tranché le 2026-08-18** — Mercado Pago (remplace Wompi/Stripe comme
  hypothèse), acompte obligatoire, ledger de règlement, virement automatique au référent et à
  l'établissement (compensation no-show). Voir
  `docs/specs/19-paiement-mercadopago-acompte-ledger.md`.
- **Niveau de détail des specs** : règles métier, invariants et contrats d'API — pas les détails
  d'implémentation UI de l'app actuelle (le front sera entièrement refait), sauf quand un détail
  UI encode en réalité une règle serveur.
- **Audience des documents** : pensés pour alimenter directement un plan de refonte complet avec
  des étapes exécutables — précision technique assumée (fichier:fonction source, contrats d'API).
- **Multi-localisation / global dès le départ (révisé 2026-08-11)** : la cible n'est plus scopée
  à Guatapé — c'est un **marketplace global**, où une ville/zone (Guatapé aujourd'hui) n'est
  qu'une **localisation/tag** comme une autre, pas l'identité du produit. Recherche géographique
  (rayon 20km), tags de catégorie et pages de listing (cf. `docs/01-cahier-des-charges-client.md`
  §2) sont pensés en conséquence dès ce premier cahier des charges, pas comme une extension
  future.

## ⚠️ Cibles futures importantes — à ne pas perdre de vue

Pas à implémenter dans le premier périmètre, mais à reprendre explicitement au chiffrage des
phases suivantes :

- **Synchronisation externe (iCal minimum) pour les propriétés sans PMS.** Le calendrier interne
  ne protège que contre une survente à l'intérieur du portail — dès qu'on ouvre à plusieurs
  hôtels/maisons indépendants qui vendent potentiellement aussi sur Booking.com/Airbnb, le risque
  de survente inter-canaux devient réel. Voir `docs/01-cahier-des-charges-client.md` §5.
- **Paiement en ligne** (Mercado Pago, tranché le 2026-08-18) — voir décisions de cadrage
  ci-dessus et `docs/specs/19-paiement-mercadopago-acompte-ledger.md`.
- **Options pour les logements entiers** : séjour minimum, délai de préavis minimum, tarif
  week-end différencié — bonnes options à garder en tête, pas construites dans ce premier lot.
  Voir `docs/01-cahier-des-charges-client.md` §7 (A11).
- **Avis/notes clients** par fiche et par prestataire — important pour la confiance dans un
  marketplace multi-prestataires, mais pas construit dans ce premier périmètre. Voir
  `docs/01-cahier-des-charges-client.md` §2.
- **Liste de souhaits/favoris** — mineur, pas construit dans ce premier périmètre.
- **Flux self-service de paiement des rétributions** (demande de retrait à la volée, suivi en
  temps réel) — reste hors périmètre (spec 19, 2026-08-18) : le virement devient automatique
  (déclenché par API dès la ligne réalisée) mais le référent n'a pas d'interface pour en déclencher
  un à la demande. Voir `docs/02-cahier-des-charges-socio.md` §1 et
  `docs/specs/19-paiement-mercadopago-acompte-ledger.md`.
- **Méthodes de paiement au-delà de la Colombie** — Mercado Pago devient le canal obligatoire
  (référent et établissement, remplace Bancolombia/Nequi, spec 19) ; à généraliser au-delà si un
  partenaire hors zone Mercado Pago se présente. Voir `docs/02-cahier-des-charges-socio.md` §3g.
- **Droit à l'export/suppression de ses données** (Habeas Data, self-service) — cohérent avec les
  pages légales déjà décidées côté client, pas encore spécifié côté socio.
- **Facture/document fiscal** pour un prestataire (pratique DIAN locale) — pas urgent, pratique
  actuelle informelle.
- **Statistiques de performance** pour un prestataire (vues, taux de conversion) — nice-to-have.
- **Résolution de litige formalisée** (client/référent/prestataire) — probablement prématuré.
- **Passe de sécurité dédiée sur tous les tokens/jetons du système** (JWT de session, jetons
  d'invitation, de réinitialisation, de téléchargement de justificatif) — revue systématique
  (durée de vie, portée, révocation, jamais en URL) avant mise en production, pas seulement les
  cas déjà repérés (G2). Voir `docs/02-cahier-des-charges-socio.md` §6.
