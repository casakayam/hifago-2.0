---
id: refonte-cdc-socio
titre: "Cahier des charges — portail socio (aujourd'hui /partner)"
theme: cadrage
statut: brouillon
maj: 2026-08-13
resume: >
  Comportement métier cible du portail partenaire (référent/prestataire), dérivé du comportement
  réel actuel et challengé section par section avec Jérôme avant reprise dans la refonte.
mots_cles: [cahier des charges, socio, partenaire, referent, prestador, portail socio]
repond_a:
  - "Que doit faire le portail socio (apps/admin partie partner) dans la refonte ?"
---

# Cahier des charges — portail socio

> Méthode : une section = une unité de validation avec Jérôme. Statut par section :
> `brouillon` → `en relecture` → `✅ validé par Jérôme le AAAA-MM-JJ`.
> Sources principales : `docs/2-reference/02-app-partner.md`, `docs/2-reference/05-data-model.md`
> (§ Identité partenaire canonique), `docs/5-conception/roles-composables.md`.

> **Cadrage hérité du cahier des charges client** (`01-cahier-des-charges-client.md`) : marketplace
> global (pas scopé à une ville), lacunes connues challengées une à une avec l'aval de Jérôme,
> LobbyPMS/connecteur PMS optionnel par propriété, cycle de vie de commande unifié. Ce document ne
> répète pas ces décisions, il s'appuie dessus.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Périmètre et vision | ✅ validé 2026-08-11 |
| 2 | Parcours utilisateurs | en relecture |
| 3a | Identité composable (rôles, capacités, statuts) | ✅ validé 2026-08-11 |
| 3b | Invitations et onboarding | ✅ validé 2026-08-11 |
| 3c | Dashboard référent (commissions) | ✅ validé 2026-08-11 |
| 3d | Module Prestador — offre et calendrier | ✅ corrigé 2026-08-13 |
| 3e | Proposition de fiches et modération | ✅ validé 2026-08-11 |
| 3f | Photos — proposition vs galerie publiée | ✅ validé 2026-08-11 |
| 3g | Datos de pago | ✅ validé 2026-08-11 |
| 3h | Outil de vente (QR, lien attribué) | ✅ corrigé 2026-08-13 |
| 4 | Entités de données touchées | en relecture |
| 5 | Cas limites | ✅ validé 2026-08-11 |
| 6 | Lacunes connues, challengées une à une | ✅ validé 2026-08-11 |
| 7 | Annexe — traçabilité code→règle | ✅ validé 2026-08-11 |

---

## 1. Périmètre et vision

**Statut : ✅ validé par Jérôme le 2026-08-11**, complété le même jour à deux reprises (identité
unifiée client/socio/admin ; puis multi-établissements, multi-utilisateurs, notifications —
paiement des rétributions laissé « à trancher plus tard », non bloquant).

Le portail socio est l'espace où un **partenaire** (personne ou organisation) gère sa relation
avec la plateforme : ses gains, son offre commerciale s'il en propose une, ses coordonnées de
paiement. Une identité partenaire porte une ou deux **capacités**, jamais devinées côté front —
relues côté serveur à chaque accès :

- **Référent** (`referrer`, toujours présente pour qui a un code) : suit les réservations
  attribuées à ses codes, ses commissions (réelles/estimées/payées), ses justificatifs de
  paiement, et dispose d'un outil de vente (lien/QR attribué).
- **Prestataire** (`operator`, additive) : gère son offre commerciale — produits/services
  vendus, calendrier de disponibilité, photos publiées — en **proposition**, jamais en écriture
  directe sur le catalogue public (sauf deux exceptions explicites, cf. §3d/§3f).

Ces deux capacités sont **composables** : une même identité peut n'avoir que l'une, ou les deux à
la fois (ex. un prestataire qui réfère aussi d'autres clients). Aucun nom de partenaire particulier
n'est câblé en dur — cohérent avec la généralisation multi-établissements déjà actée côté client.

**Décision (2026-08-11)** : ce portail reste **unifié** — un seul compte/portail pour les deux
capacités, comme aujourd'hui. Ce document couvre donc aussi bien un simple référent (ex. un
commerce qui diffuse des QR/liens d'attribution) qu'un prestataire qui vend ses propres offres, dans une
seule et même expérience — pas deux portails séparés.

**Frontières avec les autres portails :**
- **Portail client** : consomme en lecture ce que ce portail a fait approuver (produits, photos,
  grille tarifaire) — jamais l'inverse. Un socio ne publie jamais directement sur le catalogue
  public ; il **propose**, l'admin **modère**.
- **`/admin`** : décide des capacités et de leur statut (onboarding/en revue/suspendu/actif),
  approuve ou rejette les propositions, rattache un prestataire à une fiche du registre.
  Authentification totalement distincte (mot de passe admin unique) — pas de session partagée
  entre l'accès admin d'un établissement et le compte socio de son responsable, même si la même
  personne détient les deux.

**Décision (2026-08-11)** : une **seule base d'utilisateurs** pour tout le produit — client,
socio (référent/prestataire) et admin ne sont plus des systèmes de comptes séparés, mais des
**rôles composables sur une même identité**. Une personne peut cumuler client + référent +
prestataire (+ admin si pertinent) sur un seul compte, sans reconnexion séparée par casquette.
Effet de bord bienvenu : ça résout de facto la lacune connue de l'admin actuel — un mot de passe
unique partagé, aucune action attribuable à une personne (cf. cahier des charges client, et futur
cahier des charges admin) — puisque l'admin devient un rôle sur un compte nominatif comme les
autres, plus un secret partagé.

**Implémenté le 2026-08-15 (Feature 31)** : l'infrastructure d'identité unifiée
(`partner_accounts`/`partner_capabilities`) était déjà prête à recevoir n'importe quel mode de
connexion — restait à construire les écrans. Google OAuth, inscription libre, vérification email
et mot de passe oublié livrés (back-end générique, front `apps/admin`). Spec détaillée :
`docs/specs/07-connexion-inscription-complete.md`.

**Décisions (2026-08-11) — élargissement de la vision, suite au challenge du périmètre :**

- **Multi-établissements** : une identité partenaire (organisation) peut gérer **plusieurs
  établissements/offres** — pas un partenaire = un établissement. Cohérent avec le marketplace
  global déjà décidé côté client (un même groupe peut posséder plusieurs hôtels/activités).
- **Multi-utilisateurs par organisation** : plusieurs personnes peuvent accéder au **même compte
  partenaire**, chacune avec sa propre connexion (pas un mot de passe partagé) — *détail à
  trancher au chiffrage* : niveaux d'accès différenciés (ex. un employé qui gère le calendrier
  sans voir les données financières) ou accès identique pour tous les utilisateurs rattachés.
- **Décision (2026-08-11) — un propriétaire par organisation** : parmi les utilisateurs rattachés
  à une même organisation, un **propriétaire** est toujours désigné — seul rôle habilité à
  inviter/retirer des membres, et qui ne peut se retirer lui-même sans transférer ce statut à un
  autre membre au préalable. Évite qu'une organisation se retrouve sans personne habilitée à gérer
  ses accès (compte orphelin).
- **Notifications proactives** : le partenaire est notifié (canal à définir — email/WhatsApp) à
  chaque événement clé : nouvelle commission attribuée, proposition traitée (approuvée/rejetée),
  paiement effectué. Ne remplace pas la consultation en self-service, la complète.
- **Paiement des rétributions** : le modèle **manuel actuel est conservé pour ce premier
  périmètre** (Jérôme paie hors-plateforme, dépose une preuve, le partenaire voit son statut) —
  un vrai flux self-service (demande de retrait, suivi) n'est **pas encore décidé**, noté comme
  cible future à trancher plus tard (cf. `hifago/README.md`).

**Hors périmètre de ce portail** :
- toute décision de capacité, de statut, ou de rattachement — c'est `/admin` qui tranche ;
- l'écriture directe sur le catalogue public (prix, visibilité, sellable) — toujours via
  proposition + approbation, sauf les deux exceptions du calendrier et de la galerie publiée
  (cf. §3d/§3f), déjà des choix assumés à re-challenger en §6.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Rôle, § Rôles composables.*

---

## 2. Parcours utilisateurs

**Statut : en relecture — à valider avec Jérôme.**

> Décrit les étapes fonctionnelles, pas l'implémentation d'interface actuelle (onglets, modales) —
> qui sera redessinée. Une étape décrite ici doit survivre au changement de front.

**Parcours principal — onboarding et première connexion :**

1. Une **invitation** est créée (par l'admin) pour un rôle donné : référent seul, ou
   référent+prestataire d'emblée. Un partenaire ne s'auto-décrète jamais prestataire à
   l'inscription — sauf via la demande d'ouverture ci-dessous, une fois déjà référent.
2. Le partenaire reçoit un **lien d'inscription à usage unique**, limité dans le temps.
3. Il **crée son compte** — email/mot de passe ou connexion en un clic — mêmes capacités quel que
   soit le mode choisi.
4. Il accède à son **tableau de bord**, dont le contenu dépend de ses capacités *effectives*,
   relues côté serveur à chaque accès — jamais déduites ou mises en cache côté front.

**Parcours secondaire — demande d'ouverture prestataire (self-service)** : un référent sans
capacité prestataire peut la demander depuis son tableau de bord. La décision est **automatique**
selon un critère (aujourd'hui : la zone couverte par le service proposé) — accordée immédiatement
si elle correspond, sinon mise en liste d'attente avec message explicite. Jamais d'attente
silencieuse : le partenaire sait toujours s'il est accordé, en attente, ou refusé.

**Parcours principal — suivi des commissions (capacité référent) :**
- Consulte ses gains (réels / estimés / en attente de paiement / déjà payés), l'historique détaillé
  de ses réservations attribuées, et télécharge/partage son outil de vente (lien attribué, QR).

**Parcours principal — gestion de l'offre (capacité prestataire) :**
- Consulte ses fiches actives (produits/services, ou logement s'il en gère un) avec leur état
  (en vente / en pause / en revue).
- **Propose** une nouvelle fiche, ou une modification d'une fiche existante — jamais publiée
  directement : toute proposition passe par une revue avant d'atteindre le catalogue public.
- **Gère la disponibilité** de son offre — ouvre/ferme des dates, ajuste ses places — en écriture
  **directe** (pas de revue nécessaire : la disponibilité lui appartient par nature).
- **Gère les photos déjà publiées** de ses fiches — retire, réordonne — en écriture **directe** ;
  mais **ajouter** une nouvelle photo repasse par la revue (invariant à conserver : un partenaire
  n'introduit jamais de contenu non modéré dans le catalogue public, mais peut librement retirer
  ou réorganiser ce qui l'est déjà).
- **Propose une date d'agenda** (une offre ponctuelle/multi-jours) — un formulaire dédié, distinct
  d'une fiche vendable classique.

**Parcours transverse — coordonnées de paiement :** renseigne ou met à jour ses coordonnées pour
recevoir ses commissions ; peut vérifier qu'elles sont bien enregistrées sans jamais revoir le
détail complet une fois saisi (accusé de réception masqué, pas la donnée en clair).

**Parcours transverse — support :** un contact direct (aujourd'hui WhatsApp) reste disponible pour
toute question hors self-service — cohérent avec le même principe déjà acté côté portail client.

*Traçabilité : `docs/2-reference/02-app-partner.md` (l'ensemble du document).*

---

## 3a. Identité composable (rôles, capacités, statuts)

**Statut : ✅ validé par Jérôme le 2026-08-11** (portée exacte du statut référent multi-codes
laissée « à confirmer au chiffrage », non bloquante).

Sur l'identité unifiée (§1), quatre rôles composables, chacun avec un périmètre net :

| Rôle | Peut voir | Peut faire | Ne peut pas |
|---|---|---|---|
| **Client** | ses informations, l'historique de ses réservations (cahier des charges client §2) | consulter le catalogue, acheter, gérer ses propres réservations en self-service | rien sur le catalogue d'un tiers, aucune donnée financière d'un autre rôle |
| **Référent** (`referrer`) | ses gains attribués (réel/estimé/payé), le détail de ses réservations attribuées | gérer ses coordonnées de paiement (comment il reçoit sa rétribution), partager son outil de vente (lien/QR) | modifier un produit, voir les gains d'un autre partenaire |
| **Prestataire** (`operator`) | ses propres fiches, **ses propres ventes/revenus** (pas seulement une liste de réservations — décision ci-dessous), l'état de ses propositions | gérer son compte, proposer/gérer des produits (ajout, modification, pause), gérer sa disponibilité et ses photos publiées (cf. §2) | publier directement sur le catalogue, voir la fiche/les ventes d'un autre prestataire |
| **Admin** | tout — clients, socios, prestataires, avec action attribuée à sa propre identité (résout G14) | tout trancher (capacités, statuts, modération, rattachements) **et créer directement des comptes référent/prestataire** (pas seulement via invitation auto-servie) | — (rôle de confiance totale, mais désormais nominatif) |

**Décision (2026-08-11) — un prestataire voit ses revenus, pas seulement ses réservations** :
aujourd'hui, le module prestataire n'affiche qu'une liste de réservations (« Mis Reservas »), sans
total agrégé de ce que ce prestataire a effectivement généré. Dans la cible, il doit voir un
**résumé de ses ventes/revenus**, symétrique de ce qu'un référent voit déjà pour ses commissions —
cohérent avec la demande de départ (« les presta qui peuvent... voir ce qu'ils gagnent »).

**Statuts d'une capacité** : une capacité porte un statut propre — en préparation / en revue /
suspendue / active — qui gouverne ce qui est accessible, indépendamment de la capacité elle-même
(avoir la capacité ne suffit pas si elle est suspendue).

**Décision (2026-08-11)** : le statut existe pour **les deux capacités**, pas seulement
Prestataire — un référent peut aussi être suspendu (ex. abus de code partenaire), sans supprimer son
compte ni ses capacités passées.

**Décision (2026-08-11) — portée par établissement** : avec le multi-établissements acté en §1,
la capacité Prestataire et son statut s'appliquent **par établissement rattaché**, pas globalement
à l'identité — une organisation qui gère plusieurs établissements peut en avoir un suspendu et les
autres actifs. La capacité Référent, elle, reste au niveau de l'identité (un seul statut
référent par partenaire, pas par code) — *point à confirmer au chiffrage* si un partenaire a
plusieurs codes distincts et qu'un seul est en cause.

**Invariant à conserver** : les capacités ne sont jamais une barrière côté interface seulement —
chaque action sensible revalide la capacité et son statut côté serveur, à chaque appel.

**Décision (2026-08-11) — acceptation de contrat obligatoire par rôle** : aujourd'hui,
l'emplacement de contrat est **inerte** (« disponible próximamente ») pour les deux capacités —
aucune acceptation n'est jamais réellement demandée. Dans la cible, une capacité (référent et/ou
prestataire) ne devient **pleinement active** qu'après acceptation explicite et horodatée des
conditions de ce rôle. **Précision (2026-08-11)** : une simple **acceptation électronique en un
clic** (« J'accepte », horodatée, avec la version du texte acceptée) suffit — pas une signature
électronique certifiée ni un document à uploader, disproportionné pour ce cas. Tant que non
acceptée, la capacité reste au statut « en préparation » (§3a), pas « active ».

*Traçabilité : `docs/2-reference/02-app-partner.md` § Rôle, § Module Prestador ; `docs/2-reference/05-data-model.md`
(`partner_capabilities`, invariant `operator ⇒ referrer`).*

---

## 3b. Invitations et onboarding

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Deux chemins d'invitation, créés par l'admin** :
- **Référent seul** : la capacité référent uniquement.
- **Prestataire** (référent + prestataire d'emblée) : porte en plus la référence à
  l'**établissement** qui sera rattaché à l'inscription — créé à ce moment-là s'il n'existe pas
  encore.

**Sécurité de l'invitation** : un jeton **opaque, à usage unique, limité dans le temps** — jamais
le code partenaire public seul comme preuve d'autorisation à créer un compte (cf. §6 — c'est une vraie faille
du système actuel : n'importe qui connaissant un code public pourrait aujourd'hui créer le compte
associé avant le partenaire légitime). Le jeton n'est jamais rejoué une fois consommé.

**Création de compte** : email/mot de passe **ou** connexion en un clic (même fournisseur que le
compte client/admin, cf. identité unifiée §1) — **mêmes capacités dans les deux cas**, aucune
différence de traitement selon le mode choisi.

**Rattachement d'établissement, transactionnel** : pour une invitation « prestataire », la fiche
d'établissement est créée/rattachée **dans la même transaction** que la création du compte —
jamais un compte sans établissement à rattacher derrière, ni un établissement orphelin.
**Invariant à conserver** : un établissement déjà rattaché à une **autre** identité n'est jamais
volé silencieusement — l'inscription réussit, mais le rattachement reste en attente d'arbitrage
admin plutôt que de déposséder le partenaire légitime.

**Généralisation nécessaire (2026-08-11)** : la demande d'ouverture prestataire en self-service
(§2) décide aujourd'hui sur un critère de **ville** codé en dur. Puisque la cible est un
marketplace global (cf. cahier des charges client), ce critère doit devenir générique — une zone
couverte par la plateforme, pas un nom de ville particulier écrit dans le code.

**Décisions (corrigées le 2026-08-13) — format et gestion des codes partenaires d'attribution**
(complète §3c du cahier des charges client) :
- **Format** : une base **lisible**, choisie par/pour le socio (ex. `MEDCAFE`). Un socio qui a
  plusieurs codes peut les distinguer par un suffixe court (ex. `MEDCAFE-IG`, `MEDCAFE-TIKTOK`)
  afin de mesurer différents canaux.
- **Un socio peut créer lui-même des codes additionnels** en self-service ; ils alimentent le même
  moteur d'attribution que le QR et le lien partenaire.
- **Le code n'est plus un mécanisme de remise client actif** : l'ancien 10 % sur l'hébergement est
  désactivé et aucun prestataire ne supporte de discount imposé par l'attribution. La capacité
  technique d'un avantage client futur reste dormante et sous contrôle admin, séparée du code
  d'attribution.
- **Commission et activation restent sous contrôle admin** : le socio ne peut jamais créer un code
  lui donnant un taux de commission ou un statut plus favorable que ceux validés pour son identité.
- Le portail client **n'affiche aucun champ de saisie de code**. Pour la vente, le socio diffuse
  principalement son QR ou son lien attribué ; le code reste l'identifiant secondaire sous-jacent.

**Nouvelles règles nécessaires, suite aux décisions de §1 :**
- **Ajouter un établissement supplémentaire à un partenaire déjà inscrit** — le parcours actuel ne
  couvre que le rattachement **à l'inscription**. Avec le multi-établissements (§1), un partenaire
  existant doit pouvoir en ajouter un autre depuis son compte, pas seulement via une nouvelle
  invitation. *Détail à trancher au chiffrage* : self-service (comme la demande d'ouverture
  prestataire) ou toujours via l'admin.
- **Inviter un coéquipier sur le même compte organisation** (multi-utilisateurs, §1) — mécanisme
  à détailler au chiffrage (invitation dédiée, rôle par utilisateur, etc.), non spécifié plus
  avant ici.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Cycle de vie d'un partenaire, §
Authentification, § `/newp` ouvre la fonction prestataire ; `docs/2-reference/08-known-gaps.md`
(G6, G9).*

**Implémenté le 2026-08-15 — dashboard d'atterrissage, visibilité établissement, gestion admin**
(Feature 29) : le jeton opaque décrit ci-dessus était déjà correctement implémenté (vérifié dans
le code, pas supposé) — rien à corriger sur ce point. Comble deux écarts trouvés en creusant :
`/partner` n'avait aucune page d'accueil (`JoinForm` affichait un message inline sans jamais
rediriger) et le rattachement d'établissement du chemin Prestataire, bien que déjà sûr
(`partner_capabilities.establishment_id` « en attente » + `create_establishment` rattache
automatiquement), n'était visible nulle part côté admin. Spec détaillée dans
`docs/specs/05-invitations-onboarding-dashboard-partenaire.md`.

*Traçabilité additionnelle : `docs/specs/05-invitations-onboarding-dashboard-partenaire.md`.*

---

## 3c. Dashboard référent (commissions)

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Un référent voit, agrégées sur **tous ses codes** (§3b) et sur **tous les établissements** qu'il a
pu référer (§1) : ses gains (réels / estimés / en attente de paiement / payés), le détail par
réservation attribuée, et un état de commission par ligne cohérent avec le cycle de vie de la
commande (client doc §3f) et la règle de reprise de commission (client doc §7/A3) :

| État affiché | Correspond à |
|---|---|
| **Estimée** | ligne pas encore réalisée (réservation en cours, pas encore consommée/passée) |
| **Acquise, à payer** | ligne réalisée, ou annulée sans reversement au client — commission due |
| **Acquise, payée** | commission versée, justificatif disponible |
| **Reprise** | ligne annulée **avec** reversement au client — la commission comptée est retirée |
| *(exclue des totaux)* | ligne jamais arrivée à un état facturable (expirée, jamais consommée) |

**Décision (2026-08-11) — transparence sur les reprises** : une commission **reprise** doit
rester **visible** dans l'historique du référent (avec la mention explicite du retrait), pas
disparaître silencieusement du tableau — un référent qui voit un total baisser sans explication
perd confiance dans le système.

**Décision (2026-08-11) — simplification par rapport au système actuel** : le dashboard actuel
fusionne **deux sources** (un miroir historique JSON + le registre des commandes) avec une
déduplication dédiée, artefact du système hybride actuel. Puisque le cahier des charges client
(§3f) a déjà décidé **un cycle de vie de commande unifié**, la cible n'a besoin que d'**une seule
source** pour ce dashboard — la fusion à deux sources et sa déduplication sont une dette du
système actuel à ne pas reproduire, seulement à gérer comme un sujet de **migration des données
historiques**, pas comme une règle vivante du nouveau système.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Dashboard référent unifié.*

---

## 3d. Module Prestador — offre et calendrier

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Accès conditionné à la capacité ET à son statut** (§3a) — jamais un simple masquage d'onglet
côté front : chaque endpoint revalide la capacité, son statut, et (avec le multi-établissements)
l'établissement concerné. Un statut suspendu renvoie des données vides, pas d'erreur — le
prestataire comprend qu'il est en pause, pas que l'app est cassée.

**Mes offres** : produits/services de tous les établissements rattachés à cette identité (§1),
groupés par établissement puis par famille (hébergement / activités / tours / transport / camps &
événements), avec leur état (en vente / en pause / en revue) et un accès direct à leur calendrier
et à leur photo.

**Décision (2026-08-11) — mes ventes** (nouveau, cf. §3a) : en plus de la liste de réservations
ci-dessous, un résumé **agrégé des revenus générés** par ses propres offres — total vendu, sur
une période — symétrique du dashboard référent (§3c), pas seulement une liste brute.

**Mes propositions** : l'état de chaque fiche proposée (en revue / publiée / rejetée / retirée),
avec le motif explicite en cas de rejet — jamais un rejet silencieux.

**Mes réservations** : les réservations de ses propres offres, avec le minimum d'information
nécessaire à l'exploitation (nom du client, date, quantité, montant, statut) — **jamais** le
contact du client (téléphone, email) : ce n'est pas son canal de relation avec le client final,
la plateforme reste l'intermédiaire.

**Calendrier — écriture directe (une des deux exceptions actées en §1)** : le prestataire
ouvre/ferme ses dates et ajuste ses places, sans passer par une revue — la disponibilité lui
appartient par nature, contrairement au contenu de sa fiche.

**Invariants à conserver, vérifiés côté serveur à chaque écriture (pas seulement suggérés côté
front)** :
- **Trois garde-fous systématiques** : l'identité est résolue, sa capacité prestataire n'est pas
  suspendue, et le produit visé appartient bien à un établissement rattaché à cette identité — un
  produit d'un autre prestataire répond **introuvable**, jamais un refus explicite qui révèlerait
  son existence (empêche d'énumérer le catalogue d'autrui par essais successifs).
- **Une place déjà vendue ne se reprend jamais** : fermer une date, fermer un créneau, ou
  descendre la capacité sous ce qui est déjà vendu est **refusé côté serveur**, quelle que soit
  l'interface utilisée pour la demande — cohérent avec l'invariant anti-survente déjà acté côté
  client (client doc §3d).
- **Cupos par créneau** : pour une offre à créneaux (matin/après-midi), la capacité s'entend par
  créneau, pas par jour — même règle que côté client (§3d du cahier des charges client), lue
  depuis le **même** service pour les deux portails : ils ne doivent jamais montrer deux vérités
  différentes du même calendrier.
- **Miroir client immédiat** : fermer une date ici la retire immédiatement du calendrier public —
  aucun délai de propagation acceptable, sous peine de survente.
- **Décision 2026-08-13 — ressource de disponibilité partagée** : le calendrier d'un camp (et d'un
  evento rendu réservable) est relié à la ressource/calendrier du prestataire qui l'organise. Sa
  durée consomme une période continue : un départ n'est réservable que si toute cette période est
  disponible. Une réservation confirmée bloque automatiquement et atomiquement cette période pour
  les autres activités du même prestataire reliées à la ressource, afin d'empêcher le double
  booking.
- **Notification automatique** : après confirmation, le prestataire reçoit un message indiquant
  que le camp ou l'evento a été réservé, les dates bloquées et les autres activités devenues
  indisponibles. Le blocage est déjà effectif au moment du message ; il ne dépend pas d'un « oui/non »
  postérieur.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Module Prestador, § Calendrier
prestataire (C5).*

---

## 3e. Proposition de fiches et modération

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Trois propriétés de sûreté, toutes vérifiées côté serveur** (à conserver strictement dans la
cible) :
1. **Rien n'est publié directement.** Une proposition vit à part, jamais dans le catalogue public
   tant qu'elle n'est pas approuvée.
2. **Le prestataire ne propose que du contenu** — jamais les taux de commission, la remise, la
   visibilité (`sellable`), ou les identifiants d'un connecteur PMS : ces champs restent des
   décisions admin, ignorés même s'ils sont envoyés dans la proposition.
3. **Une modification ne change rien tout de suite.** La fiche publiée garde ses valeurs
   actuelles jusqu'à l'approbation ; le formulaire de modification est pré-rempli avec la fiche
   **complète**, pour qu'un champ non retouché ne soit pas effacé à l'approbation.

> **Révisé le 2026-08-17** (décision Jérôme, cf. `docs/specs/15-socio-creation-produit.md`) : le
> mécanisme de proposition de **création** d'une fiche entièrement nouvelle couvre désormais les
> **6 types de produit sans exception** — y compris `lodging`/`hotel`. La règle « jamais un
> hébergement directement » du paragraphe ci-dessous ne s'applique donc plus à la **création**.
> Le paragraphe « Proposer la grille tarifaire d'un hébergement » plus bas reste inchangé et
> **distinct** : il décrit l'édition de la tarification d'un hébergement **déjà rattaché**, un
> mécanisme séparé, toujours non construit à ce jour — hors périmètre de cette révision. Jusqu'à 6
> photos incluses dès la proposition de création elle-même (même plafond que le « jusqu'à 6
> photos » ci-dessous, décision confirmée par Jérôme le même jour après un premier passage où elles
> avaient été différées après approbation) — à l'exception des photos PAR CHAMBRE d'un hôtel,
> toujours hors périmètre socio (cf. spec 15 §10).

**Proposer une fiche classique** (activité, tour, transport — jamais un hébergement directement,
cf. ci-dessous) : nom, description, prix, cupos, planification, unité de facturation, un ou
plusieurs **tags** de catégorisation (cf. client doc §2 — remplace la liste fixe actuelle de 6
familles), une note libre pour l'équipe, jusqu'à 6 photos. Repart en revue à chaque modification
significative ; retirable par le prestataire tant qu'elle n'a pas été traitée.

**Proposer un CAMP** — parcours dédié multi-jours, distinct de l'evento : le camp est réellement
réservable (prix réel, cupos, durée, calendrier partagé du prestataire — fermé par défaut à la
publication). Le prestataire ouvre sa disponibilité et la réservabilité effective est ensuite
calculée sur toute la durée du camp (§3d).

**Proposer un EVENTO** — parcours dédié séparé : l'evento s'annonce d'abord comme contenu
éditorial (prix textuel libre, aucun cupo par défaut). Le rendre réservable en ligne est une
décision admin explicite ; s'il devient réservable, il consomme lui aussi la ressource de
disponibilité du prestataire selon sa durée.

Différences structurelles à conserver :
- **Modifier un camp ou un evento déjà publié** : pour **chacune des deux familles**, deux gestes
  restent distincts — **corriger** la fiche existante (vise le produit existant, ne crée jamais de
  doublon), ou **annoncer une autre date** (nouvelle proposition, dates vidées, sans cible existante).
  Les confondre publierait soit un doublon, soit effacerait la date en cours par erreur.
- **Garde de cohérence dans les deux sens** : le contenu envoyé doit correspondre à la nature de
  la fiche visée — une correction de camp porte des champs de camp, jamais l'inverse.

**Proposer la grille tarifaire d'un hébergement** : un prestataire **ne crée jamais un
hébergement** — un lieu de séjour s'enregistre au niveau du registre (cf. §3b, ajout
d'établissement), pas depuis une proposition de fiche. Un prestataire dont l'hébergement est déjà
rattaché peut en revanche proposer **sa grille tarifaire** (paliers par nombre de personnes,
saison haute, dépôt, inclusions) — jamais un prix d'appel unitaire, qui se déduit du palier le
moins cher.

**Limites** (valeurs actuelles, à revalider) : un nombre maximum de propositions en attente par
identité, un nombre maximum de photos par fiche — pour éviter qu'une seule identité sature la
file de modération.

Capacité suspendue (§3a/§3d) ⇒ aucune proposition possible, quelle qu'elle soit.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Proposer une fiche, § Proposer un CAMP ou
un EVENTO, § Proposer SA grille tarifaire d'hébergement.*

---

## 3f. Photos — proposition vs galerie publiée

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Ce que le prestataire voit sur sa propre fiche doit être exactement ce que voit le client** —
jamais une divergence qui lui ferait croire sa fiche vide alors qu'elle a une belle photo. Une
photo affichée peut venir de trois origines, et le prestataire doit toujours savoir laquelle :
- **la sienne** (envoyée par lui, approuvée) — rien à signaler, elle lui appartient ;
- **emprunt du lieu** (bannière/galerie de l'établissement) — signalé explicitement comme tel ;
- **générique déduite du nom** (repli du portail quand aucune photo propre n'existe) — signalé
  explicitement comme tel.

**Deuxième exception d'écriture directe (avec le calendrier, §3d)** — gérer les photos **déjà
publiées** d'une fiche : **retirer** une photo, **réordonner** la galerie (la première devient la
couverture). Ligne de partage, pas sur l'objet mais sur le **sens de l'action** :
- **retirer/réordonner** = écriture directe, car l'action ne peut que réduire ou réorganiser du
  contenu **déjà modéré** — jamais introduire quoi que ce soit de nouveau ;
- **ajouter** une photo = repasse toujours par la revue (§3e), c'est le vrai garde-fou contre une
  image inappropriée publiée d'un clic.
- **Invariant à conserver sous cette forme précise** : *un prestataire n'introduit jamais de
  contenu non modéré dans le catalogue public* — pas « un prestataire ne touche jamais à ses
  photos », qui serait trop restrictif et inutile.

**Ajouter une photo à une fiche déjà publiée** : une proposition dédiée « photos seules »,
réutilisée pour tous les ajouts en attente d'une même fiche (pas une proposition par photo — sinon
quelques photos épuiseraient le plafond de propositions en attente, §3e). Son approbation
**ajoute les images et ne touche à rien d'autre** — même si l'admin fournit d'autres valeurs par
erreur, le nom/prix/description restent inchangés. Ça protège un prestataire qui voulait juste
illustrer sa fiche de ne jamais écraser son propre prix par erreur.

**Décision (2026-08-11) — lien de prévisualisation côté client** : un prestataire doit pouvoir
**voir sa fiche comme la voit le client**, à deux moments :
- **avant publication** (proposition en attente) : un aperçu avec le contenu proposé (pas encore
  live), pour vérifier avant que l'admin ne traite la demande ;
- **après publication** : un lien direct vers la fiche réelle sur le catalogue client.

Ça vaut pour la fiche entière (texte, prix, photos) — noté ici parce que la divergence
prestataire/client déjà décrite plus haut est exactement le problème que ce lien réduit. Détail
d'implémentation (aperçu isolé vs vraie page client en mode preview) à trancher au chiffrage.

**Règles transverses** :
- **Vider entièrement la galerie est permis** — le repli générique (déduit du nom) garantit que
  la fiche n'a jamais un trou visuel, le prestataire n'est jamais prisonnier d'une photo qu'il ne
  veut plus.
- **Le cache public est invalidé à chaque écriture** — un client ne doit jamais voir une galerie
  périmée après une action du prestataire.
- **Mêmes règles pour toute famille d'offre** — activité, tour, transport, hébergement, camp et evento
  ont exactement les mêmes gestes disponibles ; aucune famille ne doit être un citoyen de seconde
  classe sur sa propre galerie.
- Un échec d'effacement du fichier physique après une suppression réussie en base n'est **jamais**
  remonté au prestataire comme une erreur — de son point de vue, l'action a réussi.

*Traçabilité : `docs/2-reference/02-app-partner.md` § La photo montrée est celle de `/guatape`,
§ Galerie publiée d'une fiche.*

---

## 3g. Datos de pago

**Statut : ✅ validé par Jérôme le 2026-08-11 ; méthode de paiement rouverte et retranchée le
2026-08-18 (Mercado Pago obligatoire, cf. ci-dessous et spec 19).**

Le partenaire renseigne ses coordonnées pour recevoir sa rétribution (§1 — modèle manuel pour ce
premier périmètre) : un nom, et **au moins un** moyen de paiement valide.

**Décision (2026-08-11) — accusé de réception, jamais la donnée en clair après saisie** : une
fois enregistrées, les coordonnées ne sont jamais réaffichées complètes — seuls les derniers
chiffres identifient le moyen déjà enregistré, pour que le partenaire sache que Kayam/la
plateforme les détient déjà **sans** que le numéro complet retraverse le réseau à chaque
consultation. Invariant de sécurité à conserver tel quel dans la cible.

**Décision (2026-08-11), rouverte le 2026-08-18 — méthodes de paiement** : **Mercado Pago devient
le canal obligatoire** de règlement du référent et de la compensation établissement (no-show),
remplaçant Bancolombia/Nequi pour ce cas précis — d'autres méthodes viendront probablement
(marketplace global), mais ce n'est pas à généraliser maintenant. Le virement est désormais
**automatique**, déclenché par API une fois la prestation réalisée (jamais un geste manuel admin,
jamais un split au moment du paiement client) — voir
`docs/specs/19-paiement-mercadopago-acompte-ledger.md` pour le détail complet et le découpage en
tranches. Noté comme cible future dans `hifago/README.md`.

**Décision (2026-08-11) — un jeu de coordonnées par établissement** : avec le
multi-établissements (§1), chaque établissement déclare ses propres coordonnées de paiement —
même si ça duplique l'information déjà connue au niveau de l'identité (ex. le même partenaire
saisit les mêmes coordonnées pour deux établissements) : accepté, pas un problème à résoudre.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Datos de pago.*

---

## 3h. Outil de vente (QR, lien attribué)

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Chaque **code partenaire d'attribution** (§3b — un partenaire peut en avoir plusieurs) porte son
propre **lien de réservation attribué** et son propre **QR** encodant ce lien. Avec plusieurs codes
(un par canal), chaque QR/lien permet de mesurer le canal correspondant.

**Jamais de QR anonyme** : sans code partenaire valide, aucun QR n'est généré.

**Décision 2026-08-13 — QR/lien comme outils client, code comme mécanisme secondaire** : le QR et
le lien attribué sont les moyens de diffusion vers le client final. Le code reste visible/copiable
dans l'espace socio comme identifiant d'attribution et pour les usages techniques/support, mais le
portail client n'offre plus de champ permettant de le saisir manuellement. QR, lien et code
convergent tous vers **un seul moteur d'attribution**.

**Contraintes à conserver** :
- le **QR téléchargeable en SVG** (vectoriel, qualité garantie à toute taille d'impression), en
  plus d'un format raster pour un usage écran/capture rapide ;
- le **lien** est copiable/partageable indépendamment du QR ; le **code** sous-jacent reste affiché
  comme identifiant secondaire, mais n'est plus présenté comme quelque chose que le client doit
  taper dans le portail ;
- un **bouton de support direct** (aujourd'hui WhatsApp) pré-rempli avec le code concerné,
  pour toute question sur son fonctionnement.

**Point à challenger avec Jérôme — QR ré-attribuable** : aujourd'hui, le QR encode directement
l'URL finale de réservation — si cette URL doit changer un jour (nouveau domaine, structure
d'URL différente), tout QR déjà **imprimé** devient obsolète, sans recours. *Recommandation* :
faire pointer le QR vers une **redirection interne courte** (ex. `/r/<code>`) qui, elle,
redirige vers l'URL réelle — un support déjà imprimé reste valide même si l'URL de destination
change plus tard, puisque seule la redirection est mise à jour, jamais le support physique.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Dashboard référent unifié (bloc QR) ;
`docs/2-reference/02-app-partner.md` § Rôles composables (QR non ré-attribuable, C9).*

---

## 4. Entités de données touchées

**Statut : en relecture — à valider avec Jérôme.**

Reprend la base d'identité unifiée du cahier des charges client (§4) — pas de duplication ici,
seulement ce qui est **spécifique** au portail socio. Voir `hifago/docs/00-modele-de-donnees.md`
pour l'audit champ par champ des entités partagées (établissement, chambre, produit, compte, code
promo) — notamment le **gap critique** : aucun mécanisme de prix/disponibilité pour un
établissement à chambres multiples sans PMS, alors que le module Prestador (§3d) doit pouvoir
gérer un tel établissement.

**Lu par le portail (limité à ce qui appartient à l'identité connectée — jamais celui d'un tiers)** :
- Ses capacités et leur statut, ses codes partenaires d'attribution et leur activation/commission (fixées par l'admin, §3b).
- Ses établissements rattachés (potentiellement plusieurs, §1) et leurs produits/fiches.
- Le calendrier de ses propres produits.
- Les commandes/lignes attribuées à ses codes (dashboard référent, §3c) ou vendues par ses
  établissements (mes ventes, §3d).
- Ses coordonnées de paiement, en lecture masquée (§3g).

**Écrit par le portail** :
- **Calendrier** de ses produits — écriture directe (§3d).
- **Galerie déjà publiée** de ses fiches — retrait/réordonnancement direct (§3f).
- **Propositions** (nouvelle fiche, modification, photos, grille tarifaire) — jamais le
  catalogue public directement (§3e).
- **Codes partenaires additionnels** — création self-service ; ils alimentent l'attribution
  QR/lien, sans remise client active (§3b/§3h).
- **Coordonnées de paiement** (§3g).

**Nouvelles entités, suite aux décisions de §1 :**
- **Rattachement multi-établissements** : une identité partenaire peut être liée à plusieurs
  établissements, chacun avec son propre statut de capacité (§3a).
- **Utilisateurs d'une organisation** : plusieurs comptes de connexion rattachés à une même
  identité partenaire (détail des niveaux d'accès différenciés renvoyé au chiffrage, §1).

**Écarté du périmètre socio, propre à `/admin`** : décision des capacités et de leur statut,
approbation/rejet des propositions, rattachement d'un établissement à une identité, création de
comptes socio par l'admin (§3a).

*Traçabilité : `docs/2-reference/05-data-model.md` § Identité partenaire canonique, § Fiches
proposées par les socios.*

---

## 5. Cas limites

**Statut : ✅ validé par Jérôme le 2026-08-11.**

- **Capacité accordée sans établissement encore rattaché** : un prestataire peut avoir sa
  capacité active avant même qu'un établissement lui soit rattaché (ex. capacité accordée à la
  main, ou détachement temporaire) — il voit son module avec des listes vides, mais peut déjà
  **proposer** une fiche ; c'est l'admin qui désignera l'établissement à l'approbation. Jamais un
  blocage total faute de rattachement.
- **Nouvelle règle, suite au multi-établissements (§1)** : quand un partenaire gère plusieurs
  établissements, toute proposition doit préciser **explicitement** à quel établissement elle se
  rattache — jamais une ambiguïté résolue par défaut/au hasard.
- **La suspension n'est jamais rétroactive** : suspendre une capacité bloque les **nouvelles**
  actions (proposer, modifier le calendrier), mais ne défait jamais ce qui est déjà publié ou déjà
  vendu — cohérent avec l'invariant anti-survente déjà acté (une place vendue ne se reprend
  jamais, cf. §3d).
- **Robustesse de l'envoi de photos sous charge** : plusieurs envois simultanés ne doivent jamais
  faire échouer un envoi déjà accepté, mais un afflux excessif doit être refusé proprement (message
  clair, pas un blocage silencieux) plutôt que de saturer le serveur — principe à conserver, sans
  figer les seuils numériques actuels qui dépendent de la machine derrière.

*Traçabilité : `docs/2-reference/02-app-partner.md` § Module Prestador, § Traitement des photos
prestataire.*

---

## 6. Lacunes connues, challengées une à une

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Filtré depuis `docs/2-reference/08-known-gaps.md` sur ce qui touche le portail socio.

**Déjà résolues par des décisions précédentes de ce document :**

| Lacune | Traitement retenu |
|---|---|
| G6 — code partenaire public seul comme preuve d'inscription | §3b : jeton d'invitation opaque à usage unique, jamais le code seul. |
| G7 — identités référent/prestataire séparées, pas de compte canonique | §1 : identité unifiée client/socio/admin, rôles composables. |
| G9 — `/newr` inexistant, rôle non fiable transporté par `/newp` | §3b : deux chemins d'invitation typés (référent seul / prestataire), rôle porté explicitement par l'invitation. |
| G14 — admin à mot de passe unique, action non attribuable | §1 : admin devient un rôle nominatif sur l'identité unifiée. |
| C9 — QR non ré-attribuable | §3h : recommandation de redirection interne courte, déjà actée. |

**Nouvelles décisions à prendre pour ce document :**

- **G2 — décision (2026-08-11) : à corriger.** Le lien vers un justificatif de paiement passe
  aujourd'hui le jeton de session dans l'URL (`?token=...`), visible dans l'historique du
  navigateur. La cible adopte le pattern déjà utilisé côté admin pour le même besoin : récupérer
  le fichier via une requête authentifiée classique (en-tête d'autorisation), jamais un secret de
  session dans une URL.
- **A8 — décision (2026-08-11) : limite dédiée.** L'inscription/la demande d'invitation
  partenaire partage aujourd'hui la limite générique de toute l'authentification. Dans la cible,
  elle porte sa **propre limite de fréquence**, dimensionnée pour ce flux spécifique plutôt que
  diluée dans une limite globale conçue pour tout `/api/auth`.

**Hors périmètre de ce document, propre à `/admin` :**
- **A12** — la grille tarifaire proposée ne s'édite pas dans la file d'approbation admin (elle
  s'accepte, se refuse, ou se corrige ensuite dans le catalogue) : comportement déjà cohérent
  avec §3e, mais la décision de fond (faut-il un éditeur dans la file elle-même ?) relève du
  futur cahier des charges admin, pas de celui-ci.

*Traçabilité : `docs/2-reference/08-known-gaps.md` (G2, G6, G7, G9, G14, A8, A12, C9).*

---

## 7. Annexe — traçabilité code→règle

**Statut : ✅ validé par Jérôme le 2026-08-11.**

### Fichiers sources par section

| Section | Fichiers sources principaux |
|---|---|
| §1 Périmètre et vision | `docs/2-reference/02-app-partner.md` (§ Rôle, § Rôles composables) |
| §2 Parcours utilisateurs | `docs/2-reference/02-app-partner.md` (l'ensemble) |
| §3a Identité composable | `docs/2-reference/02-app-partner.md` (§ Rôle, § Module Prestador), `docs/2-reference/05-data-model.md` (`partner_capabilities`) |
| §3b Invitations et onboarding | `docs/2-reference/02-app-partner.md` (§ Cycle de vie d'un partenaire, § Authentification), `08-known-gaps.md` (G6, G9) |
| §3c Dashboard référent | `docs/2-reference/02-app-partner.md` (§ Dashboard référent unifié) |
| §3d Module Prestador | `docs/2-reference/02-app-partner.md` (§ Module Prestador, § Calendrier prestataire C5) |
| §3e Proposition de fiches | `docs/2-reference/02-app-partner.md` (§ Proposer une fiche, § CAMP/EVENTO, § grille tarifaire) |
| §3f Photos | `docs/2-reference/02-app-partner.md` (§ La photo montrée est celle de `/guatape`, § Galerie publiée) |
| §3g Datos de pago | `docs/2-reference/02-app-partner.md` (§ Datos de pago) |
| §3h Outil de vente | `docs/2-reference/02-app-partner.md` (§ Dashboard référent unifié, bloc QR) |
| §4 Entités de données | `docs/2-reference/05-data-model.md`, `hifago/docs/00-modele-de-donnees.md` (audit transverse) |
| §5 Cas limites | `docs/2-reference/02-app-partner.md` (§ Module Prestador, § Traitement des photos) |
| §6 Lacunes connues | `docs/2-reference/08-known-gaps.md` (G2, G6, G7, G9, G14, A8, A12, C9) |

### Points explicitement laissés ouverts pour le chiffrage technique

1. **§1/§4** — niveaux d'accès différenciés entre utilisateurs d'une même organisation (accès
   identique pour tous, ou permissions par personne ?).
2. **§3a** — le statut suspendu du rôle référent s'applique-t-il à l'identité entière ou par code,
   si un partenaire a plusieurs codes et qu'un seul est en cause ?
3. **§3b** — l'ajout d'un établissement supplémentaire à un partenaire déjà inscrit se fait-il en
   self-service ou toujours via l'admin ? Mécanisme d'invitation d'un coéquipier non spécifié.
4. **§3f** — aperçu de fiche avant publication : composant de prévisualisation isolé, ou vraie
   page client en mode preview ?

### Cibles futures importantes (hors périmètre immédiat)

Consolidées dans `hifago/README.md` : flux self-service de paiement des rétributions, méthodes de
paiement hors Colombie, droit à l'export/suppression de données, facture/document fiscal,
statistiques de performance, résolution de litige, passe de sécurité sur tous les tokens/jetons.

*Voir aussi `hifago/docs/00-modele-de-donnees.md` pour l'audit champ par champ des entités
partagées (établissement, chambre, produit, compte, code partenaire) — notamment le gap critique
(établissement à chambres sans PMS) et le schéma dormant déjà réutilisable (politique
d'annulation, coordonnées de paiement par établissement, jeton PMS par prestataire).*

**Noté pour plus tard — passe de sécurité dédiée sur tous les tokens/jetons du système** (pas
seulement G2 ci-dessus) : JWT de session, jeton d'invitation, jeton de réinitialisation de mot de
passe, jeton de téléchargement de justificatif — revue systématique (durée de vie, portée,
révocation, jamais en URL) avant mise en production. Reprise dans `hifago/README.md`.