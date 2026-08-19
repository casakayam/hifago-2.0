---
id: refonte-cdc-client
titre: "Cahier des charges — portail client (marketplace global, Guatapé = première localisation)"
theme: cadrage
statut: brouillon
maj: 2026-08-13
resume: >
  Comportement métier cible du portail de réservation client, dérivé du comportement réel actuel
  et challengé section par section avec Jérôme avant reprise dans la refonte.
mots_cles: [cahier des charges, client, portail client, reservation, marketplace, guatape]
repond_a:
  - "Que doit faire le portail client (apps/web) dans la refonte ?"
---

# Cahier des charges — portail client

> Méthode : une section = une unité de validation avec Jérôme. Statut par section :
> `brouillon` → `en relecture` → `✅ validé par Jérôme le AAAA-MM-JJ`.
> Sources principales : `docs/2-reference/04-app-reservar.md`, `docs/1-manuels/10-client.md`,
> `src/services/pricingService.js`, `src/services/portalService.js`.

> **Décision (2026-08-11)** : ce document ne parle plus de « `/guatape` » comme identité du
> produit. La cible est un **marketplace global**, pas un site scopé à une ville — Guatapé n'est
> plus qu'une **localisation/tag** parmi d'autres (cohérent avec la recherche géographique et les
> tags de catégorie du §2). Les sources ci-dessus, issues du système actuel, restent scopées
> Guatapé/Casa Kayam ; ce document en extrait le comportement métier généralisable, pas le nom.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Périmètre et vision | ✅ validé 2026-08-11 |
| 2 | Parcours utilisateurs | ✅ validé 2026-08-11 |
| 3a | Catalogue et tarification produits | ✅ corrigé 2026-08-13 |
| 3b | Moteur de commission (17/10/7) | ✅ validé 2026-08-11 |
| 3c | Code partenaire / attribution référent | ✅ corrigé 2026-08-13 |
| 3d | Disponibilité, cupos, calendrier | ✅ corrigé 2026-08-13 |
| 3e | Règles de panier | ✅ validé 2026-08-11 |
| 3f | Cycle de vie de la commande | ✅ validé 2026-08-11 |
| 4 | Entités de données touchées | ✅ corrigé 2026-08-13 |
| 5 | Intégration LobbyPMS | ✅ validé 2026-08-11 |
| 6 | Cas limites | ✅ validé 2026-08-11 |
| 7 | Lacunes connues, challengées une à une | ✅ validé 2026-08-11 |
| 8 | Annexe — traçabilité code→règle | à rédiger |

---

## 1. Périmètre et vision

**Statut : ✅ validé par Jérôme le 2026-08-11** (revalidé après réouverture pour le compte client).

Le portail client est le point de vente direct au visiteur final. Il permet de composer et payer
(à l'arrivée) une réservation combinant, dans une seule commande :

- une ou plusieurs **nuits** (dortoir/chambre d'un hôtel/hostel, ou maison entière d'un
  logement complet — deux patterns génériques, cf. §3a ; Casa Kayam et Bania ne sont que les
  instances actuelles de ces patterns, pas des cas particuliers du produit) ;
- des **activités** (musique/studio, arts et culture, bien-être, nautique, adrénaline,
  gastronomie) ;
- du **transport** (un ou plusieurs prestataires) ;
- des **camps** (escapades multi-jours vendables, avec une durée et une capacité propres) ;
- des **eventos** (événements éditoriaux/ponctuels ou récurrents, distincts des camps dans le
  parcours client ; un evento n'est réservable en ligne que si l'admin l'a explicitement activé).

Une commande **sans nuit** (prestations seules) est autorisée. Le mécanisme historiquement nommé
« code promo » est désormais un **code partenaire d'attribution** : il sert à rattacher la commande
au référent et à calculer les commissions, au même titre que le QR/lien attribué. **Aucune remise
client liée à ce code n'est active dans le périmètre actuel** ; l'ancien 10 % sur l'hébergement est
abandonné. La capacité technique d'un avantage client futur reste dormante et découplée de
l'attribution (§3c).

**Nouvelle règle décidée (2026-08-11) — compte client** : contrairement à ce qui était validé
initialement (portail « sans compte »), la cible inclut un **compte client** — connexion,
consultation de ses informations, historique de ses réservations (détaillé en §2). *Recommandation
à confirmer* : ce compte reste **optionnel** — réserver en tant qu'invité, sans jamais se
connecter, doit rester possible (c'est la norme dans les apps de réservation : forcer un compte
avant achat fait perdre des ventes) ; le compte n'apporte qu'un confort en plus, jamais une
obligation pour réserver.

**Décision (2026-08-11, précisée dans le cahier des charges socio §1)** : ce compte client n'est
pas un système à part — c'est la **même base d'utilisateurs** que celle des portails socio et
admin, avec des **rôles composables** (client / référent / prestataire / admin) sur une seule
identité. Une personne qui réserve ET réfère des clients n'a qu'un seul compte.

**Frontières avec les autres portails :**
- **`/partner`** (socio) : configure son offre (produits, calendrier, tarifs maison entière),
  reçoit ses commissions. Le portail client ne fait que **consommer en lecture** le catalogue
  qu'un socio a fait approuver côté admin — aucune logique de configuration ici.
- **`/admin`** : source de vérité du catalogue (prix, visibilité, réservabilité, ordre
  d'affichage). Le portail client n'écrit jamais dans le catalogue, seulement dans les commandes.
- **LobbyPMS** : connecteur **optionnel, par propriété** — pas une dépendance globale. Une
  propriété avec PMS (aujourd'hui Casa Kayam) y lit sa disponibilité/tarifs de nuits et y crée le
  booking ; une propriété sans PMS (aujourd'hui Bania) gère sa disponibilité et ses tarifs dans
  le catalogue interne. Ce pattern doit rester généralisable : d'autres hébergements pourront
  s'ajouter avec un PMS différent ou sans PMS du tout.

**Nouvelle règle décidée (2026-08-11) — pages légales/institutionnelles** : le site doit porter
les pages classiques d'un site marchand — mentions légales, politique de confidentialité
(pertinent en Colombie pour le cadre Habeas Data, déjà mentionné pour le CRM interne), page de
contact, une page d'aide/FAQ, et probablement des conditions générales de vente/utilisation
(incluant la politique d'annulation générale, cf. §2). Leur **contenu** reste à rédiger plus tard
(pas une règle métier à extraire du code actuel, qui n'en a pas aujourd'hui) — seule leur
présence est actée ici comme un pré-requis du site.

**Hors périmètre de ce portail** :
- paiement en ligne (paiement à l'arrivée uniquement — MercadoPago/Stripe évoqués comme cible
  future, non tranché) ;
- toute action de configuration du catalogue ou des tarifs.

---

## 2. Parcours utilisateurs

**Statut : ✅ validé par Jérôme le 2026-08-11** (placement des suggestions laissé « à trancher
plus tard », non bloquant).

> Décrit les étapes fonctionnelles du parcours (ce que le client fait, dans quel ordre, ce qui
> est obligatoire vs optionnel) — pas l'implémentation d'interface actuelle (carrousels,
> animations, mise en page), qui sera entièrement redessinée (cf. cadrage général). Une étape
> décrite ici doit survivre au changement de front ; un détail d'interaction ne le doit pas.

**Nouvelle règle décidée (2026-08-11) — page d'accueil et découverte** (n'existe pas
aujourd'hui — le portail actuel ouvre directement sur le parcours de réservation, sans page de
découverte) :
- une **page d'accueil** propose des hébergements, activités, transports, **camps** et **eventos**
  dans des sections clairement distinctes — en particulier, camps et eventos ne sont jamais fusionnés
  dans un même parcours ou une même catégorie générique — organisées en **sections**
  (par catégorie, pour l'instant). L'algorithme de mise en avant au sein d'une section n'est **pas
  encore choisi** — décision volontairement différée — mais la cible doit être conçue pour que ce
  choix **se change facilement** (pas figé dans le code au premier jet) et pour permettre, plus
  tard, de faire tourner plusieurs variantes en **A/B testing**. Contrainte d'architecture à
  retenir pour le chiffrage : le classement d'une section doit être un point d'extension isolé,
  pas une règle éparpillée dans l'affichage.
- une **barre de recherche généraliste** permet de filtrer par type d'offre (hôtel, activité, transport, **camp, evento**…), par sous-catégorie d'activité (ex. jet ski), et par **localisation avec un rayon de
  20 km** autour d'un point. *Implique* : chaque fiche (hébergement et prestation) porte des
  coordonnées géographiques — à ajouter en §4 — et la taxonomie d'activités actuelle (6 familles
  larges) devra probablement s'affiner en sous-catégories cherchables, point à détailler avec le
  catalogue (§3a).
- **Décision (2026-08-11)** : en complément de la recherche, des **pages de catégorie/listing
  dédiées** (ex. « Activités à Guatapé », Guatapé n'étant qu'un exemple de localisation/tag
  parmi d'autres, pas l'identité de la plateforme) doivent exister — navigables et indexables,
  pas seulement accessibles via une recherche active. Même logique de tags que ci-dessus pour
  déterminer ce qu'une page de catégorie regroupe.

**Parcours principal — composer et valider une réservation :**

1. **Arrivée sur le portail** — directement sur une réservation en cours (lien profond, QR ou
   lien attribué portant un code partenaire en arrière-plan, cf. §3c), ou via la page
   d'accueil/recherche ci-dessus.
2. **Consultation d'une fiche** : hébergement, activité, transport, **camp** ou **evento**. Les
   parcours Camp et Evento restent visuellement et fonctionnellement distincts ; ils ne sont pas
   présentés comme deux variantes d'un même produit.
3. **Choix de l'hébergement** — optionnel (une commande peut n'avoir aucune nuit, cf. §3e) : un ou
   plusieurs hôtels/hostels (type de couchage, dates, nombre de personnes) et/ou un ou plusieurs
   logements entiers, parmi les établissements disponibles.
4. **Ajout de prestations** — optionnel et cumulable : activités, transport, **camps** et
   **eventos**. Le camp suit son propre parcours multi-jours ; l'evento suit son propre parcours
   éditorial/réservable. Chaque prestation ajoutée peut exiger une date, ou une date et un créneau,
   selon sa nature (§3a/§3d) ; le client voit en temps réel les places restantes quand elles se
   raréfient (§3d).
5. **Suggestions complémentaires** — *nouveau, à définir* : après un ajout au panier et/ou à
   l'étape de paiement (point ouvert ci-dessous), le client se voit proposer d'autres offres
   pertinentes à ajouter — jamais un blocage, une simple proposition qu'il peut ignorer.
6. **Coordonnées du client** : nom, WhatsApp et email (**tous trois obligatoires depuis le
   2026-08-17**, cf. §3e) ; document/commentaire restent optionnels. Si le client est connecté à
   son compte (ci-dessous), ces informations sont pré-remplies depuis son profil. **Aucun champ de
   code promo/code partenaire n'est affiché au client final** dans le périmètre actuel (§3c).
7. **Étape de paiement** : **un seul paiement, à la fin**, pour toute la commande — même si elle
   combine plusieurs établissements/prestataires (§3e). Aujourd'hui, confirmation du paiement à
   l'arrivée (pas de saisie de moyen de paiement en ligne) ; demain, si le paiement en ligne se
   concrétise (MercadoPago/Stripe, cf. cadrage général), cette étape portera la saisie réelle — la
   place de l'étape dans le parcours ne change pas, seul son contenu évoluera. **Décision
   (2026-08-11)** : le paiement du client reste unique et global, mais la **facturation interne
   reste divisée par ligne/prestataire** (déjà le cas : chaque ligne porte son propre snapshot de
   prix et de commission, §3b/§4) — pour pouvoir séparer, tracer et régler chaque part
   individuellement (par établissement, par référent) même si le client n'a payé qu'une fois.
8. **Validation** : la commande est créée. Le client reçoit une confirmation (numéro(s) de
   réservation, récapitulatif, totaux) et un moyen direct de contacter l'hébergement/l'équipe
   (aujourd'hui : message WhatsApp pré-rempli).

**Nouvelle règle décidée (2026-08-11) — compte client** (cf. §1, décision qui rouvre le
périmètre) :
- le client peut **créer un compte / se connecter**, à tout moment du parcours (avant, pendant ou
  après une réservation) — jamais une obligation pour réserver (§1) ;
- un client connecté a accès à une **page compte** : ses informations (pré-remplissage du
  formulaire de coordonnées), l'**historique de ses réservations** passées et en cours ;
- une réservation faite **sans être connecté** (parcours invité) reste possible et complète — le
  rattachement à un compte existant, s'il y en a un, se fait alors par WhatsApp/email (§3c),
  jamais par une obligation de connexion.
- **Décision (2026-08-13) — modification partielle vs annulation totale** : depuis son compte, un
  client peut **modifier** une réservation sans annuler l'ensemble de la commande : supprimer une
  activité précise, ajouter une nouvelle activité/prestation, ou remplacer une ligne (par exemple
  pour changer sa date ou sa quantité). Une ligne financière déjà créée n'est jamais recalculée
  sur place : un remplacement se fait par annulation de la ligne concernée puis création d'une
  nouvelle ligne, afin de préserver les snapshots de prix/commission (§3b).
  **Annuler la réservation**, au contraire, signifie annuler **toute la commande** et toutes ses
  lignes (hébergements, activités, transports, camps et eventos). Dans les deux cas, une annulation
  côté client n'est **jamais remboursée** (§7/A3). Le contact direct reste disponible en complément.
- **Attribution partenaire persistante** : elle n'est sauvegardée durablement que pour un client
  disposant d'un **compte enregistré**. Un invité peut réserver via un QR/lien attribué, mais ce
  rattachement ne devient pas une préférence durable attachée à son identité (§3c).
- **Recommandation à confirmer — voucher/e-ticket** : à la confirmation, le client reçoit un
  justificatif de réservation présentable sur place (au-delà du numéro de réservation actuel) —
  utile dès qu'il y a plusieurs prestataires indépendants qui doivent pouvoir vérifier une
  réservation sans dépendre de Jérôme. Détail (QR, PDF, etc.) à trancher au chiffrage.

**Décision (2026-08-11) — condition d'annulation affichée avant réservation, simplifiée le
2026-08-12** : la fiche d'un produit (§3a) et/ou l'étape de récapitulatif doivent afficher
clairement, **avant que le client ne valide et paie**, qu'une annulation ou une absence de sa
part n'est jamais remboursée (§7/A3) — une règle fixe et universelle, pas une politique qui
varie par produit/établissement. Un client ne doit jamais découvrir ça après coup, en cas de
litige.

**Parcours secondaires :**

- **Consultation sans engagement** : le client peut consulter le détail d'une activité, d'un camp
  ou d'un evento (description, photos, prix) sans jamais entamer de réservation. Certaines fiches
  restent de simples vitrines renvoyant vers un contact direct plutôt que vers une réservation en
  ligne (§6) — un client doit toujours pouvoir distinguer les deux au premier regard.
- **Réservation refusée en cours de route** : si une place/nuit devient indisponible entre
  l'affichage et la validation (concurrence avec un autre client), le client en est informé
  explicitement et doit ajuster sa sélection — jamais une réservation silencieusement dégradée ou
  partiellement honorée (invariant §3d).
- **Après la réservation, sans compte** : le client garde son numéro de réservation et le contact
  direct (WhatsApp) comme seuls repères — toute question ultérieure passe par ce contact.
- **Après la réservation, avec compte** : la réservation apparaît dans l'historique du compte —
  un point de suivi en plus du contact direct, pas un remplacement.

**Décision (2026-08-11) — compte client** : les deux mécanismes sont proposés, comme le fait déjà
`/partner` — email/mot de passe **et** connexion Google. Un compte reste identifié par un email
unique quel que soit le mode de connexion utilisé.

**Implémenté le 2026-08-15 (Feature 31)** : Google OAuth + inscription email/mot de passe avec
vérification par email construits — back-end générique (les deux apps), mais le **front reste à
construire côté `apps/web`** (ce lot a livré le front sur `apps/admin` uniquement, décision Jérôme
2026-08-15). Spec détaillée : `docs/specs/07-connexion-inscription-complete.md`.

**Direction actée (2026-08-11), détails à voir plus tard** — granularité de recherche par
catégorie : plutôt qu'une liste fixe de familles (comme les 6 catégories actuelles), la cible
utilisera des **tags**, saisis par le prestataire/gérant de l'offre concernée, ou par l'admin
principal — pas une taxonomie figée dans le code. Reste à détailler plus tard : tags libres ou
choisis dans une liste gérée, modération éventuelle, lien avec les 6 familles actuelles
(remplacées ou simple pré-remplissage).

**Points encore à trancher (chiffrage technique) :**
- Suggestions : uniquement à l'étape de paiement, après chaque ajout au panier, ou les deux ?

*Traçabilité : `docs/2-reference/04-app-reservar.md` § « Front (`reservar.js`) — structure »,
`docs/1-manuels/10-client.md`. Sections nouvelles sans équivalent dans le code actuel : page
d'accueil/recherche, suggestions, compte client.*

---

## 3. Règles métier

### 3a. Catalogue et tarification produits

**Statut : ✅ validé par Jérôme le 2026-08-11, corrigé le 2026-08-13.**

Le catalogue (admin) est la **source unique** de prix, visibilité, réservabilité et ordre
d'affichage de tout ce qui est vendu sur le portail client. Le portail ne fait que projeter ce
catalogue — aucune logique de prix ou de règle métier propre au front.

**Ce que porte un produit vendable** : identifiant interne, prix (COP), `schedule` (`date` /
`slot` / `none` — gouverne si une date, ou une date + un créneau matin/après-midi, est requise
pour le réserver), unité de quantité (libellé affiché au stepper, ex. « Horas », « Cant. » —
🌐 texte libre, donc multilingue comme le reste du contenu de fiche, cf. §4/traçabilité modèle de
données), description, photos, prestataire propriétaire, **tags de catégorisation** et
**coordonnées géographiques** (les deux décidés en §2, complétés ici pour que cette définition
canonique reste à jour avec le reste du document).

**Tarification aujourd'hui** — deux patterns génériques d'hébergement, indépendants du nom de
l'établissement (Casa Kayam et Bania ne sont que les deux instances actuelles, pas des cas
spéciaux câblés en dur — un hôtel/hostel comme un autre pourra suivre l'un ou l'autre demain) :
- **Hôtel/hostel à chambres/dortoirs** : plusieurs types de couchage, chacun avec sa capacité et
  son unité de réservation (ex. 1 lit = 1 personne, 1 tente = 2 personnes). Prix par personne/unité
  — pas un prix par chambre entière. Optionnellement adossé à un PMS (cf. §5) pour la disponibilité
  et le prix ; sinon, disponibilité et prix viennent du catalogue interne.
- **Maison/logement entier** : prix par palier de nombre de personnes, majoré en haute saison,
  arrondi nuit par nuit puis sommé. **Aucune remise liée au code partenaire** n'est appliquée dans
  le périmètre actuel. Jamais adossé à un PMS.
- **Activité / transport** : prix unitaire fixe. Total de ligne = prix unitaire × quantité, sans
  palier ni dégressivité hors règle optionnelle ci-dessous.
- **Camp** : produit multi-jours avec prix/cupos/durée propres ; sa tarification reste distincte de
  l'evento et peut utiliser la remise quantité/personnes uniquement si ce mécanisme a un sens pour
  sa quantité vendue.
- **Evento** : fiche distincte ; s'il est rendu réservable en ligne, sa tarification suit sa propre
  configuration, sans jamais être confondue avec celle d'un camp.

**Gates de vente** (ce qui rend un produit effectivement réservable, indépendamment de son prix) :
un produit doit être marqué vendable ; un camp doit être publié ; un evento doit être publié
**et** explicitement marqué réservable en ligne. Ces gates sont vérifiés à la fois côté catalogue
(ce qui est montré au client) et côté serveur au moment de la réservation — un front périmé ne
peut jamais forcer la vente d'un produit retiré ou non publié.

**Fraîcheur du catalogue** : le catalogue vu par le client est mis en cache côté serveur (durée
courte) et **doit être invalidé immédiatement par toute écriture admin** — un changement de prix
ou de visibilité ne doit jamais rester visible avec l'ancienne valeur au-delà d'une fenêtre
courte et connue.

---

**Nouvelle règle décidée (2026-08-11)** — remise optionnelle par quantité/nombre de personnes,
sur une activité ou un autre produit (n'existe pas dans le système actuel : aujourd'hui le total
est toujours prix unitaire × quantité, sans palier, hors maison entière) :

- **Qui la configure** : l'admin **et** le prestataire propriétaire du produit — les deux
  peuvent la poser, comme pour le reste du catalogue.
- **Mécanisme** : un palier **librement défini par celui qui configure** — seuil de
  quantité/personnes ET pourcentage de remise associés sont tous les deux à sa main, pas des
  valeurs imposées par le système. Reste optionnel : un produit sans palier configuré garde son
  prix unitaire fixe.
- **Périmètre — décision 2026-08-13** : ce mécanisme s'applique **uniquement aux produits hors
  nuits** (activités, transport, camps et, s'il est réservable et pertinent, evento). Il ne
  s'applique **jamais** aux chambres, dortoirs ou logements entiers, qui conservent leurs mécanismes
  tarifaires propres.

### 3b. Moteur de commission (17/10/7) — priorité n°1

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Chaque **ligne** de commande (une nuit, une prestation) porte son propre calcul de commission,
déterminé à la création de la commande et **jamais recalculé après coup** — même si les taux
changent plus tard, une commande déjà passée garde ses pourcentages d'origine (invariant : le
calcul est figé/snapshoté sur la ligne, pas recalculé dynamiquement à la lecture).

**Trois cas possibles pour une ligne**, selon qui a référé le client et qui touche la commission :

| Cas | Qui a référé | Acompte (part app à l'arrivée) | Commission référent | Part app |
|---|---|---|---|---|
| **Référent externe** | un partenaire différent du prestataire qui encaisse | 17 % (= 10+7) | 10 % | 7 % |
| **Auto-référence** | le prestataire s'est référé lui-même (même identité des deux côtés) | 7 % (= 0+7) | 0 % | 7 % |
| **Direct** | aucun référent attribué | 17 % (= 0+17) | 0 % | 17 % |

**Composition** : l'acompte est toujours la somme de deux briques — la part référent (**10 %**,
seulement s'il y a un référent externe) et la part app (**7 %** dès qu'il y a un référent
quelconque, référent externe ou auto-référence ; **17 %** s'il n'y a aucun référent, l'app
absorbant alors la part qui serait allée au référent). Il n'y a **aucun plancher** d'acompte —
ces pourcentages s'appliquent tels quels, sans minimum.
- Toute remise commerciale active en amont — dans le périmètre actuel, uniquement la remise
  optionnelle par quantité/personnes sur les **produits hors nuits** (§3a) — est incluse dans
  `total_cop` **avant** ce calcul : la commission se calcule toujours sur le montant net déjà
  remisé, jamais sur un prix plein théorique. L'ancien avantage client de 10 % lié au code
  partenaire est désactivé (§3c).
- Un **payeur inconnu** (le prestataire qui encaisse n'a pas d'identité liée dans le système)
  compte comme **différent** du référent → traité comme cas « référent externe », pas auto-référence.
- Ce moteur remplace un ancien calcul (acompte fixe 15 %, commission fixe 10 % si code valide)
  qui reste utilisé pour lire l'historique des commandes déjà passées sous l'ancien barème — une
  commande ancienne n'est jamais recalculée avec les nouveaux taux.

**Décision (2026-08-11) :** le cahier des charges — et donc la refonte — ne documente/implémente
que le barème cible **17/10/7**. L'ancien barème (15 % / 10 %) n'est pas repris comme règle
vivante ; l'historique des commandes déjà passées sous l'ancien calcul sera géré côté migration
de données (montants déjà calculés préservés tels quels), pas comme une formule à maintenir dans
le nouveau système.

*Traçabilité : `src/services/pricingService.js` (`priceLine()`), invariant R5 du registre interne.*

### 3c. Code partenaire / attribution référent (ancien « code promo »)

**Statut : ✅ corrigé et validé par Jérôme le 2026-08-13.** Cette décision remplace le système
précédent de code promo donnant une remise client, ainsi que la mémorisation multi-codes côté
navigateur.

**Rôle actuel** : le code est un **identifiant d'attribution partenaire**. Il rattache une commande
à un référent afin que le moteur 17/10/7 (§3b) puisse calculer les commissions. Le QR et le lien
attribué sont les moyens principaux de diffusion ; ils transportent ce code en arrière-plan. Le
code lui-même reste un mécanisme secondaire de la même chaîne d'attribution — il ne constitue plus
un avantage commercial pour le client.

**Aucune saisie dans l'interface client** : le champ « code promo » disparaît entièrement du
parcours public. Le client final ne voit pas de champ lui permettant d'entrer, vérifier ou choisir
un code. Un code invalide transporté par un lien/QR n'empêche jamais la réservation ; la commande
continue simplement sans référent attribué.

**Aucune remise active liée au code** : l'ancien comportement accordant 10 % de réduction sur
l'hébergement est **désactivé**. Dans le périmètre actuel, un code partenaire ne change jamais le
prix payé par le client et n'impose donc aucun discount au prestataire. La capacité technique
d'associer plus tard un avantage client à une attribution reste présente dans le code/modèle, mais
elle est **dormante et désactivée par défaut**, strictement découplée du calcul d'attribution.

**Résolution unique de l'attribution pour une commande** : lorsqu'un QR/lien/code partenaire valide
est présent dans le contexte de réservation, son référent est résolu une seule fois et appliqué à
toutes les lignes éligibles de la commande (nuits, activités, transport, camps, eventos). Le payeur
de la commission reste déterminé **par ligne** selon le prestataire propriétaire du produit (§3b).

**Persistance — décision 2026-08-13** :
- pour un **client invité**, l'attribution vaut pour la réservation en cours mais n'est pas
  sauvegardée comme préférence durable à partir de son WhatsApp/email ;
- pour un **client avec compte enregistré**, le dernier code partenaire valide rencontré peut être
  sauvegardé sur son compte et réutilisé lors d'une réservation ultérieure ;
- si ce client revient ensuite par un **nouveau** QR/lien/code valide, **le dernier code présenté
  prime** pour la nouvelle réservation et remplace l'attribution partenaire précédemment mémorisée ;
- il n'existe plus de liste multi-codes à présenter au client ni de choix manuel entre plusieurs
  codes mémorisés.

**Traçabilité** : chaque commande conserve le code/référent effectivement utilisé au moment de sa
création, même si le compte client reçoit plus tard un autre code. Une commande passée n'est jamais
réattribuée rétroactivement.

*Traçabilité état actuel : `src/services/orderService.js`, `src/services/portalService.js` et
`src/services/pricingService.js` contiennent encore l'ancien vocabulaire/chemin de remise ; la
refonte doit conserver l'attribution et désactiver la réduction client sans supprimer la capacité
future.*

### 3d. Disponibilité, cupos, calendrier

**Statut : ✅ validé par Jérôme le 2026-08-11, corrigé le 2026-08-13.**

**Disponibilité des nuits** — dépend du pattern d'hébergement (cf. §3a) :
- hôtel/hostel PMS-backed : la disponibilité vient d'une lecture **fraîche** du PMS à chaque
  vérification (jamais mise en cache au moment de réserver) ;
- hôtel/hostel ou logement entier non PMS-backed : la disponibilité vient d'un **calendrier
  interne**, tenu par le prestataire lui-même (il ouvre/ferme ses dates) — **fermé par défaut**
  pour un nouvel hébergement tant que le prestataire n'a pas explicitement ouvert des dates
  (zéro risque de survente sur des nuits déjà prises en dehors du système).

**Disponibilité des prestations** (activités, transport, camps, eventos) — calendrier interne
par produit, avec deux niveaux de fermeture :
- une **date entière** peut être fermée par l'admin/prestataire, ou pleine (plus de places) ;
- pour un produit à **créneaux** (matin/après-midi), la capacité s'entend **par créneau** — une
  date n'est fermée que si ses **deux** créneaux sont pleins ou fermés. Un produit à **journée
  entière** ne peut pas être réservé sur une demi-journée fermée : une demi-journée fermée ferme
  toute la date pour ce type de produit.
- pour un **camp** et pour tout **evento rendu réservable en ligne**, l'absence d'ouverture
  explicite vaut **fermé**. Camps et eventos restent néanmoins deux parcours/fiches distincts.
- **Décision 2026-08-13 — calendrier partagé du prestataire / anti-double-booking** : un camp (et
  un evento réservable) est relié à la **ressource de disponibilité du prestataire qui l'organise**,
  partagée avec les autres activités qui consomment le même temps de travail/ressource. Un camp de
  N jours n'est proposé à une date de départ que si **toute sa période** est disponible. Exemple :
  si UFit a ouvert ses dates du 1 au 6 et que le camp dure 5 jours, le départ du 1 est réservable
  dès lors que les 5 jours nécessaires sont libres.
- **Blocage automatique à la première réservation** : quand une réservation de camp ou d'evento est
  confirmée, toute la période consommée est bloquée **atomiquement** sur la ressource partagée ;
  les autres activités liées deviennent immédiatement indisponibles sur ces dates. Ce blocage ne
  dépend d'aucune confirmation humaine postérieure : c'est le garde-fou contre le double booking.
  Le prestataire reçoit ensuite une notification indiquant le camp ou l'evento réservé, la période
  bloquée et les autres offres rendues indisponibles.
- la fenêtre de consultation du calendrier est **bornée dans le temps** (aujourd'hui 180 jours) —
  pas de réservation à horizon illimité.

**Invariant anti-survente (à ne jamais casser dans la refonte)** : l'affichage du calendrier peut
s'appuyer sur un cache court pour la fluidité, mais la validation finale au moment de la
réservation **relit toujours l'état frais** et est vérifiée **dans la même opération atomique**
qui crée la commande — deux clients ne peuvent jamais obtenir la même place/nuit, même si
l'interface affichée était périmée. Le refus (place déjà prise) est un échec dur de la
réservation, jamais une survente silencieuse.

**Comportement de panne** : si le service de calendrier/disponibilité est indisponible, le
système **bloque** la réservation concernée plutôt que de la laisser passer sans vérification
(échec fermé — on préfère refuser une réservation valide par excès de prudence que risquer une
survente).

*Traçabilité : `src/services/inventoryService.js` (`isPerSlot`, `assertCanReserve`,
`assertCanReserveStay`), `src/controllers/portalController.js` (`/service-calendar`,
`/availability`, `/stay-availability`, `/stay-calendar`).*

### 3e. Règles de panier

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Composition d'une commande** — une commande peut combiner librement, dans un seul panier :
- des **nuits en dortoir/chambre**, dans un ou plusieurs hôtels/hostels (plusieurs lignes
  possibles, bornées en nombre et en quantité totale — aujourd'hui max 4 lignes, 12 unités
  réservées au total, mais ce plafond était pensé pour un seul établissement, cf. ci-dessous) ;
- une ou plusieurs **maisons/logements entiers** ;
- des **prestations** (activités, transport, camps, eventos) — **correction (2026-08-12)** :
  aujourd'hui bornées aux **deux** dimensions, pas une seule — max 20 lignes distinctes par
  commande **et** max 20 en quantité par ligne (`MAX_PRODUCT_LINES`/`MAX_QTY`, tous deux à 20) ;
- une commande **sans aucune nuit** (prestations seules) est valide.

**Nouvelle règle décidée (2026-08-11)** : une commande doit pouvoir combiner des nuits dans
**plusieurs hébergements différents** — plusieurs hôtels/hostels et/ou plusieurs maisons entières
en même temps, pas un seul établissement à la fois. Ça généralise la restriction actuelle du
système (aujourd'hui : un seul hébergement à chambres OU une seule maison entière par commande,
jamais plusieurs établissements combinés).

*À trancher plus tard (chiffrage technique)* : les plafonds actuels (4 lignes/12 unités pour les
chambres, une seule maison, et — précision 2026-08-12 — 20 lignes/20 en quantité pour les
prestations) étaient tous dimensionnés pour un seul établissement — à revoir pour plusieurs
établissements combinés : plafond global sur toute la commande, ou plafond par établissement
répété autant de fois qu'il y a d'établissements dans le panier ?

Le panier n'est pas persisté au-delà de la session en cours (perdu si l'onglet est fermé) — sauf
demande contraire. L'attribution partenaire persistante, lorsqu'elle existe, appartient au **compte
client enregistré** et non au panier/navigateur (§3c).

**Ce qu'exige une ligne de prestation**, selon son `schedule` (cf. §3a) :
- `'slot'` : une date **et** un créneau (matin/après-midi) ;
- `'date'` : une date, sans créneau ;
- `'none'` : aucune date requise.

> **Révisé le 2026-08-17** (décision Jérôme, cf. `hifago/docs/specs/17-calendrier-disponibilite-refonte.md`) :
> l'email passe d'optionnel à **requis**, au même titre que le nom et le WhatsApp — un client a
> désormais obligatoirement au moins une adresse email valide, qu'il réserve en invité ou depuis un
> compte. Aucun des deux champs déjà requis n'est retiré : l'email s'ajoute au WhatsApp, il ne le
> remplace pas.

**Informations du client, requises pour valider le panier** :
- nom : requis ;
- WhatsApp : **requis**, normalisé (un numéro colombien local est complété avec l'indicatif
  pays automatiquement) ;
- email : **requis**, doit être valide ;
- document d'identité, commentaire : optionnels, texte assaini (longueur bornée, caractères de
  contrôle retirés) ;
- **case de consentement marketing (Habeas Data), ajoutée le 2026-08-12** : une case explicite au
  moment de la réservation, distincte de l'acceptation des CGV — c'est elle qui donne une preuve
  vérifiable à l'obligation que l'admin s'impose avant tout envoi commercial groupé touchant des
  clients (admin §3f). Sans elle, ce rappel légal n'a aucune donnée à vérifier derrière.

**Robustesse** : si le catalogue est indisponible au moment de composer le panier, aucune liste
de prestations fictive n'est proposée — l'ajout et la validation des prestations sont bloqués,
mais les nuits restent réservables indépendamment (elles ne dépendent pas du même service).

*Traçabilité : `src/services/portalService.js` (`reserve()`, validation/bornage synchrone en
tête de fonction).*

### 3f. Cycle de vie de la commande

**Statut : ✅ validé par Jérôme le 2026-08-11** (décisions confiées à Claude selon les pratiques
usuelles d'une app de réservation, cf. décisions ci-dessous).

**Ce qui existe aujourd'hui** (vérifié dans le code, pas seulement dans la doc) :

- Une commande est créée **confirmée** immédiatement (paiement à l'arrivée, pas de statut
  intermédiaire « en attente » réellement utilisé). Chaque ligne démarre **active**
  (« réservée »).
- Une ligne active évolue ensuite vers un état terminal : **réalisée** (prestation/nuit
  effectivement consommée), **absence** (`no_show`), **annulée par le client**, **annulée par le
  prestataire**, ou **expirée**.
- **Correction (2026-08-12, vérifiée dans le code — la version précédente était fausse)** :
  dans le registre qui porte réellement le moteur de commission 17/10/7 (les lignes de commande,
  §3b), **cette transition vers un état terminal ne se produit jamais automatiquement, PMS-backed
  ou pas** — elle exige toujours une action manuelle admin (une seule fonction y fait avancer une
  ligne, appelée uniquement depuis l'écran admin, jamais depuis l'import PMS). L'import périodique
  du PMS ne touche pas ce registre : il alimente un **miroir historique séparé** (l'ancien calcul
  de commission, à 15 %, cf. §3b) avec son propre cycle réalisée/annulée/expirée sur cette base
  précise. Autrement dit : **le contraste « PMS = automatique / sans PMS = manuel » n'existe pas
  aujourd'hui pour le moteur cible** — c'est manuel dans les deux cas. Ce constat renforce, plutôt
  qu'il n'affaiblit, la décision cible n°1 ci-dessous : le besoin d'un cycle réellement automatisé
  ne se limite pas aux commandes sans PMS, il concerne toute commande.
- Si une nuit/activité censée être reflétée dans le PMS ne l'est pas (échec technique), la
  commande passe dans un état d'**exception** dédié et une entrée est ouverte dans une file de
  réconciliation, plutôt que d'échouer purement et simplement — le client garde sa réservation,
  mais elle nécessite un contrôle manuel.

**Décisions cibles (2026-08-11)** — Jérôme a demandé de trancher ces 4 points selon ce qui se
pratique usuellement dans une app de réservation, plutôt que de reproduire l'état actuel :

1. **Cycle de vie unique, indépendant du PMS** (résout le point 3 du constat) : dans la cible,
   toute commande — avec ou sans nuit adossée à un PMS — suit **le même** cycle métier :
   réservée → réalisée / absence / annulée (client ou prestataire) / expirée. La synchronisation
   avec un PMS externe devient un **statut séparé et secondaire** par ligne (« à synchroniser » /
   « synchronisée » / « échec de synchronisation »), qui n'empêche jamais la commande de vivre son
   cycle métier normal — c'est la séparation standard entre l'état métier d'une réservation et
   l'état d'intégration avec un système externe.
2. **File de réconciliation avec un vrai flux de sortie** (résout le point 1) : une entrée
   d'échec de synchronisation passe par des états explicites — ouverte → en re-tentative
   automatique (quelques essais espacés) → **résolue manuellement** (avec une note, par un admin)
   ou **signalée en échec permanent** si les re-tentatives échouent toutes. Un écran admin liste
   les entrées ouvertes et permet de les clore explicitement — fini l'intervention en base pour
   sortir une commande de l'état d'exception.
3. **Expiration sur tâche planifiée, pas sur un import** (résout le point 2) : le passage à
   « expirée » d'une réservation jamais confirmée après sa date + délai de grâce tourne sur une
   tâche planifiée récurrente (ex. une fois par jour), indépendante de toute action admin — une
   commande expire au bon moment même si personne ne déclenche d'import ce jour-là.
4. **Statuts minimaux, ajoutés seulement quand un vrai chemin de code les atteint** (résout le
   point 4) : la cible ne définit que les statuts effectivement produits par un flux réel
   (réservée / réalisée / absence / annulée / expirée, + les statuts d'intégration PMS ci-dessus).
   Des statuts de paiement (en attente / payé) ne seront introduits que lorsque le paiement en
   ligne (§ paiement, cf. cadrage général) sera réellement implémenté — pas avant, pour éviter un
   schéma qui affiche des états qu'aucun code ne produit jamais.

*Traçabilité : `src/services/orderService.js` (`LINE_TRANSITIONS`, `transitionLine` — seule
fonction qui fait avancer une ligne, appelée uniquement depuis `ordersController.js`, jamais
depuis l'import PMS ; `markMirrorFailed`), `src/services/storageService.js` (`expireStale`,
`upsertFromPortal` — le miroir historique séparé), `src/services/commission.js` (`deriveStatus`),
`src/services/ledgerService.js` (`openException`, `onLineTransition`), `src/controllers/lobbyController.js`
(`importFromLobby` — n'écrit que le miroir historique, jamais `order_lines`).*

## 4. Entités de données touchées

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Le portail client ne touche qu'une partie du modèle de données global. Voici uniquement ce qu'il
**lit** ou **écrit** — le reste (comptes socios, CRM, campagnes de messages...) est hors
périmètre de ce document, propre à `/partner` et `/admin`. Voir `hifago/docs/00-modele-de-donnees.md`
pour l'audit champ par champ des entités partagées (établissement, chambre, produit) — notamment
le **gap critique** : aucun mécanisme de prix/disponibilité pour un établissement à chambres
multiples sans PMS, alors que la recherche/le catalogue (§2/§3a) doivent traiter tout
établissement de façon générique, PMS ou non.

**Lu par le portail (jamais écrit)** :
- **Catalogue** : produits vendables (prix, `schedule`, unité de quantité, capacité, prestataire
  propriétaire), calendrier d'ouverture/fermeture par date (et par créneau si applicable),
  **tags de catégorisation** (saisis par le prestataire/gérant ou l'admin — cf. §2, remplacent la
  liste fixe actuelle de 6 familles), ordre d'affichage, photos.
- **Propriétés/hébergements** : présentation (nom, photos, cadrage), grille tarifaire d'un
  logement entier, ordre d'affichage des cartes.
- **Camps** et **eventos** : deux familles distinctes, avec leurs propres fiches/gates ; pour les
  offres réservables, lecture de la ressource de disponibilité partagée du prestataire et des
  blocages multi-jours.
- **Codes partenaires / attribution** — uniquement le nécessaire pour résoudre le référent : code
  actif, identité référente correspondante et éventuel lien avec le compte client enregistré.
  **Aucun taux de remise client n'est lu dans le périmètre actuel** ; la capacité d'incentive futur
  reste dormante (§3c).
- **Coordonnées géographiques** des fiches (hébergement et prestation) — nouveau, requis par la
  recherche par localisation/rayon décidée en §2.

**Lu ET écrit par le portail (nouveau, compte client — §2)** :
- **Compte utilisateur** (base unifiée client/socio/admin, cf. cahier des charges socio §1) :
  identifiants de connexion, rôle(s) actif(s) sur cette identité, informations de profil, et le
  lien vers les commandes passées par ce compte (historique).

**Écrit par le portail** :
- **Commande** : une commande et ses lignes, avec pour chaque ligne les snapshots figés de prix
  et de commission (§3b), la date/le créneau retenus (§3d), et — désormais séparé du statut
  métier de la ligne (décision §3f) — un **statut d'intégration PMS** propre à la ligne quand
  l'hébergement/l'activité concerné est PMS-backed. **Simplifié le 2026-08-12** : la règle
  d'annulation étant désormais fixe et universelle (§7/A3 — jamais de reversement côté client,
  quel que soit le produit/établissement), aucun snapshot de politique n'est nécessaire par
  ligne ; seule la **qui a annulé** (client ou prestataire) compte, déjà portée par le statut
  métier de la ligne lui-même.
- **File de réconciliation** : une entrée quand une synchronisation PMS attendue échoue (§3f),
  rattachée à la commande concernée.
- **Attribution partenaire/marketing** : le code partenaire effectivement résolu et la source
  (QR, lien attribué, autre contexte technique) sont snapshotés avec la commande. Pour un compte
  client enregistré, le dernier code valide peut en plus devenir l'attribution persistante active
  du compte (§3c).
- **Consentement Habeas Data** : la case cochée (ou non) à la réservation (§3e), horodatée —
  ajouté le 2026-08-12.
- **Modifications post-création — décision 2026-08-13** : une **modification** agit sur une ou
  plusieurs lignes choisies (ajout, annulation d'une activité précise, remplacement d'une ligne),
  tandis que **l'annulation de la réservation** annule la commande entière et toutes ses lignes.
  Une ligne remplacée conserve son historique financier ; la nouvelle ligne reçoit ses propres
  snapshots.

**Écarté du périmètre client, propre à `/partner`/`/admin`** : comptes et authentification
partenaire, capacités referrer/operator, contrats, propositions de fiches, CRM, conversations,
campagnes de messages, fiches de suivi prestataires.

**Point à challenger (repéré en lisant le modèle actuel)** : aujourd'hui, le miroir PMS d'une
activité (l'attacher au booking de nuit) ne fonctionne que pour un seul prestataire nommé en dur
dans le code, même si d'autres prestataires ont le connecteur PMS activé sur leur fiche — un
reliquat direct de l'époque où Casa Kayam était le seul établissement. Puisqu'on généralise à
plusieurs hôtels/hostels (cf. §1, §3a), cette limitation doit tomber : *tout* prestataire avec le
connecteur PMS activé doit pouvoir voir ses activités attachées à un booking, pas seulement un nom
particulier. Détaillé en §5.

*Traçabilité : `docs/2-reference/05-data-model.md` (modèle complet), en particulier les tables
`products`, `product_calendar`, `orders`, `order_lines`, `exceptions_queue`, `partner_codes`,
`providers.lobby_connector`.*

## 5. Intégration LobbyPMS

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Rôle** : un connecteur PMS est **optionnel, activable par propriété** (cf. §1/§3a) — pas une
dépendance globale du portail. Une propriété qui l'active délègue à son PMS externe la
disponibilité et le prix des nuits, et la création du booking ; une propriété qui ne l'active pas
gère tout ça dans le catalogue/calendrier interne. Dans la cible, ce rôle doit être pensé comme un
**contrat générique** (disponibilité+prix par nuit, création de booking, rattachement d'une
prestation à un booking, lecture d'occupation) — LobbyPMS en est la première implémentation, pas
la seule possible : une autre propriété pourra demain brancher un PMS différent sur le même
contrat, sans toucher au reste du portail.

**Ce que fait LobbyPMS aujourd'hui pour une propriété qui l'active** :
- disponibilité et prix des nuits, relus **à chaud** à chaque étape qui compte réellement (jamais
  depuis un cache au moment de valider la réservation — un cache court n'est acceptable que pour
  l'affichage, cf. §3d) ;
- création du booking de nuit au moment de la réservation ;
- rattachement (« miroir ») d'une activité vendue dans la même commande, quand cette activité
  appartient à un prestataire dont le connecteur PMS est actif — voir généralisation ci-dessous ;
- lecture d'occupation côté back-office (hors périmètre client).

**Généralisation nécessaire (2026-08-11)** — deux limitations actuelles à lever dans la cible :
1. **Le rattachement d'activité à un booking ne fonctionne aujourd'hui que pour un seul
   prestataire nommé en dur dans le code**, même si d'autres prestataires ont leur connecteur PMS
   activé. Dans la cible, la règle doit être générique : *toute* activité d'un prestataire dont le
   connecteur est actif se rattache au booking de nuit de **sa propre propriété**, dès qu'un tel
   booking existe dans la commande et que le mapping produit↔PMS est renseigné — plus aucun nom
   de prestataire en dur.
2. **Une commande peut désormais contenir des nuits dans plusieurs propriétés** (décision §3e),
   dont certaines PMS-backed et d'autres non. La chaîne d'écriture doit donc traiter **chaque
   propriété PMS-backed indépendamment** — sa propre disponibilité, son propre booking, ses
   propres activités rattachées — plutôt que de supposer un unique « booking principal » pour
   toute la commande.

**Gestion d'échec** : si une nuit ou une activité censée être reflétée dans un PMS ne l'est pas
(panne technique), on suit la règle générale du §3f (statut d'intégration séparé du statut
métier, file de réconciliation avec sortie explicite) — jamais un blocage de la réservation
elle-même.

**Limites connues du connecteur LobbyPMS aujourd'hui** (vérifiées dans l'API elle-même, pas
seulement dans notre usage) — à conserver ou à absorber dans le contrat générique plutôt qu'à
laisser fuiter dans le reste du portail :
- **Groupes** : Lobby a bien une notion de booking lié à un groupe côté modèle de données, mais
  les bookings qu'on crée via l'API n'exploitent pas ce lien — le rattachement de plusieurs
  bookings d'une même commande se fait aujourd'hui par les informations du client (nom,
  WhatsApp), pas par un identifiant commun exposé par Lobby.
- **Prix** : le tarif d'une nuit est **un prix fixe pour l'ensemble de l'unité réservée**, jamais
  multiplié par le nombre de personnes par Lobby lui-même — la quantité doit être encodée dans le
  prix envoyé, pas dans un champ « nombre de personnes » séparé.
- **Remises** : Lobby a son propre mécanisme de remise, mais on ne l'utilise pas — la remise
  (§3c) est calculée et injectée par l'app directement dans le prix net envoyé. Choix à
  **conserver dans la cible** : garder la maîtrise du calcul de remise côté app, le PMS ne servant
  qu'à l'inventaire et à l'enregistrement du booking, jamais au calcul du prix.
- **Pas de webhook** : uniquement de l'import périodique déclaré manuellement (§3f) — aucune
  notification en temps réel des changements côté PMS (annulation, modification faite par le
  staff de l'hébergement directement dans son logiciel PMS).
- **Comportements à gérer avec robustesse, pas à supposer fiables** : certaines catégories de
  chambres du PMS ne sont pas réservables via l'API (erreur explicite à anticiper, pas un cas
  limite rare) ; annuler un booking par API ne fonctionne que s'il a été créé par API et si aucune
  prestation n'y a encore été ajoutée ; un changement de chambre fait par le staff PMS peut créer
  un nouveau booking **sans référence à l'ancien**, cassant le suivi si on ne s'en protège pas ; la
  forme réelle de la réponse à la création d'un booking peut différer de ce que documente le PMS —
  parser défensivement, ne jamais supposer un format garanti.
- Les identifiants internes (`products.id`) sont ce que le front envoie ; les identifiants propres
  au PMS ne sortent jamais de la couche connecteur — **objectif pour la cible, pas encore acquis
  aujourd'hui pour toute entité (corrigé le 2026-08-12)** : pour une activité classique c'est déjà
  le cas, mais pour un type de chambre d'un établissement PMS-backed, l'identifiant utilisé
  aujourd'hui **est directement** l'identifiant de catégorie côté PMS (cf.
  `hifago/docs/00-modele-de-donnees.md` §2 — « identifiant interne indépendant du PMS » listé comme
  gap à construire). À traiter comme un invariant à **construire** pour ce cas précis, pas à
  préserver — corollaire direct du gap critique établissement-sans-PMS (§4/modèle de données).

**Décision (2026-08-11)** : oui, dans la mesure du possible — la synchronisation PMS suit la même
logique que l'expiration (§3f) : un **poll régulier automatique** (tâche planifiée), pas une
dépendance à un import déclenché à la main, pour détecter le plus tôt possible une annulation ou
une modification faite côté PMS. L'import manuel reste possible en complément, mais ne doit plus
être la seule voie.

**Limites du calendrier interne, pour une propriété SANS PMS** (vérifiées, pas supposées) :
- La protection anti-survente du calendrier interne (§3d, fermé par défaut) est **manuelle et
  déclarative** : elle protège contre une survente **à l'intérieur du portail**, mais rien ne
  synchronise avec un canal de vente externe (Booking.com, Airbnb, autre) — si un prestataire
  vend aussi ailleurs et ne referme pas sa date sur le portail, aucun garde-fou ne l'empêche.
  Aucune synchronisation externe (type iCal) n'existe aujourd'hui.
- Pas de séjour minimum, pas de délai de préavis minimum, pas de tarif différencié semaine/week-end.
- Le dépôt affiché pour un logement entier n'est **qu'informatif** — jamais encaissé en ligne
  (cohérent avec l'absence de paiement en ligne, cf. cadrage général).
- Pas de facturation ni de gestion tarifaire dynamique par la demande (« yield management ») —
  absent, pas juste non documenté.

**⚠️ Décision (2026-08-11) — noté pour plus tard, ne pas perdre de vue** : le risque de survente
inter-canaux (un prestataire vend aussi sur Booking.com/Airbnb sans refermer sa date ici) devient
réel dès qu'on ouvre à plusieurs hôtels/maisons indépendants (§1, §3a). **Pas à implémenter dans
ce premier périmètre**, mais une synchronisation externe basique (au minimum iCal) pour les
propriétés sans PMS est une **cible future importante**, à ne pas oublier lors du chiffrage des
phases suivantes. Repris dans `hifago/README.md` pour rester visible au niveau du chantier entier,
pas seulement de ce document.

*Traçabilité : `docs/2-reference/04-app-reservar.md` § « `POST /reserve` », `docs/3-integrations/lobby_pms_api.md`,
`docs/3-integrations/lobby_pms_implementation.md`, `src/services/catalogService.js` (`isPmsBacked`),
`docs/2-reference/05-data-model.md` (`products.lobby_category_id`, `products.lobby_product_id`,
`providers.lobby_connector`), `docs/2-reference/08-known-gaps.md` (A4, A11-A13, Q5).*

## 6. Cas limites

**Statut : ✅ validé par Jérôme le 2026-08-11.**

- **Une commande doit contenir au moins une nuit OU une prestation** — jamais une commande vide.
- **Recherche géographique sans résultat dans le rayon, ajouté 2026-08-12** : la cible étant un
  marketplace qui s'étend ville par ville, c'est le cas normal pour toute nouvelle localisation
  avant qu'elle ait une masse critique d'offres — pas un cas rare à ignorer. **Recommandation** :
  élargir automatiquement la recherche au-delà du rayon choisi et l'afficher explicitement
  (« aucun résultat à 20 km, voici les plus proches à X km ») plutôt qu'un état vide sec — jamais
  laisser un visiteur sans aucune piste.
- **Arrondi cohérent front/back** : pour un logement entier, chaque nuit est arrondie
  séparément puis les nuits sont sommées — jamais un arrondi sur le total. Le front doit
  reproduire exactement la même règle, sinon le total affiché au client et le total facturé
  divergeraient d'un ou deux pesos.
- **Plafond de sélection d'un type de chambre** = le plus petit des deux : la capacité maximale du
  type de chambre, et la disponibilité réelle aux dates choisies. Le client ne peut jamais viser
  un plafond théorique qui dépasse la disponibilité réelle.
- **Vitrines non réservables en ligne** : certaines fiches du catalogue peuvent rester des
  vitrines (photo, description, CTA WhatsApp) sans être réservables en ligne — tant qu'aucun
  produit interne vendable ne les remplace. Un client voit la fiche mais est renvoyé vers WhatsApp
  pour réserver. Pattern à conserver dans la cible : toute fiche n'a pas vocation à être
  réservable en ligne dès le premier jour.

**Décision (2026-08-11) — tarification d'un produit PMS-backed** : le prix d'un lit/unité vient
**tel quel du PMS**, sans logique de réduction/ajustement selon le nombre de personnes ajoutée
par l'app — le PMS est autoritaire sur son propre prix par unité. Pas de règle supplémentaire à
construire côté app : on ne fait pas de tarification par tranche de personnes pour un produit
PMS-backed, on relaie le prix PMS.

**Décision (2026-08-11) — activité seule adossée à un PMS, sans nuit** : recommandation
appliquée — détecter ce cas en amont (aucune nuit, dans **la propriété du prestataire concerné**,
cf. généralisation multi-propriétés §5) et traiter la commande comme **complète sans intégration
PMS nécessaire**, sans ouvrir d'entrée de réconciliation qui ne correspond à aucune action
possible. Point sensible (argent réel en jeu) : la détection doit être scrupuleusement exacte —
elle ne doit jamais faussement conclure « pas de nuit » quand une nuit existe ailleurs dans une
commande multi-établissements, sous peine de perdre une vraie synchronisation PMS nécessaire.

*Traçabilité : `docs/2-reference/04-app-reservar.md` (barème dorms, arrondi maison entière,
tours statiques), `docs/2-reference/05-data-model.md` (`experiences.online_bookable`).*

## 7. Lacunes connues, challengées une à une

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Filtré depuis `docs/2-reference/08-known-gaps.md` sur ce qui touche réellement le portail client
(le reste — identités, CRM, campagnes, sécurité back-office — relève des cahiers des charges
`/partner`/`/admin`, pas de celui-ci).

**Déjà traitées dans une section précédente de ce document** (pas de nouvelle décision ici) :

| Lacune | Traitement retenu |
|---|---|
| A2 — prix dortoir replié à 1 personne | §6 : le PMS reste autoritaire sur son prix, pas de tarification par tranche ajoutée côté app. |
| A4 — confirmation par import CSV, pas de poll | §5 : remplacé par un poll automatique régulier, au mieux possible. |
| A6 — catalogue indisponible bloque les prestations sans injecter de données fictives | §3e : confirmé, comportement à conserver. |
| A7 — attribution par code historique | §3c : le code devient un identifiant d'attribution transporté par QR/lien ; aucun champ de saisie client. Persistance uniquement sur compte enregistré, dernier code valide prioritaire. |
| A9 — maison entière non réservable en ligne | Déjà résolu en prod (2026-07-28), obsolète — le portail réserve les maisons entières (§3a). |
| A13 — un produit sans date ne décompte aucun cupo | Comportement logique, confirmé — sans date, rien à décompter. |
| G10, G11, G12 — plafonds de cupos et fenêtre de fermeture | Repris comme invariants validés en §3d/§6. |

**Nouvelles décisions à prendre pour ce document :**

- **A3 — décision (2026-08-11, simplifiée et précisée le 2026-08-12) : pas de reprise
  commission-vs-app, mais une REDISTRIBUTION entre référent et prestataire selon QUI annule.**
  Règle binaire sur le reversement lui-même : **aucune annulation ou absence côté client ne
  donne jamais lieu à un remboursement**, quel que soit le délai avant la date — l'acompte reste
  encaissé. **Seule une annulation par le prestataire lui-même** (il ne peut pas honorer la
  réservation) rend l'argent au client ; dans ce cas seulement, plus aucune commission n'est due
  sur la ligne (rien n'a été vendu).
  Sur une ligne **réalisée**, ou **annulée/no-show côté client** (l'acompte reste encaissé dans
  les deux cas), la répartition de l'acompte (§3b) change selon le cas :
  - la **part app** (7 %, ou 17 % en direct) reste **toujours identique**, réalisée
    ou pas ;
  - la **part référent** (10 %, cas référent externe uniquement) n'est due **que si la ligne est
    réalisée**. Sur une ligne annulée/no-show côté client, ces 10 % ne sont **pas** versés au
    référent — ils sont **redirigés vers le prestataire**, en compensation du créneau bloqué pour
    rien. Le référent n'a rien apporté de concret (le client n'est jamais venu) ; le prestataire,
    lui, a bloqué sa disponibilité pour cette réservation.
  - En auto-référence ou en direct, il n'y a de toute façon aucune part référent à
    redistribuer (déjà 0 % dans le cas normal, §3b) — rien ne change pour ces deux cas.
  **Simplification (2026-08-12)** : remplace la précédente version de cette règle (fenêtre
  d'annulation gratuite en jours, reversement no-show partiel configurable) — abandonnée après
  clarification du modèle de paiement. **Il n'y a plus de « politique d'annulation » à afficher
  comme un délai** : la règle à communiquer au client est simplement qu'une annulation ou une
  absence de sa part n'est jamais remboursée, sauf si c'est l'établissement qui annule.
  **Précision sur le montant concerné** : l'argent réellement mobilisé par la plateforme (une
  fois le paiement en ligne implémenté, cf. cadrage général — hors périmètre v1) n'est jamais le
  total de la réservation, seulement l'**acompte** — le reste se règle directement avec
  l'établissement.
- **A11 — décision (2026-08-11) : périmètre minimal reconduit pour ce premier lot.** Séjour
  minimum, délai de préavis minimum et tarif week-end différencié restent de **bonnes options à
  garder en tête**, mais pas à construire maintenant — notées comme cibles futures possibles
  (cf. `hifago/README.md`), pas comme un manque à combler dès la refonte.
- **A14 — décision (2026-08-11) : la limite est levée.** Un même produit pourra apparaître
  **plusieurs fois dans une même commande, à des dates différentes** — sous réserve, comme pour
  toute ligne, que chaque date choisie ait assez de places/chambres disponibles (règles de cupos
  du §3d, appliquées indépendamment à chaque ligne, y compris entre deux lignes du même produit à
  des dates différentes).
- **A12 — la grille tarifaire d'un logement proposé par un prestataire ne s'édite pas dans la
  file d'approbation admin.** Hors périmètre de ce document (concerne `/partner`/`/admin`, pas le
  parcours client) — à reprendre dans le cahier des charges du portail concerné, pas ici.

**Non tranchable ici, à vérifier empiriquement plus tard** :
- **Q1** — reste à confirmer sur une vraie réservation multi-lits payée : Lobby facture-t-il bien
  `rates_per_day` comme le tarif total de la chambre (quantité déjà encodée dans le prix), et non
  un prix par personne multiplié automatiquement ? La convention actuelle suppose la première
  lecture ; à reconfirmer avant de porter cette hypothèse dans un nouveau connecteur PMS.
- **Q5** — dépôt de logement entier encaissé en ligne : dépend de la décision paiement en ligne
  (MercadoPago/Stripe), déjà notée comme cible future non tranchée (cf. `hifago/README.md`).

## 8. Annexe — traçabilité code→règle

**Statut : en relecture — à valider avec Jérôme.**

### Fichiers sources par section

| Section | Fichiers sources principaux |
|---|---|
| §1 Périmètre et vision | `docs/2-reference/04-app-reservar.md` (§ Rôle), `docs/2-reference/01-architecture.md` |
| §3a Catalogue et tarification | `src/services/catalogService.js`, `src/services/portalService.js:594`, `docs/2-reference/04-app-reservar.md` (§ hébergements, § modèle Casa Kayam) |
| §3b Moteur de commission | `src/services/pricingService.js` (`priceLine()`), invariant R5 du registre interne |
| §3c Code partenaire / attribution | `src/services/orderService.js`, `src/services/portalService.js` (`discount_only`), `src/services/pricingService.js` |
| §3d Disponibilité, cupos, calendrier | `src/services/inventoryService.js` (`isPerSlot`, `assertCanReserve`, `assertCanReserveStay`), `src/controllers/portalController.js` |
| §3e Règles de panier | `src/services/portalService.js` (`reserve()`, validation/bornage synchrone) |
| §3f Cycle de vie de la commande | `src/services/orderService.js` (`LINE_TRANSITIONS`, `markMirrorFailed`), `src/services/storageService.js` (`expireStale`), `src/services/commission.js` (`deriveStatus`), `src/services/ledgerService.js` (`openException`), `src/controllers/lobbyController.js` |
| §4 Entités de données | `docs/2-reference/05-data-model.md` (tables `products`, `product_calendar`, `orders`, `order_lines`, `exceptions_queue`, `partner_codes`, `providers.lobby_connector`) |
| §5 Intégration LobbyPMS | `docs/2-reference/04-app-reservar.md` (§ `POST /reserve`), `docs/3-integrations/lobby_pms_api.md`, `docs/3-integrations/lobby_pms_implementation.md`, `src/services/catalogService.js` (`isPmsBacked`), `docs/2-reference/05-data-model.md`, `docs/2-reference/08-known-gaps.md` (A4, A11-A13, Q5) |
| §6 Cas limites | `docs/2-reference/04-app-reservar.md` (barème dorms, arrondi maison entière, tours statiques), `docs/2-reference/05-data-model.md` (`experiences.online_bookable`) |
| §7 Lacunes connues | `docs/2-reference/08-known-gaps.md` (A2, A3, A4, A6, A7, A9, A11-A14, G10-G12, Q1, Q5) |

### Points explicitement laissés ouverts pour le chiffrage technique

Consolidé depuis les sections ci-dessus — à trancher à l'ouverture du chiffrage, pas avant :

1. **§3e** — les plafonds de lignes/unités du panier (aujourd'hui pensés pour un seul
   établissement) : plafond global sur toute la commande une fois plusieurs établissements
   combinés, ou plafond répété par établissement ?
2. **§2** — placement des suggestions complémentaires : uniquement à l'étape de paiement, après
   chaque ajout au panier, ou les deux ?
3. **§2** — détail d'implémentation du voucher/e-ticket (QR, PDF, autre).

**Points désormais tranchés le 2026-08-13** : remise par quantité = jamais sur les nuits ;
attribution persistante = compte enregistré uniquement et dernier code valide prioritaire ;
modification = lignes choisies, annulation = commande entière.

### Cibles futures importantes (hors périmètre immédiat, à ne pas perdre)

Consolidées dans `hifago/README.md` pour rester visibles au niveau de tout le chantier, pas
seulement de ce document : synchronisation externe (iCal) pour les propriétés sans PMS,
paiement en ligne (MercadoPago/Stripe), options de logement entier (séjour minimum, délai de
préavis, tarif week-end).
