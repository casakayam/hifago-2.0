---
id: backlog
titre: "Backlog hifago — points ouverts et arbitrages en attente"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-07
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
- **`supabase/seed.sql` ne couvre pas le regroupement d'établissement** (constaté sur base propre le 2026-09-07) — aucun établissement n'a deux couchages vendables, Casa Kayam n'en a qu'un. La règle est protégée par `search_catalog.test.sql` (fixtures propres), mais un e2e de l'accueil ne verrait jamais de carte groupée. À combler avec le lot de la spec 28.
- **Les e2e admin sont TOUS cassés en local : le facteur MFA du seed est refusé par GoTrue** (constaté le 2026-09-07, 36 échecs). `seed.sql` insère un secret TOTP **en clair** dans `auth.mfa_factors` ; GoTrue v2.195.0 (tiré par la CLI montée à 2.117.0) chiffre désormais ces secrets, donc la vérification échoue. Les facteurs créés par le VRAI parcours d'enrôlement, eux, marchent. Même leçon que pour `auth.users` : passer par l'API Admin dans `seed_auth_users.mjs`.
- **La CLI Supabase n'est épinglée nulle part** — `npx supabase` installe la dernière version et peut monter les images Docker sans prévenir, comme le 2026-09-07 (GoTrue v2.195.0). À épingler.
- **Identité anonyme pour l'invité (spec à écrire)** — décidé le 2026-09-07 : session anonyme Supabase au premier geste engageant, pour que l'attribution et le panier d'un invité survivent. ⚠️ Périmètre mesuré : 79 fichiers de migration accordent des droits à `authenticated`, 67 policies, `is_anonymous` nulle part — chaque droit à relire avant, et `handle_new_auth_user` à revoir.
- **Chantier front vitrine** — les six points ouverts du parcours client cible sont groupés dans `docs/01-cahier-des-charges-client.md` §2f (recherche géo différée, plafonds du panier, forme du voucher, dispo PMS en recherche datée, rattachement d'une commande invitée à un compte, source du contact d'un établissement). Une ligne ici, pas six : ils vivent dans la section qu'ils concernent.
- `products.check_in_time`/`check_out_time` fait toujours doublon avec celui de l'établissement — décision de modèle à trancher (lequel fait foi), pas un simple nettoyage.

## Bloquants externes (action Jérôme)
- IP relais `104.207.147.127` (Vultr) toujours pas déclarée côté LobbyPMS (Configuraciones > Acceso Api) — aucun appel réel possible contre le compte Casa Kayam tant que ce n'est pas fait.
- Connexion Git GitHub↔Vercel bloquée : compte `cosmogab` pas admin sur `casakayam/hifago-2.0`, ne peut pas autoriser la GitHub App Vercel — déploiement reste manuel (CLI) tant que ce n'est pas fait.
- `LOBBY_PMS_TOKEN` : révocation différée, décision explicite de Jérôme — déclencheur = fin de la campagne de tests LobbyPMS.
- Secret `service_role` legacy encore affiché en clair par `supabase projects api-keys` sans `--reveal` (3ᵉ occurrence constatée) — rotation à envisager, jamais faite.

## Data/config connue en écart
- `alojamiento-pms-backed-demo` reste `sellable` en préprod alors qu'il est invendable (PMS-backed sans vraie disponibilité).
- `MERCADOPAGO_WEBHOOK_SECRET` toujours manquant → paiement webhook jamais testé en conditions réelles (tunnel ou déploiement requis). Et la signature HMAC des vraies livraisons Checkout Pro échouait en local malgré un secret identique (piège 19, cause non élucidée côté MP) : si ça se reproduit en staging, contacter le support Mercado Pago avant la prod — plus d'accès shell pour rejouer le webhook.

## Dette technique signalée, non corrigée
- Spec 19 Tranche 2 (remboursement Mercado Pago) non commencée ; page de retour paiement dédiée toujours absente (réutilise l'écran checkout).
- Vitrine (`apps/web`) : polices Geist non appliquées (`--font-geist-*` du layout vs `--font-sans`/`--font-mono` consommés par HeroUI).
- La garde de `(cuenta)` redirige vers `/entrar` SANS `?next=` : un layout serveur ne connaît pas le chemin courant, et la « ligne dans `proxy.ts` » annoncée par la spec 27 §5 n'en est pas une (un middleware ne peut pas poser d'en-tête de REQUÊTE sur une réponse construite par `intlMiddleware`). Sans effet tant qu'il n'existe qu'un écran de compte — vrai déclencheur : le lot qui ajoute `/cuenta` et `/cuenta/perfil`.
- Bricoles signalées, non reprises : `createTtlCache` ne purge jamais les entrées expirées (Map non bornée) · `addDaysIso` (`bogotaDates.ts:56`) porte le débordement d'année déjà corrigé ailleurs · `partner-agenda.spec.ts` ne nettoie pas derrière lui et se sabote après plusieurs runs · `pms_category_not_quoted` devrait rejoindre `connector_inactive` dans les motifs non retentables de `LodgingReservationForm.tsx` (laissé intact, une autre session l'éditait) · sonde à un appel LobbyPMS sur `start_date == end_date` jamais vérifiée.
- Specs 17 (§ invariants) et 20 (l.73) portent encore la règle « PII minimale côté socio » (jamais `holder_phone`/`holder_email`), renversée par Jérôme le 2026-08-19 (migration `20260819180000`) — signalée dans les « Écarts connus » du cahier 02, pas encore corrigée dans le texte des deux specs.
- Les quatre cahiers (00-03) portent leurs écarts en en-tête « Écarts connus » plutôt que dans leurs sections : réécrire les sections elles-mêmes est un geste de fond à valider avec Jérôme, section par section (statut de validation à reprendre).

## Dette QA/UI mineure connue
Palette SVAR non harmonisée avec HeroUI · pas de refetch agenda au changement de vue · e2e spec 18 (créneaux horaires) absents · tri/filtre catalogue par tag manquant · Tranche 4 spec 17, Tranche 2 specs 11/12/13 · `waitForLoadState` sur `admin-camp-booking.spec.ts` · `LocalizedTextField` lot 2 établissement · `admin-evento-vitrine.spec.ts` (`#name-es`) · sidebar admin non repliée sous `md` · activer les créneaux jetski réels via `set_product_slot_capacity` · 6 fichiers pgTAP sensibles au volume de données locales accumulées (`audit_log` non scopé) · `admin-reconciliation.spec.ts`/`admin-home-navigation.spec.ts` fragiles en exécution parallèle · échec Vitest non identifié, DEUX fois le 2026-09-07 (1 puis 2 tests), toujours dans un `npm run test` monorepo enchaîné après typecheck+lint, jamais reproduit ensuite en ~15 exécutions — nom jamais capturé, sortie non conservée.

Historique complet de chaque point (comment on y est arrivé) : `docs/journal/<mois>.md`. Une ligne
retirée d'ici = un point refermé — jamais élagué en silence, dire quoi/quand dans le journal.
