---
id: backlog
titre: "Backlog hifago — points ouverts et arbitrages en attente"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-09
resume: >
  Points ouverts, arbitrages en attente et dette connue non traitée du chantier hifago. Remplace
  le "curseur" de CLAUDE.md §12 (supprimé le 2026-09-07, cf. docs/journal/2026-09.md).
mots_cles: [backlog, arbitrage, en-attente, dette, hifago]
repond_a:
  - "Qu'est-ce qui reste ouvert ou bloqué ?"
  - "Quelles décisions attendent Jérôme ?"
---
# Backlog hifago — points ouverts

> **Règles pour l'IA** : 1 ligne par point, jamais de récit — le détail va dans
> `docs/journal/<mois>.md`. En fin de session : AJOUTER une ligne pour tout point nouvellement
> ouvert ; RETIRER une ligne dès qu'un point est refermé (vérifié par commit/code, pas supposé).
> Fichier volontairement court — s'il dépasse ~60 lignes, c'est le signal qu'un groupe entier doit
> partir en spec ou en ticket séparé plutôt que de rester ici.

## Arbitrage Jérôme requis
- **Trou (a)** — rien ne libère un cupo/place quand une commande EXPIRE (jamais payée) ; seul `cancel_order` le fait. Un créneau reste immobilisé pour toujours si personne n'annule explicitement.
- **Trou (b)** — le marquage des catégories qui refusent en 422 Lobby reste MANUEL, volontairement : Lobby ne distingue pas "pas réservable" de "requête mal formée" dans son code d'erreur.
- LobbyPMS spec 21 §10 points 3-5 non tranchés : traslado↔commission hifago, valeur exacte de `orders.status` en cas d'échec PMS post-confirmation, chiffrement du token.
- **Modification partielle d'une réservation depuis le compte client** — cible future, retirée du premier périmètre le 2026-09-07 (renverse la décision du 2026-08-13, cahier 01 §2c) ; `modify_order_line` reste utilisée côté socio/admin.
- **Panier en base (spec à écrire, APRÈS l'identité anonyme)** — décidé le 2026-09-07 : le panier vit en base sur l'identité du visiteur, plus dans le navigateur. Le modèle de la ligne est à concevoir : l'actuel ne porte ni type, ni slug, ni établissement, ni photo — le type manquant rend le réordonnancement des sections de l'accueil inécrivable (audit spec 28).
- 🔴 **SUITE E2E MISE EN PAUSE le 2026-09-09 (décision Jérôme) — À REMETTRE.** Elle ne tourne plus ni dans `/hifago-test` par défaut ni en CI (qui n'en a jamais eu de job) ; `npm run test:e2e` reste lançable à la main. Réactivation = ce point refermé. État au 2026-09-09 : **19 rouges sur 120** — 17/82 en admin, 2/38 en web (dont `attribution.spec.ts` qui passe SEUL et échoue en suite = pollution, et `reserve-lodging-pms-availability.spec.ts` rouge même isolé, **volontairement non réparée**). Les 17 admin sont de VRAIS défauts (mesuré le 2026-09-08 : 16 des 18 échouaient aussi en `--workers=1`, donc ni parallélisme ni pollution). Natures : 4 navigations qui n'aboutissent pas (`toHaveURL`), 5 éléments absents, 4 timeouts, 3 textes faux — chacun demande son diagnostic, c'est un chantier à part. ⚠️ Ce qui est RÉGLÉ et ne doit pas être re-diagnostiqué : l'authentification (plus aucun échec ; c'était un deadlock, pas le chiffrement des secrets — voir le journal), l'accumulation de résidus entre exécutions (`globalTeardown`), et le panneau `ServerFilters` cliqué avant hydratation après un rechargement GET (helper `abrirFiltros`, 8 specs).
- **La CLI Supabase n'est épinglée nulle part** — `npx supabase` installe la dernière version et peut monter les images Docker sans prévenir, comme le 2026-09-07 (GoTrue v2.195.0). À épingler.
- **Identité anonyme — Tranches 1+2 LIVRÉES le 2026-09-10** (`docs/specs/31-identite-anonyme.md`) : session anonyme au premier ajout au panier, garde `not_authenticated` sur `create_order`, invariant 3 (attribution jamais persistée sur une identité anonyme), `orders.account_id`/`order_lines.account_id` NOT NULL (compte technique `reserva-manual@hifago.local`, backfill prouvé, seed à jour). Restent : Tranche 3 (liste blanche étendue aux ~80 autres RPC — une seule porte la garde aujourd'hui), Tranche 4 (purge à 30j, panier exclu du critère).
- **`client_key_for_order` perd 2 de ses 3 branches en usage réel** (mesuré le 2026-09-10, conséquence de `account_id` NOT NULL) — `coalesce(account_id, email, téléphone, order_id)` résout désormais TOUJOURS via `account_id` pour ses deux seuls appelants (`list_clients`, `list_client_orders`) : les replis email/téléphone/order_id sont inatteignables par une vraie ligne `orders`. Pas une régression (l'admin ne tape jamais un email à la main, toujours un client_key déjà résolu) — juste un fait à ne pas re-découvrir en confusion. Fonction non modifiée, hors périmètre de la Tranche 2 ; sa couverture vit désormais dans `list_client_orders_rpc.test.sql` en appelant la fonction pure directement.
- **Chantier front vitrine** — les points ouverts du parcours client cible sont groupés dans `docs/01-cahier-des-charges-client.md` §2f (recherche géo différée, plafonds du panier, forme du voucher, dispo PMS en recherche datée, rattachement d'une commande invitée à un compte). ⚠️ « Source du contact d'un établissement » en est RETIRÉ : tranché le 2026-09-08 (colonne `establishments.contact_phone`, spec 30 §3.2) — `partners.phone` était le mauvais candidat, 0/36 rempli.

- **La liste blanche des sessions anonymes n'est appliquée qu'à UNE RPC sur 81** (2026-09-09) — le socle `is_anonymous_session()` existe et `consume_partner_invitation` est refermée, mais rien ne vérifie mécaniquement qu'une nouvelle RPC porte la garde, et les 5 autres fonctions à garde `auth.uid()` seule n'ont pas été revues (dont `set_my_payout_account`, neutralisée en pratique par la fermeture de `consume_partner_invitation` mais non corrigée). « Refus par défaut » reste un souhait au sens du §11.20 tant qu'un contrôle ne le vérifie pas.
- **Oracles de lecture non reproduits, à instruire** — `has_capability`/`is_admin`/`has_admin_capability`/`partner_id_for_account` prennent un uuid en PARAMÈTRE (jamais `auth.uid()`) et sont SECURITY DEFINER : un appelant sans session teste l'identité d'autrui, 1 bit par uuid connu. Plus `establishment_slug_from_name` (énumération de slugs que la RLS masque). Signalés par l'audit du 2026-09-09, PAS vérifiés à la main.

## Bloquants externes (action Jérôme)
- IP relais `104.207.147.127` (Vultr) toujours pas déclarée côté LobbyPMS (Configuraciones > Acceso Api) — aucun appel réel possible contre le compte Casa Kayam tant que ce n'est pas fait.
- Connexion Git GitHub↔Vercel bloquée : compte `cosmogab` pas admin sur `casakayam/hifago-2.0`, ne peut pas autoriser la GitHub App Vercel — déploiement reste manuel (CLI) tant que ce n'est pas fait.
- `LOBBY_PMS_TOKEN` : révocation différée, décision explicite de Jérôme — déclencheur = fin de la campagne de tests LobbyPMS.
- Secret `service_role` legacy encore affiché en clair par `supabase projects api-keys` sans `--reveal` (3ᵉ occurrence constatée) — rotation à envisager, jamais faite.

## Data/config connue en écart
- `alojamiento-pms-backed-demo` reste `sellable` en préprod alors qu'il est invendable (PMS-backed sans vraie disponibilité).
- `MERCADOPAGO_WEBHOOK_SECRET` toujours manquant → paiement webhook jamais testé en conditions réelles (tunnel ou déploiement requis). Et la signature HMAC des vraies livraisons Checkout Pro échouait en local malgré un secret identique (piège 19, cause non élucidée côté MP) : si ça se reproduit en staging, contacter le support Mercado Pago avant la prod — plus d'accès shell pour rejouer le webhook.

## Dette connue, assumée, non corrigée
Sortie d'ici le 2026-09-08 vers `docs/dette-technique.md` — ce fichier plafonne à 60 lignes et prescrit qu'un groupe entier parte quand il déborde. ⚠️ Rien n'y a été élagué : les deux groupes (dette technique, dette QA/UI mineure) y sont au complet. Un point qui s'y trouve est CONNU — ne pas le re-diagnostiquer.

Historique complet de chaque point (comment on y est arrivé) : `docs/journal/<mois>.md`. Une ligne
retirée d'ici = un point refermé — jamais élagué en silence, dire quoi/quand dans le journal.
