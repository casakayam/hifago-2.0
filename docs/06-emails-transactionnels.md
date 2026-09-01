---
id: refonte-emails-transactionnels
titre: "Emails transactionnels — les 8 envois possibles, leur déclencheur et leur destinataire"
theme: cadrage
statut: "vérifié en envoi RÉEL le 2026-08-31 — les 8 emails sont partis chez Resend depuis la stack locale et reçus en boîte ; secrets Resend posés en préprod, aucun envoi réel en préprod à ce jour"
maj: 2026-08-31
resume: >
  Table de référence des 8 seuls emails que hifago peut envoyer (liste fermée par la contrainte
  check sur notification_emails.event_type) : ce qui les déclenche, à qui ils partent, leur objet
  et leur corps exacts. Décrit le comportement réel du code, pas une cible.
mots_cles: [email, notification, resend, destinataire, declencheur, notification_emails, spec 23]
repond_a:
  - "Quels emails hifago peut-il envoyer, et à qui ?"
  - "Qu'est-ce qui déclenche tel email, et que contient-il exactement ?"
  - "Quel email part au client, lequel part au socio, lequel part à l'admin ?"
---

# Emails transactionnels — les 8 envois possibles

> Liste **fermée** : la contrainte `check` sur `notification_emails.event_type`
> (`supabase/migrations/20260824020000_notification_emails.sql`) n'autorise que ces 8 valeurs.
> Aucun autre email ne peut sortir de hifago. Spécification d'origine :
> `docs/specs/23-notifications-email-transactionnelles.md`.
>
> Ce document décrit **ce que le code fait**, relevé sur les définitions live. En cas de
> divergence, le code fait foi.

## Tableau de référence

| # | `event_type` | Action qui le déclenche | Part à qui | Objet (ES) |
|---|---|---|---|---|
| 1 | `partner_invitation` | Un admin crée une invitation **et** remplit le champ « Correo (opcional) » | L'adresse saisie par l'admin | `Invitación a unirte a Hifago` |
| 2 | `admin_new_proposal` | Un socio soumet une proposition de produit ou d'établissement | **Tous les admins actifs**, un email chacun | `Nueva propuesta de producto pendiente de moderación` / `…de establecimiento…` |
| 3 | `admin_new_reconciliation_exception` | Une exception de réconciliation est créée (PMS ou paiement) | **Tous les admins actifs**, un email chacun | `Nueva excepción de reconciliación PMS` / `…de pago` |
| 4 | `partner_proposal_decided` | Un admin approuve ou rejette une proposition | Le compte socio qui l'a soumise | `Tu propuesta fue aprobada` / `Tu propuesta fue rechazada` |
| 5 | `partner_commission_earned` | Le paiement d'une commande est confirmé | Chaque **compte référent distinct** ayant une ligne en `commission_case = 'external_referrer'` | `Nueva comisión asignada` |
| 6 | `partner_payment_confirmed` | Le paiement d'une commande est confirmé | Chaque **compte propriétaire distinct** des produits commandés | `Pago confirmado` |
| 7 | `client_order_confirmed` | Le paiement d'une commande est confirmé | Le client, sur `orders.holder_email` — un seul email par commande | `Reserva confirmada` |
| 8 | `partner_camp_evento_blocked` | Une commande contenant une ligne `camp` est créée — **à la réservation, avant le paiement** | Chaque compte du partenaire propriétaire du camp/evento | `Reserva confirmada — recurso bloqueado` |

Les emails 5, 6 et 7 partent tous les trois du **même événement** : `apply_payment_webhook` en
branche `approved`. Un paiement confirmé peut donc générer plusieurs emails d'un coup.

## Où c'est branché

| # | Fonction / trigger | Fichier |
|---|---|---|
| 1 | `create_partner_invitation` | `supabase/migrations/20260826100000_create_partner_invitation_reject_duplicate_code.sql` |
| 2 | trigger `notify_admin_new_proposal` sur `product_proposals` + `establishment_proposals` | `supabase/migrations/20260824090000_fix_notify_admin_new_proposal_null_join.sql` |
| 3 | trigger `notify_admin_new_reconciliation_exception` sur `pms_reconciliation_entries` + `payment_reconciliation_entries` | `supabase/migrations/20260824060000_notify_admin_reconciliation_exception.sql` |
| 4 | `moderate_product_proposal` + `moderate_establishment_proposal` | `supabase/migrations/20260824070000_notify_partner_proposal_decided.sql` |
| 5 | `apply_payment_webhook` | `supabase/migrations/20260824120000_notify_payment_confirmed.sql` |
| 6 | `apply_payment_webhook` | idem |
| 7 | `apply_payment_webhook` | idem |
| 8 | `create_order`, branche `camp` | `supabase/migrations/20260824110000_notify_partner_camp_evento_blocked.sql` |

Tous passent par `enqueue_notification_email` (ou `notify_all_admins` pour les deux emails admin),
qui empile dans `notification_emails`. L'envoi physique est fait plus tard par l'Edge Function
`send-notification-emails`, appelée toutes les 5 minutes par pg_cron.

## Contenu exact de chaque email

**1 · `partner_invitation`**
« Has recibido una invitación para unirte a Hifago. » + lien *Aceptar invitación* (URL **absolue**,
construite depuis le secret Vault `admin_app_public_url`) + « Este enlace es de un solo uso y expira
pronto. »

**2 · `admin_new_proposal`**
Nom de l'entité proposée (ou « Sin nombre ») + « Propuesto por: <socio> » (ou « Socio desconocido »)
+ lien *Ver propuesta* vers `/admin/proposals/<id>`.

**3 · `admin_new_reconciliation_exception`**
Libellé de l'entrée : nom du produit pour une exception PMS, « Pedido de <nom> » pour une exception
de paiement, ou « Pedido no identificado » si le webhook n'a jamais pu être corrélé à un paiement
connu + lien *Ver reconciliaciones pendientes* vers `/admin/reconciliation`.

**4 · `partner_proposal_decided`**
« Tu propuesta para "<nom>" fue aprobada. » — ou, en cas de rejet, « …fue rechazada. » suivi de
« Motivo: <raison saisie par l'admin> ». Aucun lien.

**5 · `partner_commission_earned`**
« Se te asignó una comisión por una reserva confirmada. » Rien d'autre : ni montant, ni nom de
produit, ni lien.

**6 · `partner_payment_confirmed`**
« Se confirmó el pago de una reserva en tu establecimiento. » Rien d'autre non plus.

**7 · `client_order_confirmed`**
« Hola <prénom>, tu reserva fue confirmada: » suivi d'une liste, une ligne par prestation :
nom du produit en espagnol — date (— date de fin si séjour) — montant en COP. Le seul des huit qui
détaille vraiment quelque chose. Pas de lien vers `/orders/[id]/status`.

**8 · `partner_camp_evento_blocked`**
« Se reservó "<produit>". » + « Período bloqueado: <du> a <au>. » + « Otras actividades que comparten
este recurso pueden haber quedado no disponibles durante ese período. »

## Faiblesses connues de ces contenus

Relevées à la lecture du code, puis **confirmées en boîte** par l'envoi réel du 2026-08-31.
Aucune n'est corrigée — à traiter avant d'ouvrir l'envoi à de vrais partenaires et clients.

- **Emails 2 et 3 : les liens sont relatifs** (`href="/admin/proposals/…"`, `href="/admin/reconciliation"`).
  Un lien relatif n'a aucune base dans une boîte mail : il est inutilisable. Seul l'email 1
  construit une URL absolue, via `admin_app_public_url`.
- **Emails 5 et 6 : aucun contenu utile.** Ce sont les deux emails qui parlent d'argent à un socio,
  et ils ne portent ni montant, ni nom de produit, ni date, ni lien. Le destinataire ne peut rien
  en faire.
- **Aucun échappement HTML.** Les noms de produit et d'établissement viennent d'un payload saisi
  par un socio et sont concaténés bruts dans le corps (emails 2, 4, 7, 8). Une injection de lien
  dans un email lu par l'admin est possible.
- **Tout est en espagnol**, y compris les deux emails destinés aux admins. La langue était listée
  « à trancher » en §10.9 de la spec 23 ; elle a été tranchée de fait dans le code, jamais reportée
  dans la spec.
- **`create_manual_order_line` (réservation au comptoir) n'envoie rien** — pas même l'email 8 quand
  la ligne bloque un camp/evento. Comportement non spécifié, à trancher.

## État d'exécution

**Les 8 emails ont été envoyés et reçus pour de vrai le 2026-08-31**, depuis la stack Supabase
locale vers Resend, chacun déclenché par son vrai chemin d'appel. C'est la première fois que ces
messages sont lus par un humain. Le harnais qui le prouve est
`tests/notification-real/send_8_real_emails.mjs` (`npm run test:notification-real`, protégé par
`HIFAGO_REAL_EMAIL_SEND=1` et `--yes`, jamais en CI) : il fabrique ses fixtures, déclenche les 8
événements, dispatche une ligne à la fois et exige un `provider_message_id` Resend réel pour
chacune.

Ce que ce premier envoi réel a confirmé :

- les 8 enqueue sont présents dans les définitions **live** — aucune redéfinition ultérieure de
  `create_order` ou `apply_payment_webhook` ne les a perdus ;
- une seule commande à une seule ligne `external_referrer` produit bien **trois** emails (5, 6 et 7) ;
- l'email 8 part à la réservation, avant tout paiement, comme spécifié ;
- les corps sont rendus correctement en espagnol, accents compris.

Côté préprod, en revanche : les secrets `RESEND_API_KEY` et `NOTIFICATION_EMAIL_FROM` sont posés
depuis le 2026-08-31, mais **aucun envoi réel n'y a encore été observé**. Les 9 lignes empilées
avant que les secrets soient posés y sont toutes en `abandoned` — état terminal, elles ne
repartiront pas.
