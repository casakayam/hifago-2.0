---
id: backlog
titre: "Backlog hifago — points ouverts et arbitrages en attente"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-16
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
- **Modification partielle d'une réservation depuis le compte client** — cible future, retirée du premier périmètre le 2026-09-07 ; `modify_order_line` reste utilisée côté socio/admin. ⚠️ **Sa moitié « annulation » a été TRANCHÉE le 2026-09-11** (spec 34 décision ⑤, Jérôme) : annuler porte désormais sur UNE prestation, `cancel_order` est supprimée, le cahier §2c est révisé. Reste ouvert ici : changer une date ou une quantité sans annuler.
- **Spec 32 (panier en base) livrée le 2026-09-10** — restent ouverts (§10) : interaction avec `partner_accounts.saved_attribution_code` ; revérification de dispo à la reprise du panier (`products.sellable` seul aujourd'hui) ; valeur des plafonds jamais codée. ⚠️ Deux régressions mineures non corrigées : panier non restauré après un refus PMS (`create_order` vide `cart_items` dans sa propre transaction, `release_order_after_pms_refusal` ne les recrée pas — ce n'est pas son rôle) ; `CartSummary` figée après succès sur `/pago`, cosmétique.
- 🔴 **Suite E2E en pause depuis le 2026-09-09 (décision Jérôme) — à remettre.** État, rouges déjà diagnostiqués, ruptures accumulées pendant la pause et ordre de reprise : `docs/specs/38-remise-en-route-suite-e2e.md`. Réactivation = ce point refermé.
- **La CLI Supabase n'est épinglée nulle part** — `npx supabase` installe la dernière version et peut monter les images Docker sans prévenir, comme le 2026-09-07 (GoTrue v2.195.0). À épingler.
- **Spec 31 (identité anonyme) livrée le 2026-09-10** — point de vérification laissé ouvert par la Tranche 4 : `DELETE FROM auth.users` en SQL pur (pg_cron) n'a JAMAIS été testé sur Supabase Cloud, seul l'`INSERT` est confirmé refusé (2026-08-21). À vérifier en priorité dès qu'un projet préprod existe, avant de faire confiance au job de purge en production.
- **`client_key_for_order` perd 2 de ses 3 branches en usage réel** (mesuré le 2026-09-10, conséquence de `account_id` NOT NULL) — `coalesce(account_id, email, téléphone, order_id)` résout désormais TOUJOURS via `account_id` pour ses deux seuls appelants (`list_clients`, `list_client_orders`) : les replis email/téléphone/order_id sont inatteignables par une vraie ligne `orders`. Pas une régression (l'admin ne tape jamais un email à la main, toujours un client_key déjà résolu) — juste un fait à ne pas re-découvrir en confusion. Fonction non modifiée, hors périmètre de la Tranche 2 ; sa couverture vit désormais dans `list_client_orders_rpc.test.sql` en appelant la fonction pure directement.
- **Chantier front vitrine** — les points ouverts du parcours client cible sont groupés dans `docs/01-cahier-des-charges-client.md` §2f : recherche géo différée, forme du voucher, et dispo PMS en recherche datée (cette dernière adressée par le miroir Lobby, voir la ligne « Sens Lobby → hifago » ci-dessous).
- **Oracles de lecture — exploit reproduit le 2026-09-10** (plus seulement signalé) — `has_capability`/`is_admin`/`has_admin_capability`/`partner_id_for_account` prennent un uuid en PARAMÈTRE (jamais `auth.uid()`), SECURITY DEFINER, `EXECUTE` accordé à `anon` ET `authenticated` (vérifié en local, `has_function_privilege`) : `select is_admin('<uuid admin réel>')` sous rôle `anon` répond `true`, reproduit en transaction annulée. Plus `establishment_slug_from_name` (énumération de slugs que la RLS masque), grant identique, comportement pas encore testé. **Correctif en attente d'arbitrage Jérôme (CLAUDE.md §10)** — piste proposée : `revoke` EXECUTE de `anon` sur les 5 (une identité anonyme n'a structurellement rien à vérifier), garder `authenticated` tant que l'usage réel dans les policies RLS n'est pas audité.
- **Incohérence possible entre `delete_my_account()` et l'API Admin** (spec 35, 2026-09-11) : si la RPC réussit mais que le changement d'email/mot de passe échoue ensuite (panne réseau entre les deux appels du Route Handler), le profil est anonymisé mais le compte reste connectable avec l'ancien email — accepté tel quel pour ce lot (le compte reste fonctionnel, juste pas encore anonymisé ; le client peut retenter). Pas de rattrapage automatique posé.
- **Fermer la fuite des colonnes de commission — le remède habituel ne marche pas** (mesuré le 2026-09-11) : `order_lines_select` autorise `account_id = auth.uid()` sur TOUTES les colonnes, donc un client lit `app_commission_cop` via PostgREST avec son propre jeton. ⚠️ Un `grant select (colonnes)` ne peut PAS la refermer — un grant de colonne s'attache au RÔLE, et admin, socio, référent et client sont tous `authenticated` : la liste devrait inclure les colonnes de commission pour ne pas casser sept lectures d'`apps/admin`. Seule fermeture réelle : `revoke select on order_lines from authenticated` + conversion de ces sept lectures en RPC (précédents : `list_clients`, `list_client_orders`). La spec 34 y contribue en retirant les deux lectures client du chemin direct.
- **Catégories partout (2026-09-14) — deux choix pris sans confirmation explicite de Jérôme**, à revalider : (1) l'image/texte éditorial d'une catégorie (`catalog_tags.description`/`image_path`, saisis via l'admin) ne s'affiche plus NULLE PART sur l'index (le pattern accueil n'a ni photo ni texte par section) — reste visible seulement sur la page dédiée `/[type]/[categoria]` ; (2) plafond arbitraire de 6 offres par catégorie sur l'index (`POR_CATEGORIA`, `IndiceCategoriasConOfertas.tsx`), aucune valeur donnée dans la demande.
- **`config push` casse EN BLOC pour 2 champs Auth/Storage** (2026-09-14, cf. journal) : templates email (confirmation/recovery, espagnol) → 400 tant que Resend n'est pas branché en SMTP custom sur Auth (`CLAUDE.md` §9 ne tranche que le transactionnel applicatif) ; `storage.vector.enabled` → 402, plan payant requis. Exclus à la main du push du 2026-09-14 — sans cette exclusion, tout futur `config push` échoue entièrement, même pour un champ sans rapport (ex. `enable_anonymous_sign_ins`).
- **Palette vitrine — 6 pistes candidates, aucune tranchée** (`packages/ui/src/styles/globals.css`, story `Playground/Palette`) : `hifago` (marque legacy /guatape), `embalse`, `zocalo`, `cal`, `chiva`, et depuis le 2026-09-14 `penol` (nouveau logo hifaGO envoyé par Jérôme — 2ᵉ référence de marque, couleurs estimées à l'œil, à recaler si un fichier source arrive).
- **Équipements structurés livrés le 2026-09-17** (`catalog_amenities`, ~56 items) : contenu final du référentiel et migration manuelle des 8 items `stay_rates.includes` de Bania restent à trancher — détail dans le journal du jour.
- **Miroir de disponibilité LobbyPMS — back-end + invalidation événementielle LIVRÉS, EN ATTENTE DE VALIDATION JÉRÔME sur le principe** (copie en base, spec 24 §0 ; historique complet 2026-09-17/18 : `docs/journal/2026-09.md`) : `search_catalog`/la fiche/`reserve-nights` tiennent (repli par établissement ET par plage depuis le 2026-09-18) ; `reserve-nights`/`pms-cancel-bookings`/`pms-poll-bookings` invalident désormais le mois concerné au lieu d'attendre jusqu'à 24 h ; `fail_pms_sync` a un vrai backoff exponentiel. TESTLIVE contre le compte réel toujours en attente de l'accord de Gabriel au moment de le faire. ⚠️ Sens Lobby → hifago : ÉCARTÉ le 2026-09-17, ne pas rouvrir. Restent ouverts, non traités : mesurer si le seau de quota Lobby est par jeton ou par IP (accord Gabriel requis, §8.3) ; regrouper 3 mois par appel Lobby (≈93 nuits/page) si la mesure le justifie ; `pms-poll-bookings` sans intervalle de dû (relit chaque booking vivant toutes les 15 min) ; aucun signalement admin d'un connecteur en échec répété (`attempts`/`last_error` existent en base, rien ne les affiche).

## Bloquants externes (action Jérôme)
- IP relais `104.207.147.127` (Vultr) toujours pas déclarée côté LobbyPMS (Configuraciones > Acceso Api) — aucun appel réel possible contre le compte Casa Kayam tant que ce n'est pas fait.
- Connexion Git GitHub↔Vercel bloquée : compte `cosmogab` pas admin sur `casakayam/hifago-2.0`, ne peut pas autoriser la GitHub App Vercel — déploiement reste manuel (CLI) tant que ce n'est pas fait.
- `LOBBY_PMS_TOKEN` : révocation différée, décision explicite de Jérôme — déclencheur = fin de la campagne de tests LobbyPMS.
- Secret `service_role` legacy encore affiché en clair par `supabase projects api-keys` sans `--reveal` (3ᵉ occurrence constatée) — rotation à envisager, jamais faite.

## Data/config connue en écart
- `alojamiento-pms-backed-demo` reste `sellable` en préprod alors qu'il est invendable (PMS-backed sans vraie disponibilité).
- `caminata-mirador-penon` (produit utilisé par les précédents smoke tests manuels) n'a plus aucune date ouverte sur 3 mois glissants, vérifié le 2026-09-10 — utiliser un autre produit du seed (`kayak-embalse-guatape` a une date ouverte le 2026-10-05) pour tout nouveau test manuel du parcours panier.
- **Les 7 transports déjà en base n'ont PAS d'horaires** malgré l'enrichissement d'`aeroturex-bus-compartido.json` (2026-09-16) : `seed-mock-data.mjs` est create-only et ignore un produit existant. Leurs deux LIEUX, eux, sont bien arrivés (migration de données de `20260916150000`). Un `update` manuel ou un `db reset` est nécessaire pour voir la fenêtre de départs sur un environnement déjà seedé — le lot n'est pas cassé.
- `MERCADOPAGO_WEBHOOK_SECRET` toujours manquant → paiement webhook jamais testé en conditions réelles (tunnel ou déploiement requis). Et la signature HMAC des vraies livraisons Checkout Pro échouait en local malgré un secret identique (piège 19, cause non élucidée côté MP) : si ça se reproduit en staging, contacter le support Mercado Pago avant la prod — plus d'accès shell pour rejouer le webhook. ⚠️ Point NON résolu par `MERCADOPAGO_MOCK_MODE` (2026-09-14, journal) : ce flag contourne le trou pour le dev quotidien local, ne le teste pas.

## Dette connue, assumée, non corrigée
Sortie d'ici le 2026-09-08 vers `docs/dette-technique.md` — ce fichier plafonne à 60 lignes et prescrit qu'un groupe entier parte quand il déborde. ⚠️ Rien n'y a été élagué : les deux groupes (dette technique, dette QA/UI mineure) y sont au complet. Un point qui s'y trouve est CONNU — ne pas le re-diagnostiquer.

Historique complet de chaque point (comment on y est arrivé) : `docs/journal/<mois>.md`. Une ligne
retirée d'ici = un point refermé — jamais élagué en silence, dire quoi/quand dans le journal.
