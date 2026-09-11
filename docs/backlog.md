---
id: backlog
titre: "Backlog hifago — points ouverts et arbitrages en attente"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-11
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
- **Panier en base — spec 32 ENTIÈREMENT LIVRÉE le 2026-09-10** (`docs/specs/32-panier-en-base.md`, 4 tranches) : tables `carts`/`cart_items` + RLS, `create_order` réécrit (lignes/attribution côté serveur, plafonds 12/36/40 corrigés), écran `/carrito` + `CartSummary` (nouvel organism, édition/lecture seule), `CartContext.tsx`/`CheckoutForm.tsx` simplifiés. Concurrence réelle et suite pgTAP complète vertes ; **parcours réel vérifié en navigateur** (Playwright headless, produit du seed → panier → paiement → « Pedido confirmado », `orders`/`order_lines` créées, `cart_items` vidée — données de test nettoyées après coup). 2 régressions mineures signalées dans le journal (panier non restauré après un refus PMS ; `CartSummary` figée après succès sur `/pago`, cosmétique) — pas corrigées, hors périmètre de cette tranche. 2 points ouverts restants (spec §10) : interaction avec `partner_accounts.saved_attribution_code`, mécanisme de revérification de dispo à la reprise du panier (`products.sellable` seul aujourd'hui, minimal).
- 🔴 **SUITE E2E MISE EN PAUSE le 2026-09-09 (décision Jérôme) — À REMETTRE.** Elle ne tourne plus ni dans `/hifago-test` par défaut ni en CI (qui n'en a jamais eu de job) ; `npm run test:e2e` reste lançable à la main. Réactivation = ce point refermé. État au 2026-09-09 : **19 rouges sur 120** — 17/82 en admin, 2/38 en web (dont `attribution.spec.ts` qui passe SEUL et échoue en suite = pollution, et `reserve-lodging-pms-availability.spec.ts` rouge même isolé, **volontairement non réparée**). Les 17 admin sont de VRAIS défauts (mesuré le 2026-09-08 : 16 des 18 échouaient aussi en `--workers=1`, donc ni parallélisme ni pollution). Natures : 4 navigations qui n'aboutissent pas (`toHaveURL`), 5 éléments absents, 4 timeouts, 3 textes faux — chacun demande son diagnostic, c'est un chantier à part. ⚠️ Ce qui est RÉGLÉ et ne doit pas être re-diagnostiqué : l'authentification (plus aucun échec ; c'était un deadlock, pas le chiffrement des secrets — voir le journal), l'accumulation de résidus entre exécutions (`globalTeardown`), et le panneau `ServerFilters` cliqué avant hydratation après un rechargement GET (helper `abrirFiltros`, 8 specs).
- **La CLI Supabase n'est épinglée nulle part** — `npx supabase` installe la dernière version et peut monter les images Docker sans prévenir, comme le 2026-09-07 (GoTrue v2.195.0). À épingler.
- **Identité anonyme — spec 31 ENTIÈREMENT LIVRÉE le 2026-09-10** (4 tranches, `docs/specs/31-identite-anonyme.md`) : session anonyme au 1er ajout panier, `account_id` NOT NULL, refus par défaut mécanique, job de purge à 30j (identité par identité, jamais un lot qui avorte sur une FK bloquante). ⚠️ **Point de vérification laissé ouvert par la Tranche 4** : `DELETE FROM auth.users` en SQL pur (pg_cron) n'a jamais été testé sur Supabase Cloud — seul l'`INSERT` est confirmé refusé (2026-08-21). À vérifier en priorité dès qu'un projet préprod existe, avant de faire confiance au job en production.
- **`client_key_for_order` perd 2 de ses 3 branches en usage réel** (mesuré le 2026-09-10, conséquence de `account_id` NOT NULL) — `coalesce(account_id, email, téléphone, order_id)` résout désormais TOUJOURS via `account_id` pour ses deux seuls appelants (`list_clients`, `list_client_orders`) : les replis email/téléphone/order_id sont inatteignables par une vraie ligne `orders`. Pas une régression (l'admin ne tape jamais un email à la main, toujours un client_key déjà résolu) — juste un fait à ne pas re-découvrir en confusion. Fonction non modifiée, hors périmètre de la Tranche 2 ; sa couverture vit désormais dans `list_client_orders_rpc.test.sql` en appelant la fonction pure directement.
- **Chantier front vitrine** — les points ouverts du parcours client cible sont groupés dans `docs/01-cahier-des-charges-client.md` §2f (recherche géo différée, forme du voucher, dispo PMS en recherche datée). ⚠️ « Rattachement d'une commande invitée à un compte » en est RETIRÉ : livré le 2026-09-10 par la spec 33 (`attach_orders_to_account`, appelée depuis `/auth/callback` après vérification de l'email — ne rattache que des commandes encore détenues par une identité anonyme). ⚠️ « Source du contact d'un établissement » en est RETIRÉ : tranché le 2026-09-08 (colonne `establishments.contact_phone`, spec 30 §3.2) — `partners.phone` était le mauvais candidat, 0/36 rempli. « Plafonds du panier » en est RETIRÉ aussi (trouvé périmé le 2026-09-10 en préparant spec 32) : §3e du même cahier l'avait déjà tranché le 2026-09-07 (plafond global, valeurs 12/36/40/20) — §2f n'avait jamais été mis à jour le même jour. Le vrai point ouvert n'est pas la forme du plafond mais sa valeur, jamais codée (cf. spec 32 §10). ⚠️ **« Entrée Google sur la vitrine » REFERMÉ le 2026-09-11** (`components/molecules/GoogleButton.tsx`, monté sur `/entrar` et `/registro`) : le back-end existait depuis le 2026-08-15 (spec 07, « écrans côté apps/admin seulement ce lot »), seul l'écran manquait — et le point ne figurait dans AUCUNE ligne d'ici, ce qui est le défaut réel. **Reste le dernier écart d'authentification du cahier §2c : mot de passe oublié / réinitialisation**, absent d'`apps/web`, présent sur `apps/admin`.

- **Oracles de lecture — exploit reproduit le 2026-09-10** (plus seulement signalé) — `has_capability`/`is_admin`/`has_admin_capability`/`partner_id_for_account` prennent un uuid en PARAMÈTRE (jamais `auth.uid()`), SECURITY DEFINER, `EXECUTE` accordé à `anon` ET `authenticated` (vérifié en local, `has_function_privilege`) : `select is_admin('<uuid admin réel>')` sous rôle `anon` répond `true`, reproduit en transaction annulée. Plus `establishment_slug_from_name` (énumération de slugs que la RLS masque), grant identique, comportement pas encore testé. **Correctif en attente d'arbitrage Jérôme (CLAUDE.md §10)** — piste proposée : `revoke` EXECUTE de `anon` sur les 5 (une identité anonyme n'a structurellement rien à vérifier), garder `authenticated` tant que l'usage réel dans les policies RLS n'est pas audité.

- **Spec 33 « écran de résultat et fermeture du tunnel » ENTIÈREMENT LIVRÉE le 2026-09-10** (`docs/specs/33-resultat-paiement-et-fermeture-du-tunnel.md`, 4 tranches) : adresse `/reserva/<jeton>` (`orders.reference` dictable + `orders.access_token` 128 bits), RPC `get_order_by_token` et `attach_orders_to_account`, `back_urls` corrigées (elles ramenaient sur une PAGE VIDE depuis la spec 32) et sans préfixe de locale, moyens de paiement hors ligne exclus de Checkout Pro, email de confirmation portant numéro et lien, « Iniciar sesión » restauré (il disparaissait du site entier dès le 1er ajout au panier depuis la spec 31). 43 tests pgTAP neufs, 11 tests unitaires dont 6 vérifiés par mutation, 5 e2e sur le vrai retour de paiement — que l'ancien mock ne traversait jamais. 1 point reporté : panier non restauré après un refus PMS (décision ④, hors périmètre).

## Bloquants externes (action Jérôme)
- IP relais `104.207.147.127` (Vultr) toujours pas déclarée côté LobbyPMS (Configuraciones > Acceso Api) — aucun appel réel possible contre le compte Casa Kayam tant que ce n'est pas fait.
- Connexion Git GitHub↔Vercel bloquée : compte `cosmogab` pas admin sur `casakayam/hifago-2.0`, ne peut pas autoriser la GitHub App Vercel — déploiement reste manuel (CLI) tant que ce n'est pas fait.
- `LOBBY_PMS_TOKEN` : révocation différée, décision explicite de Jérôme — déclencheur = fin de la campagne de tests LobbyPMS.
- Secret `service_role` legacy encore affiché en clair par `supabase projects api-keys` sans `--reveal` (3ᵉ occurrence constatée) — rotation à envisager, jamais faite.

## Data/config connue en écart
- `alojamiento-pms-backed-demo` reste `sellable` en préprod alors qu'il est invendable (PMS-backed sans vraie disponibilité).
- `caminata-mirador-penon` (produit utilisé par les précédents smoke tests manuels) n'a plus aucune date ouverte sur 3 mois glissants, vérifié le 2026-09-10 — utiliser un autre produit du seed (`kayak-embalse-guatape` a une date ouverte le 2026-10-05) pour tout nouveau test manuel du parcours panier.
- `MERCADOPAGO_WEBHOOK_SECRET` toujours manquant → paiement webhook jamais testé en conditions réelles (tunnel ou déploiement requis). Et la signature HMAC des vraies livraisons Checkout Pro échouait en local malgré un secret identique (piège 19, cause non élucidée côté MP) : si ça se reproduit en staging, contacter le support Mercado Pago avant la prod — plus d'accès shell pour rejouer le webhook.

## Dette connue, assumée, non corrigée
Sortie d'ici le 2026-09-08 vers `docs/dette-technique.md` — ce fichier plafonne à 60 lignes et prescrit qu'un groupe entier parte quand il déborde. ⚠️ Rien n'y a été élagué : les deux groupes (dette technique, dette QA/UI mineure) y sont au complet. Un point qui s'y trouve est CONNU — ne pas le re-diagnostiquer.

Historique complet de chaque point (comment on y est arrivé) : `docs/journal/<mois>.md`. Une ligne
retirée d'ici = un point refermé — jamais élagué en silence, dire quoi/quand dans le journal.
