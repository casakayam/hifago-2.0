---
id: specs-notifications-email-transactionnelles
titre: "Notifications email transactionnelles (invitation, modération, paiement, réconciliation)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implémenté (Tranche 1 + Tranche 2) — envoi réel Resend non vérifié, domaine non configuré
maj: 2026-08-24
resume: >
  Premier fournisseur email applicatif du projet (Resend) : file Postgres + journal d'envoi +
  Edge Function, sur le même patron que le connecteur LobbyPMS. Tranche 1 (4 événements, aucune
  RPC de réservation/paiement touchée) : invitation partenaire par email, notification admin d'une
  nouvelle proposition/exception de réconciliation, notification partenaire du verdict de sa
  proposition. Tranche 2 (4 événements, tous branchés dans create_order ou apply_payment_webhook —
  les deux RPC les plus sensibles du projet) : commission attribuée, paiement effectué,
  confirmation de réservation au client, blocage de ressource camp/evento notifié au prestataire.
  Révisée après un challenge adversarial multi-agents (2026-08-24) : corrige une lecture erronée du
  cahier des charges admin (« rattachement établissement en attente » n'existe pas — le vrai
  déclencheur décidé, « demande d'ouverture prestataire en attente », dépend d'un parcours
  self-service jamais construit, donc hors périmètre) et ajoute un événement décidé mais oublié
  (blocage camp/evento).
mots_cles: [email, notification, Resend, invitation, modération, proposition, réconciliation, paiement, webhook, pg_cron, Edge Function]
repond_a:
  - "Comment envoyer un email transactionnel dans hifago (invitation, notification admin, notification partenaire) ?"
  - "Pourquoi apply_payment_webhook n'envoie-t-il pas encore d'email de confirmation ?"
  - "Quel fournisseur email est utilisé, et pourquoi jamais le mailer Supabase Auth ?"
  - "Pourquoi la notification 'demande d'ouverture prestataire en attente' n'est-elle pas construite ici ?"
---

# Notifications email transactionnelles

> **Cible stack** : Hifago (`supabase/migrations`, `supabase/functions`, `apps/admin`). Nouvelle
> Edge Function (la deuxième du dépôt après `pms-poll-bookings`/`pms-nightly-contract-check`).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 6 | Modèle de données | implémenté |
| 7 | Contrat API/RPC | implémenté |
| 8 | Règles et invariants | implémenté |
| 9 | Cas limites | implémenté (tests fault-injection + concurrence écrits et verts) |
| 10 | Décisions tranchées / points ouverts | les points ouverts restent ouverts — aucune décision silencieuse |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### État réel du dépôt au moment d'écrire cette spec (important, cf. §10 point 0)

`supabase/migrations/20260824030000_partner_invitation_email.sql` **existe déjà sur disque**
(non commité) — colonne `partner_invitations.email` et `create_partner_invitation(..., p_email
text default null)` déjà écrites. Il ne stocke PAS encore l'email (pas d'enqueue : la table
`notification_emails` n'existait pas encore au moment où ce fichier a été écrit). Étape restante
sur ce fichier : ajouter l'enqueue **après** la migration `notification_emails` (renumérotée
avant, cf. ordre en §0 "Fichiers touchés"), pas recréer la colonne/le paramètre depuis zéro.

### Endpoints / RPC

Toutes en `security definer`, `set search_path = ''`. Squelette Vault/`pg_net`/`pg_cron` copié de
`supabase/migrations/20260819140000_pms_jobs_cron.sql` ; squelette `FOR UPDATE SKIP LOCKED` copié
de `claim_pms_poll_batch` (`20260819120000`).

- `enqueue_notification_email(p_event_type text, p_recipient_email text, p_recipient_account_id
  uuid, p_subject text, p_body_html text, p_related_table text default null, p_related_id uuid
  default null) returns uuid` — **`revoke execute ... from public, authenticated, anon;` explicite**
  (jamais appelée directement par un client — uniquement en nested depuis d'autres fonctions
  `SECURITY DEFINER`/triggers du même propriétaire, cf. §8.3 pour pourquoi ceci suffit). No-op
  silencieux (retourne `null`) si `p_recipient_email` est null/vide.
- `notify_all_admins(p_event_type text, p_subject text, p_body_html text, p_related_table text
  default null, p_related_id uuid default null) returns void` — même posture de grant.
  Boucle sur `partner_capabilities join auth.users` (`role='admin' and status='active'`). **Isole
  chaque admin individuellement** (§8.1/§8.2) : le `begin/exception` protège CHAQUE itération, pas
  la boucle entière — un admin en échec ne doit jamais empêcher les suivants de recevoir leur email.
- `claim_notification_email_batch(p_limit int default 20) returns setof notification_emails` —
  `revoke ... from public, authenticated, anon; grant ... to service_role;` (miroir exact de
  `claim_pms_poll_batch`). Réclame `status='pending'` **ET** `status='sending' and last_attempt_at
  < now() - interval '10 minutes'` (récupération d'une ligne bloquée par un crash de l'Edge
  Function entre l'envoi Resend réussi et l'appel à `mark_notification_email_sent`, cf. §8.4) —
  `for update skip locked`.
- `mark_notification_email_sent(p_id uuid, p_provider_message_id text) returns void`,
  `mark_notification_email_failed(p_id uuid, p_error text, p_max_attempts int default 5) returns
  void` — même posture `service_role` uniquement.
- `invoke_send_notification_emails() returns void` — miroir de `invoke_pms_poll_bookings()`,
  réutilise les secrets Vault `pms_functions_base_url`/`pms_service_role_key` (déjà seedés,
  générique malgré le nom). `cron.schedule('send-notification-emails', '*/5 * * * *', ...)`.
- `create_partner_invitation(...)` — **déjà étendue sur disque** (cf. encart ci-dessus) avec
  `p_email text default null`. Reste à ajouter : si `p_email` non-null, enqueue `event_type=
  'partner_invitation'` — dans un sous-bloc `begin/exception` (§8.1), jamais nu.
- `moderate_product_proposal(...)`/`moderate_establishment_proposal(...)` — signatures
  **inchangées**. **Point de vigilance** (trouvé en relisant les définitions LIVE, pas la première
  version historique) : leurs `select ... into v_proposal` actuels (dernière redéfinition —
  `moderate_product_proposal` dans `20260818170000_camp_tags_and_room_photos.sql`,
  `moderate_establishment_proposal` dans `20260819200000_establishment_creation_proposal_photos.sql`)
  **ne sélectionnent pas `submitted_by`**. Ne pas élargir `v_proposal` (risque de casser une
  logique existante non liée à cette spec) — ajouter une petite requête séparée juste avant
  l'enqueue : `select submitted_by into v_submitted_by from public.product_proposals where id =
  p_proposal_id` (`establishment_proposals` pour l'autre RPC). Après la mise à jour de statut
  (branches `approve`/`reject`), enqueue `event_type='partner_proposal_decided'` vers ce compte
  (email via `auth.users`), dans un sous-bloc `begin/exception`.
- Triggers `AFTER INSERT` (nouveaux, aucune signature à préserver) :
  `notify_admin_new_proposal()` sur `product_proposals`/`establishment_proposals` ;
  `notify_admin_new_reconciliation_exception()` sur `payment_reconciliation_entries`/
  `pms_reconciliation_entries`. Chaque trigger enveloppe son propre corps dans `begin/exception`
  (§8.1) — une proposition/exception doit toujours pouvoir s'insérer même si son trigger casse.
- `send-notification-emails` (Edge Function, `supabase/functions/send-notification-emails/index.ts`)
  — `claim_notification_email_batch` → `POST {RESEND_API_BASE_URL}/emails` avec un en-tête
  `Idempotency-Key: <notification_emails.id>` (Resend le supporte — protège contre un envoi
  physique en double si une ligne est reprise après un crash post-succès, cf. §8.4) →
  `mark_*_sent`/`mark_*_failed`. **Réponse HTTP volontairement agrégée** (`{ok, claimed, sent,
  failed}`, jamais `recipient_email`/`subject`/`body_html`) — même discipline que
  `pms-poll-bookings` (§8.6, PII).
- **Tranche 2** (`create_order` ET `apply_payment_webhook`, cf. §2/§3 pour la justification du
  regroupement) :
  - `apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text,
    p_raw_event jsonb)` — signature inchangée, 3 enqueue isolés (commission, paiement,
    confirmation client) dans la branche `p_status = 'approved'`, après l'`update orders set
    payment_status = 'paid'` — un partenaire distinct par boucle isolé individuellement (§8.2).
  - `create_order(...)` — signature inchangée, 1 enqueue supplémentaire (`partner_camp_evento_
    blocked`) dans la branche `if v_line_type = 'camp' then`, juste après l'`insert into
    availability_blocks` déjà existant — isolé par le même sous-bloc `begin/exception`.

### Modèle de données (delta)

| Table | Statut | Détail |
|---|---|---|
| `notification_emails` | **créée** | `id uuid pk`, `event_type text check(...)` (8 valeurs — cf. §6), `recipient_email text not null`, `recipient_account_id uuid references partner_accounts(id)` (nullable), `subject text not null`, `body_html text not null`, `related_table text`, `related_id uuid`, `status text default 'pending' check(pending/sending/sent/failed/abandoned)`, `attempts int default 0`, `last_attempt_at timestamptz`, `last_error text`, `provider_message_id text`, `created_at timestamptz default now()`, `sent_at timestamptz` |
| `partner_invitations.email` | **déjà ajoutée sur disque** | cf. encart en tête de §0 |

Aucune autre colonne ajoutée (le point "rattachement établissement en attente" et sa colonne
`establishment_attachment_notified_at` de la version précédente de ce brouillon sont **retirés** —
cf. §10 point 0 pour pourquoi).

### Invariants

- Une notification email qui échoue à s'empiler ou à se construire **ne fait jamais échouer**
  l'opération métier qui la déclenche (§8.1) — vrai pour toute RPC ET tout trigger de ce périmètre,
  y compris `create_order` (Tranche 2, pas seulement `apply_payment_webhook`).
- Le sous-bloc d'isolation attrape **`others` ET `query_canceled`** explicitement — `others` seul
  ne suffit pas, `query_canceled` en est exclu par construction en PL/pgSQL (§8.1).
- L'isolation est posée **par itération**, jamais autour d'une boucle entière (`notify_all_admins`,
  boucle des partenaires distincts en Tranche 2) — un destinataire en échec ne doit jamais faire
  sauter silencieusement les suivants (§8.2).
- `enqueue_notification_email` ne lève jamais d'exception sur un destinataire manquant (cas
  attendu, ex. invitation sans email) — no-op silencieux.
- `apply_payment_webhook` reste idempotent après cette spec : `p_status='approved'` rejoué sur un
  paiement déjà `approved` retourne `already_applied` **avant** d'atteindre les 3 nouveaux enqueue.
- Les 2 emails admin (nouvelle proposition, exception réconciliation) restent minimaux :
  identifiant + lien vers l'écran admin existant, jamais le contenu intégral.
- `claim_notification_email_batch` ne laisse jamais une ligne bloquée indéfiniment à `sending`
  (§8.4) — reprise après 10 min, envoi physique protégé par `Idempotency-Key` Resend.
- La réponse HTTP de `send-notification-emails` ne contient jamais de PII (§8.6).
- Aucune notification n'est un canal de vérité — `notification_emails` est un journal + une file,
  jamais consultée pour une décision métier.

### Cas limites

- Invitation créée sans email (`p_email` omis) → aucun enqueue, flux WhatsApp manuel inchangé.
- Commande avec des lignes de plusieurs partenaires → un enqueue par partenaire **distinct**, isolé
  individuellement (Tranche 2), pas un email agrégé mal ciblé.
- `payment_reconciliation_entries.payment_id` peut être `null` (webhook jamais corrélé à un
  paiement connu) → l'email d'exception retombe sur un libellé générique ("commande non
  identifiée"), pas un crash de construction du corps.
- 0 admin actif (jamais observé en seed, mais possible) → `notify_all_admins` boucle 0 fois, no-op.
- Trigger déclenché pendant `supabase db reset`/seed/e2e → ligne `notification_emails` créée
  normalement, jamais d'envoi réel (pas de clé Resend par défaut en local) — purgée par le
  nettoyage e2e partagé.
- Webhook Mercado Pago dupliqué après un paiement déjà `approved` → court-circuité par la garde
  d'idempotence existante, avant tout enqueue (pas de double email).
- Edge Function qui crashe entre l'envoi Resend réussi et `mark_notification_email_sent` → ligne
  reprise après 10 min par `claim_notification_email_batch`, envoi physique dédupliqué côté Resend
  via `Idempotency-Key` (§8.4) — jamais un email physiquement doublé, jamais une ligne figée.
- Une INSERT/statement lente sur `notification_emails` pendant `apply_payment_webhook`/`create_order`
  → `query_canceled` explicitement attrapé (§8.1), jamais une confirmation de paiement/réservation
  perdue à cause de la lenteur d'un sous-système annexe.
- Une ligne dépasse le nombre max de tentatives → `status='abandoned'`, plus jamais reprise par le
  poll ; visible uniquement par requête directe sur `notification_emails` (pas d'écran dédié v1).
- Un référent demande la capacité prestataire en self-service (parcours décrit socio §3b) → **hors
  périmètre de cette spec**, cf. §10 point 0 : le parcours lui-même n'existe pas encore en code.

### Fichiers touchés

Migrations (ordre d'application, Tranche 1) :
1. `notification_emails` + `enqueue_notification_email`/`notify_all_admins`/
   `claim_notification_email_batch`/`mark_notification_email_sent`/`mark_notification_email_failed`
   (nouveau fichier, timestamp **avant** `20260824030000_partner_invitation_email.sql`).
2. Édition du fichier `20260824030000_partner_invitation_email.sql` déjà présent sur disque :
   ajouter l'enqueue (cf. encart §0) — ce fichier n'a encore jamais été appliqué, l'éditer
   directement reste sûr (pas de migration déjà appliquée touchée, cf. règle projet).
3. Triggers "nouvelle proposition" + `notify_all_admins`.
4. Triggers "exception réconciliation".
5. Enqueue "proposition traitée" dans `moderate_product_proposal`/`moderate_establishment_proposal`
   (widening du lookup `submitted_by`, cf. encart §0).
6. `invoke_send_notification_emails()` + `cron.schedule`.

Tranche 2 (séparée) : migration `apply_payment_webhook` (3 enqueue) + migration `create_order`
(1 enqueue, branche camp).

Code applicatif : `supabase/functions/send-notification-emails/index.ts`,
`apps/admin/app/admin/invitations/new/NewInvitationForm.tsx` (champ email),
`packages/e2e-support/src/db.ts` (purge FK). Tests : `supabase/tests/database/
notification_emails.test.sql` (incl. fault-injection, §8.1), `notification_admin_events.test.sql`,
extension de `create_partner_invitation.test.sql`/`moderate_product_proposal.test.sql`/
`payments.test.sql`/`create_order` tests (incl. fault-injection pour Tranche 2),
`tests/notification-integration/send_notification_emails.integration.mjs`,
`tests/concurrency/claim_notification_email_batch.concurrency.mjs` (§9 test-adéquation), 1 e2e
Playwright.

---

## 1. Contexte et problème

Aucune infrastructure d'envoi d'email applicative n'existe aujourd'hui dans `hifago/` : le seul
mailer branché est celui de Supabase Auth (confirmation d'inscription, reset mot de passe — spec 07,
`docs/specs/07-connexion-inscription-complete.md`), explicitement réservé à cet usage interne et
jamais destiné aux notifications métier (`CLAUDE.md` §9/§10 — "un fournisseur email dédié, jamais
le mailer Supabase Auth" est acquis, le choix final entre Resend/Postmark était renvoyé au
chiffrage). Deux manques concrets constatés en explorant le code :

1. **Invitation partenaire** : le lien d'invitation (jeton opaque, `create_partner_invitation`,
   `supabase/migrations/20260813230000_create_partner_invitation_rpc.sql`) est aujourd'hui transmis
   **à la main par WhatsApp** — aucun envoi automatisé, `apps/admin/app/admin/invitations/new/
   NewInvitationForm.tsx` se contente d'afficher le lien à copier-coller.
2. **Modération admin** : le mécanisme de proposition/approbation existe déjà entièrement en base
   et en écran (`product_proposals`/`establishment_proposals`, RPC `submit_*`/`moderate_*`, écran
   `apps/admin/app/admin/proposals/page.tsx`), mais la seule "notification" est un badge passif sur
   la page d'accueil admin (`AdminAlerts.tsx`, lu au chargement, sans polling/Realtime) — rien
   n'avertit l'admin qu'une proposition attend, ni le partenaire une fois le verdict rendu.

En creusant le cahier des charges (`docs/02-cahier-des-charges-socio.md:114-116`,
`docs/03-cahier-des-charges-admin.md:159-161`, décision datée du 2026-08-11), le lot de
notifications proactives déjà actées est le suivant — **relu et corrigé après un challenge
adversarial de ce brouillon (2026-08-24)**, une première version de cette spec avait mal cité la
source (cf. §10 point 0 pour l'écart exact) :

- Côté partenaire (`docs/02-cahier-des-charges-socio.md:114-116`) : commission attribuée,
  proposition traitée, paiement effectué.
- Côté admin (`docs/03-cahier-des-charges-admin.md:159-161`) : nouvelle proposition à modérer,
  nouvelle exception de réconciliation, **demande d'ouverture prestataire en attente** (pas
  "rattachement établissement en attente", erreur de la première version de ce brouillon — cf.
  §10 point 0 pour la correction complète et pourquoi ce déclencheur précis reste hors périmètre
  de cette spec).
- Un événement **décidé le 2026-08-13 mais absent de la première version de ce brouillon**
  (trouvé en re-vérifiant le cahier des charges pendant le challenge) : notification au
  prestataire quand une réservation de camp/evento bloque sa ressource de disponibilité partagée
  (`docs/02-cahier-des-charges-socio.md:409-412`, `docs/01-cahier-des-charges-client.md:433-438`).

Un 8ᵉ événement (confirmation de réservation au client, avec détail et prix) a été ajouté par
Jérôme en revue de plan pour cette spec — absent du cahier des charges socio/admin ci-dessus, mais
faisable dès maintenant : l'email client est **obligatoire** à toute commande depuis le 2026-08-17
(`docs/01-cahier-des-charges-client.md:493-497`, validé par `create_order`), donc un destinataire
est toujours garanti.

L'architecture cible (`docs/04-architecture-cible.md:648-661`) décide déjà : un fournisseur email
dédié, une file Postgres + Edge Function (même mécanisme que WhatsApp/360dialog et le connecteur
LobbyPMS), un vrai journal d'envoi tracé (`docs/00-modele-de-donnees.md:337`, décision du
2026-08-12).

## 2. Portée

**In** : file d'envoi + journal (`notification_emails`), Edge Function Resend, et **8 événements**
répartis en deux tranches :

- **Tranche 1** (4 événements — invitation, nouvelle proposition à modérer, proposition traitée,
  exception de réconciliation) : **aucun ne touche `create_order` ni `apply_payment_webhook`**,
  les deux RPC les plus sensibles du projet (la première parce qu'appelée par tout client
  anonyme/authentifié à chaque panier, avec tout le verrouillage anti-survente ; la seconde parce
  que protégée uniquement par un grant `service_role`, sans garde interne, cf. son propre
  commentaire dans `apply_payment_webhook.sql`).
- **Tranche 2** (4 événements — commission attribuée, paiement effectué, confirmation client,
  blocage camp/evento) : **tous** branchés dans `create_order` ou `apply_payment_webhook` — d'où
  le regroupement en une tranche distincte, construite et vérifiée après la Tranche 1.

**Out** :
- **"Demande d'ouverture prestataire en attente"** (cf. §10 point 0) — événement admin réellement
  décidé au cahier des charges, mais dont le parcours self-service sous-jacent (référent qui
  demande la capacité prestataire depuis son tableau de bord, accordée automatiquement si la zone
  est couverte, sinon mise en liste d'attente) **n'existe pas encore dans le code** (recherche
  exhaustive : `source='self_upgrade'` n'est jamais inséré par aucune RPC, seulement déclaré comme
  valeur d'énum et utilisé dans un fixture de test). Construire la notification maintenant serait
  spéculatif. Quand ce parcours sera construit, sa RPC devra appeler `notify_all_admins(...)`
  directement au moment de la mise en liste d'attente — zéro nouveau schéma nécessaire, cette
  spec fournit déjà toute l'infrastructure.
- Campagnes groupées admin (`comm_campaigns`/`comm_campaign_targets`, feature 25) — moteur voisin
  mais distinct (audience, pas 1:1 déclenché par une action précise), non touché ici.
- Canal WhatsApp pour ces mêmes 8 événements — le cahier des charges laisse le choix de canal
  ouvert par notification, cette spec ne construit que le canal email.
- Écran admin de consultation du journal `notification_emails` — pas d'action requise dessus pour
  ce périmètre (contrairement à la réconciliation, qui a un écran parce qu'elle nécessite une
  résolution) ; interrogation directe en base suffit en v1.
- Domaine d'envoi vérifié (SPF/DKIM/DMARC) et compte Resend réel — prérequis opérationnel externe,
  action Jérôme, hors périmètre du code.

## 3. Décisions retenues

- Fournisseur : **Resend** (offre gratuite 3 000 emails/mois vs 100/mois chez Postmark — seule
  offre réellement gratuite en continu à ce volume, comparée le 2026-08-24).
- Livrable : spec + implémentation fonctionnelle (marche en local dès cette session ; preprod/prod
  une fois le domaine vérifié par Jérôme), pas un brouillon non codé.
- Périmètre final : 8 événements, découpés en 2 tranches selon **quelle RPC ils touchent** (pas
  selon "paiement ou pas") — cf. §2 pour la justification exacte, révisée après le challenge du
  2026-08-24 (le blocage camp/evento touche `create_order`, pas `apply_payment_webhook`, mais
  porte le même profil de risque — appelé par tout client à chaque panier — donc classé Tranche 2
  lui aussi).
- Pas de moteur de template séparé : le cahier des charges confirme que la contrainte de template
  pré-approuvé (WhatsApp/360dialog) ne s'applique pas à l'email, texte libre autorisé
  (`docs/03-cahier-des-charges-admin.md:179-186`).
- Contenu volontairement minimal pour les 2 emails admin (nouvelle proposition, exception de
  réconciliation) : identifiant utile + lien vers l'écran admin existant pour le détail complet,
  jamais un résumé exhaustif dans le corps (décision Jérôme en revue de plan).
- **Isolation systématique des échecs de notification** (§8.1/§8.2), y compris `query_canceled` et
  la granularité par-destinataire — décidé après le challenge adversarial du 2026-08-24, qui a
  démontré qu'un simple `exception when others` autour d'une boucle entière ne suffisait pas.

## 4. Parcours cible

**Invitation (Tranche 1)** : admin remplit `NewInvitationForm` avec un email → `create_partner_invitation`
crée l'invitation et enqueue l'email → cron (`*/5 * * * *`) le réclame et l'envoie via Resend → le
destinataire reçoit le lien (même contenu que le lien affiché à l'écran aujourd'hui).

**Nouvelle proposition (Tranche 1)** : un partenaire soumet une proposition (`submit_product_proposal`
ou équivalent établissement) → `INSERT` sur `product_proposals`/`establishment_proposals` déclenche
le trigger → un email est enqueué par admin actif, avec le nom du produit/établissement + le nom du
partenaire + un lien vers `/admin/proposals/[id]`.

**Verdict de proposition (Tranche 1)** : l'admin appelle `moderate_product_proposal`/
`moderate_establishment_proposal` (`approve`/`reject`) → un email est enqueué vers le compte
`submitted_by` (résolu par une requête dédiée, cf. §0), portant la décision et le motif si rejet.

**Exception de réconciliation (Tranche 1)** : une ligne apparaît dans
`payment_reconciliation_entries`/`pms_reconciliation_entries` (webhook Mercado Pago en échec, ou
poll LobbyPMS détectant une dérive) → trigger → email admin minimal + lien `/admin/reconciliation`.

**Paiement/commission/confirmation client (Tranche 2)** : le webhook Mercado Pago confirme
`p_status='approved'` → `apply_payment_webhook` marque `orders.payment_status='paid'` → 3 enqueue
isolés individuellement : email(s) partenaire "commission attribuée" (si
`commission_case='external_referrer'` sur au moins une ligne), email(s) partenaire "paiement
effectué" (par partenaire propriétaire distinct des lignes), email client "confirmation de
réservation" (`orders.holder_email`, résumé des lignes).

**Blocage camp/evento (Tranche 2)** : un client réserve un camp/evento → `create_order` verrouille
et bloque la ressource partagée du prestataire (`provider_resource_calendar`/`availability_blocks`,
mécanisme déjà existant, inchangé) → **au même moment**, dans la même transaction, un enqueue
isolé notifie le prestataire (dates bloquées, activités devenues indisponibles) — cf. §10 point 3
pour la nuance sur le timing (avant confirmation de paiement, décision déjà actée telle quelle par
le cahier des charges, pas une réouverture de cette spec).

## 5. Écran(s)

Aucun nouvel écran. Seul changement UI : `NewInvitationForm.tsx` gagne un champ `email` (optionnel)
envoyé comme `p_email` à `create_partner_invitation` ; le bloc "lien à copier" existant reste
inchangé (l'email est un canal en plus, pas un remplacement — le lien reste affiché une seule fois,
même contenu qu'aujourd'hui).

## 6. Modèle de données

### `notification_emails` (nouvelle table, journal d'envoi + file)

```sql
create table notification_emails (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'partner_invitation',
    'admin_new_proposal',
    'admin_new_reconciliation_exception',
    'partner_proposal_decided',
    'partner_commission_earned',
    'partner_payment_confirmed',
    'client_order_confirmed',
    'partner_camp_evento_blocked'
  )),
  recipient_email text not null,
  recipient_account_id uuid references partner_accounts(id),
  subject text not null,
  body_html text not null,
  related_table text,
  related_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'abandoned')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_emails_pending_idx
  on notification_emails(created_at) where status = 'pending';

-- Reprise d'une ligne bloquée à 'sending' par un crash de l'Edge Function (§8.4).
create index notification_emails_stale_sending_idx
  on notification_emails(last_attempt_at) where status = 'sending';

-- Dédup : coalesce nécessaire — un index unique ne déduplique jamais deux NULL entre eux en
-- Postgres, or recipient_account_id est NULL pour l'invitation et la confirmation client.
create unique index notification_emails_dedup_idx
  on notification_emails(
    event_type, related_table, related_id,
    coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where related_id is not null;

alter table notification_emails enable row level security;
revoke insert, update, delete on notification_emails from authenticated, anon;
create policy notification_emails_select_admin on notification_emails
  for select using ((select is_admin(auth.uid())));
```

Pattern `related_table`/`related_id` réutilisé tel quel depuis `audit_log.entity_table`/
`entity_id` (`20260813201000_admin_audit_log.sql`) — pas de FK polymorphe. Les 8 `event_type` sont
tous liés à une entité précise (`related_id` toujours renseigné) : plus de cas "digest sans entité"
depuis le retrait de l'événement "rattachement en attente" (§10 point 0) — l'index de dédup n'a
donc plus besoin de l'exclusion spéciale de la version précédente de ce brouillon.

### `partner_invitations.email` (colonne, déjà ajoutée sur disque — cf. encart §0)

## 7. Contrat API/RPC

Signatures détaillées en §0. Points de conception notables, non répétés en §0 :

- **`enqueue_notification_email`** ne lève jamais d'exception sur un destinataire manquant — un
  email raté ne doit jamais faire échouer l'opération métier qui le déclenche (invariant §8.1).
  Toute AUTRE erreur (bug de construction du sujet/corps) est isolée non pas dans cette fonction
  elle-même, mais par le sous-bloc `exception when others, when query_canceled` posé à **chaque
  site d'appel** — la fonction reste simple, l'isolation est la responsabilité de l'appelant.
- **Pourquoi des triggers `AFTER INSERT` pour "nouvelle proposition" et "exception réconciliation"
  plutôt qu'un enqueue direct dans chaque RPC** : `product_proposals`/`establishment_proposals`
  sont insérées depuis au moins 2 RPC chacune et `payment_reconciliation_entries`/
  `pms_reconciliation_entries` sont insérées depuis des Route Handlers et une Edge Function
  (jamais via une RPC dédiée, cf. `apps/web/app/api/payments/webhook/route.ts` et
  `supabase/functions/pms-poll-bookings/index.ts`) — un trigger est le seul point qui couvre tous
  les sites d'insertion sans les dupliquer un par un.
- **"Proposition traitée" reste un enqueue direct** (pas un trigger) : `moderate_product_proposal`/
  `moderate_establishment_proposal` sont chacune un choke point unique.
- **Pourquoi une requête `submitted_by` séparée plutôt qu'élargir `v_proposal`** (§0) : les deux
  RPC ont déjà évolué plusieurs fois (`camp_tags_and_room_photos`, `establishment_creation_
  proposal_photos`) — élargir leur `select ... into v_proposal` risquerait une régression sans
  lien avec cette spec sur une logique déjà mouvante. Une requête d'un seul champ, juste avant
  l'enqueue, est strictement additive.
- **`invoke_send_notification_emails()` réutilise les secrets Vault PMS existants**
  (`pms_functions_base_url`/`pms_service_role_key`) plutôt que d'en créer de nouveaux — leur valeur
  est déjà générique, aucun fichier PMS existant n'est modifié.
- **Pourquoi `create_order` porte un enqueue en plus d'`apply_payment_webhook`** (blocage
  camp/evento, Tranche 2) : le blocage de ressource (`availability_blocks`/
  `provider_resource_calendar.booked`) est déjà écrit de façon synchrone dans `create_order`,
  avant tout paiement — le cahier des charges décrit explicitement la notification comme liée au
  moment où le blocage devient effectif ("le blocage est déjà effectif au moment du message ; il
  ne dépend pas d'un oui/non postérieur"), pas au paiement. Brancher ailleurs contredirait le texte
  déjà validé. Cf. §10 point 3 pour la nuance sur l'expiration.

## 8. Règles et invariants

1. **Isolation des échecs de notification** (le plus important de cette spec) : chaque site
   d'appel de `enqueue_notification_email` — RPC ou trigger — enveloppe la construction du
   sujet/corps + l'appel dans :
   ```sql
   begin
     perform public.enqueue_notification_email(...);
   exception
     when query_canceled then
       raise warning 'notification_emails: enqueue annulé (query_canceled) % — %', p_event_type, sqlerrm;
     when others then
       raise warning 'notification_emails: échec enqueue % — %', p_event_type, sqlerrm;
   end;
   ```
   **`when others` seul ne suffit PAS** : PL/pgSQL exclut explicitement `query_canceled` (et
   `assert_failure`) de la condition `others` — un `statement_timeout`/`lock_timeout` frappant
   l'INSERT dans `notification_emails` pendant une charge concurrente propagerait sinon
   l'exception hors du sous-bloc, jusqu'à annuler la transaction entière appelante (ex.
   `apply_payment_webhook` : la confirmation d'un vrai paiement Mercado Pago échouerait à cause
   d'une lenteur du sous-système de notification, l'exact inverse de ce que cet invariant garantit).
   Trouvé et corrigé lors du challenge adversarial du 2026-08-24 — jamais observé en pratique,
   mais un fait documenté du langage, pas une hypothèse.
2. **Granularité par destinataire, jamais par boucle entière** : `notify_all_admins` et la boucle
   Tranche 2 des partenaires distincts d'une commande posent le sous-bloc `begin/exception`
   **à l'intérieur** de chaque itération, jamais autour de la boucle complète. Un `begin/exception`
   entourant toute une boucle attrape l'erreur à la frontière du bloc, pas à la frontière de
   l'itération — un seul destinataire en échec (ex. un `format()` sur un champ `null`) annulerait
   silencieusement l'envoi à tous les destinataires suivants dans la même boucle, sans qu'aucun
   log ne distingue "en échec" de "jamais tenté". Trouvé lors du challenge adversarial.
3. `enqueue_notification_email`/`notify_all_admins` n'ont **aucun grant** `authenticated`/`anon`
   (revoke explicite, pas seulement une absence de grant) — appelées uniquement en nested depuis
   d'autres fonctions `SECURITY DEFINER` du même propriétaire. En Postgres, l'EXECUTE d'une
   fonction appelée en nested depuis une fonction `SECURITY DEFINER` est vérifié pour le rôle
   PROPRIÉTAIRE de la fonction appelante (pas l'appelant original) — le propriétaire a toujours
   EXECUTE sur ses propres fonctions par défaut, donc le nested-call fonctionne sans aucun grant à
   `authenticated`. Un revoke explicite (pas une absence de grant) est posé quand même, en défense
   en profondeur — cf. `CLAUDE.md` §11 point 1 : le comportement "pas de grant par défaut" n'est
   confirmé que sur l'instance locale, pas sur un provisioning cloud.
4. **`claim_notification_email_batch` reprend une ligne bloquée à `sending`** après 10 minutes
   sans nouvelle tentative (crash de l'Edge Function entre l'envoi Resend réussi et l'appel à
   `mark_notification_email_sent`) — sans ce mécanisme, une telle ligne resterait indéfiniment à
   `sending`, invisible à tout futur poll (`claim_notification_email_batch` ne sélectionnait que
   `status='pending'` dans la version précédente de ce brouillon), contredisant l'objectif même de
   `notification_emails` comme "vrai journal d'envoi tracé". La reprise physique est rendue sûre
   par l'en-tête `Idempotency-Key: <notification_emails.id>` envoyé à Resend (§0) — un envoi
   déjà réussi rejoué ne produit jamais un second email physique.
5. `apply_payment_webhook` reste idempotent tel quel (garde `already_applied` déjà existante,
   évaluée avant tout enqueue Tranche 2) — pas de nouvelle garde nécessaire.
6. La réponse HTTP de `send-notification-emails` reste strictement agrégée (`{ok, claimed, sent,
   failed}`) — jamais `recipient_email`/`subject`/`body_html` d'une ligne individuelle. **Limite
   connue, signalée mais hors périmètre de correction ici** : `supabase/config.toml` n'a aucune
   section `[functions.*]`, donc `send-notification-emails` hérite du défaut `verify_jwt=true`,
   qui accepte n'importe quel JWT valide — y compris la clé publique `anon`, pas seulement
   `service_role`. C'est déjà vrai aujourd'hui pour `pms-poll-bookings`, qui reste sûr uniquement
   parce que sa réponse HTTP se limite à des compteurs agrégés — cette spec applique la même
   discipline plutôt que de tenter de corriger le gap `verify_jwt` du projet entier (déjà présent,
   pas introduit ici) sans l'accord de Jérôme.
7. Un email admin (nouvelle proposition/exception réconciliation) ne porte jamais le contenu
   intégral de l'entité concernée — identifiant + lien vers l'écran existant uniquement (§3,
   décision Jérôme).
8. `notification_emails` est un journal + une file, jamais une source de vérité métier — aucune
   RPC ne doit un jour lire cette table pour décider d'un comportement.
9. Conçu pour N admins dès le départ (`notify_all_admins` boucle sur tous les comptes actifs), pas
   un seul compte codé en dur, même si un seul admin existe aujourd'hui (`admin@hifago.test`).

## 9. Cas limites

Liste sèche en §0 — non dupliquée ici (aucune n'exige plus qu'une ligne de justification).

**Test d'adéquation obligatoire, pas optionnel** (trouvé lors du challenge adversarial — aucun test
happy-path ne peut prouver un `exception when others/query_canceled` réellement fonctionnel) :

- **Fault-injection sur l'invariant §8.1**, au moins une fois par tranche. Technique : dans la
  transaction `begin;...rollback;` d'un fichier pgTAP existant, `create or replace function
  enqueue_notification_email(...)` avec un corps qui fait `raise exception 'fault injection
  test';`, puis appeler la vraie RPC (`apply_payment_webhook('mp-x', <payment_id>, 'approved',
  '{}')` pour la Tranche 2, `moderate_product_proposal(...)` pour la Tranche 1) et asserter qu'elle
  retourne toujours `ok:true`/l'état métier attendu (`payments.status='approved'`,
  `orders.payment_status='paid'`) — la preuve concrète qu'un bug de notification ne peut
  structurellement pas casser une confirmation de paiement, pas une supposition sur le
  comportement du `exception when others`.
- **Concurrence réelle sur `claim_notification_email_batch`** (`SKIP LOCKED`) : pgTAP ne peut pas
  la prouver (une seule transaction active par fichier, `CLAUDE.md` §6.3/`docs/05-reference-
  technique.md` §2) et le test d'intégration Edge Function planifié
  (`tests/notification-integration/`) est séquentiel, une seule invocation — aucun des deux ne
  peut démontrer l'absence de double-claim sous deux invocations concurrentes du cron. Nouveau
  fichier `tests/concurrency/claim_notification_email_batch.concurrency.mjs`, squelette barrière de
  synchronisation copié de `docs/05-reference-technique.md` §2 (driver `pg` direct, pas
  Playwright/HTTP) : seeder ~25 lignes `pending`, ouvrir plusieurs connexions concurrentes,
  chacune appelant `select * from claim_notification_email_batch(20)` synchronisées sur une
  barrière commune, puis asserter que l'union des ids réclamés est disjointe (aucun id réclamé
  deux fois) et couvre exactement les lignes seedées. **Calibrage volontairement plus léger que
  la barre "5 runs propres" réservée aux RPC anti-survente** (`docs/05-reference-technique.md` §2)
  — même raisonnement déjà appliqué à `moderate_product_proposal` (cf. son commentaire de tête,
  `20260813240500_moderate_product_proposal_rpc.sql`) : une collision ici cause un envoi en
  double ou différé, pas une survente financière — 1 exécution propre suffit pour ce premier
  périmètre, pas le harnais complet réservé au risque n°1.

## 10. Décisions tranchées / points ouverts

### Tranchées cette session

0. **Correction majeure post-challenge adversarial (2026-08-24)** — la première version de ce
   brouillon citait `docs/03-cahier-des-charges-admin.md:159-161` pour justifier un événement
   "rattachement établissement en attente" (compte `operator` sans `establishment_id`, digest
   quotidien 3j/7j). **Le texte réel à ces lignes dit "demande d'ouverture prestataire en
   attente"** — un événement différent : un référent qui demande en self-service la capacité
   prestataire (`docs/02-cahier-des-charges-socio.md:150-154`), accordée automatiquement si sa
   zone est couverte, sinon mise en liste d'attente. Vérifié : cette RPC self-service n'existe pas
   dans le code (recherche exhaustive de `source='self_upgrade'`, la valeur d'énum prévue pour ce
   cas — aucune RPC ne l'insère jamais, seul un fixture pgTAP l'utilise comme donnée de test).
   Décision : **retirer entièrement** l'événement "rattachement en attente" inventé (colonne
   `establishment_attachment_notified_at`, digest, cron — tous retirés de cette version) et
   documenter "demande d'ouverture prestataire en attente" comme hors périmètre tant que son
   parcours sous-jacent n'existe pas (§2). Un événement réellement décidé mais absent de la
   première version (blocage camp/evento, décidé le 2026-08-13) a été ajouté à la place — le
   total reste 8 événements par coïncidence, pas par ajustement délibéré du chiffre.
1. **Découpage en 2 tranches par RPC touchée** (révisé après le challenge — la première version
   découpait par "touche le paiement ou pas", ce qui classait par erreur le blocage camp/evento
   comme n'importe quel autre événement alors qu'il touche `create_order`, tout aussi sensible
   qu'`apply_payment_webhook`) : Tranche 1 = infra + 4 événements qui ne touchent ni `create_order`
   ni `apply_payment_webhook` ; Tranche 2 = les 4 qui touchent l'un des deux. Construire et
   vérifier la Tranche 1 en conditions réelles avant de toucher aux deux RPC les plus sensibles du
   projet reste le raisonnement d'origine ("ce que ferait une vraie app", retour direct de Jérôme).
2. **Branchement "commission attribuée" sur `apply_payment_webhook`, pas `create_order`** : 3
   candidats identifiés en lisant `create_order` — insertion `ledger_entries` en
   `status='estimated'` à la création du panier, transition `'estimated'→'due'` à la prestation
   fournie, ou confirmation du paiement. Retenu : `apply_payment_webhook`, pour éviter de notifier
   un partenaire d'un revenu qui peut ne jamais se matérialiser si le client abandonne le paiement.
3. **Branchement "blocage camp/evento" sur `create_order`, pas `apply_payment_webhook`** — à
   l'inverse du point 2 ci-dessus : le cahier des charges décrit explicitement le blocage comme
   "déjà effectif au moment du message", et le blocage lui-même (`availability_blocks`/
   `provider_resource_calendar.booked`) est déjà écrit de façon synchrone et inconditionnelle dans
   `create_order`, avant tout paiement — comportement existant, non remis en cause par cette spec.
   **Nuance signalée, pas tranchée** : si `expire_stale_payment_orders` (job d'expiration à 30 min
   des commandes jamais payées) ne libère jamais ce blocage, un prestataire recevrait une
   notification "réservé" pour une commande qui expire ensuite silencieusement côté client — un
   comportement déjà présent aujourd'hui indépendamment de cette spec (le blocage est
   inconditionnel depuis sa création, spec 20), donc pas un écart introduit ici, mais à vérifier
   par Jérôme si ce n'était pas déjà connu.
4. **Dédup de `notification_emails` par `coalesce(recipient_account_id, uuid nul)`** plutôt qu'un
   index unique brut sur la colonne — Postgres ne considère jamais deux `NULL` comme égaux dans un
   index unique.
5. **Isolation systématique et par-destinataire des échecs de notification** (§8.1/§8.2),
   attrapant `others` ET `query_canceled` — pas seulement sur `apply_payment_webhook`, sur tous
   les sites d'appel, Tranche 1 et 2.
6. **Reclaim des lignes bloquées à `sending`** après 10 minutes + `Idempotency-Key` Resend (§8.4).
7. **Revoke explicite** (pas une simple absence de grant) sur toutes les fonctions internes/
   service_role-only de cette spec (§8.3).

### Restent ouverts pour Jérôme

8. Destinataire de "paiement effectué" : lecture retenue — le(s) partenaire(s) propriétaire(s) des
   produits commandés, pas le client acheteur. À confirmer.
9. Langue des emails (proposé : espagnol seul, miroir des messages WhatsApp existants).
10. Adresse d'expédition réelle (`NOTIFICATION_EMAIL_FROM`) et nom affiché, une fois le domaine
    choisi par Jérôme.
11. Politique de retry (proposé : 5 tentatives, pas de backoff explicite — le cron espace déjà les
    tentatives de 5 minutes) et fréquence/taille de lot du cron d'envoi (proposé : 5 min / lot de
    20). Seuil de reprise "sending" bloqué (proposé : 10 minutes, §8.4) — à valider.
12. Portée Habeas Data (opt-in/désinscription) : lecture retenue — ces 8 notifications
    transactionnelles 1:1 ne sont pas concernées par la contrainte de désinscription qui vise les
    campagnes groupées (`comm_campaigns`) — à confirmer.
13. Confirmation client (Tranche 2) : langue de rendu du nom de prestation (JSONB multilingue,
    proposé ES) et inclure ou non un lien vers `/orders/[id]/status` plutôt que dupliquer le détail
    complet en HTML.
14. Rétention du journal `notification_emails` (contient PII client/partenaire — email, nom,
    montants) : aucune purge automatique proposée en v1.
15. Route individuelle pour une entrée de réconciliation (`/admin/reconciliation/[id]` ?) — non
    confirmée en explorant le code, le lien de l'email pointe vers la liste `/admin/reconciliation`
    en attendant.
16. Gap `verify_jwt`/Edge Functions signalé en §8.6 (pré-existant, pas introduit par cette spec) :
    faut-il une section `[functions.*]` explicite dans `supabase/config.toml` pour tout le projet,
    au-delà du périmètre de cette spec ? Signalé, pas corrigé ici sans accord explicite de Jérôme.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers |
|---|---|
| §0/§7 — `enqueue_notification_email`/`notify_all_admins`/`claim_notification_email_batch` | nouvelle migration `notification_emails` |
| §0/§7 — invitation | `supabase/migrations/20260824030000_partner_invitation_email.sql` (**déjà sur disque**, à compléter — cf. encart §0), `apps/admin/app/admin/invitations/new/NewInvitationForm.tsx` |
| §0/§7 — nouvelle proposition | `supabase/migrations/20260813234500_product_proposals.sql`, `20260815170000_gestion_etablissement.sql` (tables, triggers ajoutés) |
| §0/§7 — proposition traitée | `supabase/migrations/20260818170000_camp_tags_and_room_photos.sql` (dernière définition live de `moderate_product_proposal`), `supabase/migrations/20260819200000_establishment_creation_proposal_photos.sql` (dernière définition live de `moderate_establishment_proposal`) — **pas** les migrations d'origine (20260813240500/20260815170000), obsolètes pour cette RPC précise |
| §0/§7 — exception réconciliation | `supabase/migrations/20260818210000_payment_reconciliation_entries.sql`, `20260814210000_pms_reconciliation_entries.sql` (triggers ajoutés) |
| §0/§7 — dispatch | `supabase/migrations/20260819140000_pms_jobs_cron.sql` (squelette copié), `supabase/functions/pms-poll-bookings/index.ts` (squelette Edge Function copié), nouveau `supabase/functions/send-notification-emails/index.ts` |
| §7 (Tranche 2) — paiement/commission/confirmation client | `supabase/migrations/20260818220000_apply_payment_webhook.sql` (étendue) |
| §7 (Tranche 2) — blocage camp/evento | `supabase/migrations/20260818140000_create_order_ledger_entry.sql` (dernière définition live de `create_order` au moment d'écrire cette spec — à revérifier avant d'implémenter, `create_order` a déjà été redéfinie 14 fois d'après son propre commentaire de tête) |
| §9 — tests | `docs/05-reference-technique.md` §2 (squelette de concurrence copié pour `claim_notification_email_batch`), `tests/pms-integration/` (squelette d'intégration Edge Function copié) |

## 12. Documents liés

- `docs/04-architecture-cible.md` §"Fournisseur d'email" — décision fournisseur dédié + file +
  Edge Function + journal.
- `docs/00-modele-de-donnees.md` — décision "journal d'envoi tracé" (2026-08-12).
- `docs/02-cahier-des-charges-socio.md` §1 (déclencheurs partenaire), §3b (self-service prestataire,
  hors périmètre — point 0), §3d (blocage camp/evento) — les 3 zones exactes vérifiées pendant le
  challenge du 2026-08-24.
- `docs/03-cahier-des-charges-admin.md` §2/§3d (déclencheurs admin, demandes d'ouverture
  prestataire).
- `docs/01-cahier-des-charges-client.md` §3d (blocage camp/evento côté client), §3e/3f — email
  client obligatoire, cycle de vie de la commande.
- `docs/specs/21-connecteur-lobbypms.md` — squelette Vault/`pg_net`/`pg_cron`/Edge Function déjà
  validé et réutilisé ici.
- `docs/specs/19-paiement-mercadopago-acompte-ledger.md` — `apply_payment_webhook`,
  `create_order`/`ledger_entries`, découpage en tranches déjà pratiqué sur ce même chemin de code.
- `docs/specs/06-gestion-etablissement.md`, `docs/specs/15-socio-creation-produit.md` — mécanisme
  de proposition/modération notifié ici.
- `docs/05-reference-technique.md` §2 — squelette de test de concurrence réelle, réutilisé pour
  `claim_notification_email_batch`.
