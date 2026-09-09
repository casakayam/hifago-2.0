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
- **Identité anonyme pour l'invité (entretien ouvert le 2026-09-09)** — deux points tranchés : la session se crée au PREMIER AJOUT AU PANIER seul (révise le 2026-09-07, qui incluait l'arrivée `?ref=` — le trigger `on_auth_user_created` en aurait fait un compte fantôme par scan de QR), et le code référent vit sur le PANIER en base, jamais sur l'identité (le cahier §3c interdit la préférence durable pour un invité). Restent à trancher : périmètre `authenticated` — ⚠️ **remesuré le 2026-09-09, et ce n'est PAS « 67 policies à relire » comme écrit jusqu'ici** : AUCUNE policy ne porte de clause `to authenticated` (elles s'appliquent à tous les rôles et filtrent par `auth.uid()`). La surface réelle est **68 RPC distinctes** en `grant execute ... to authenticated` (dont `create_order`, `cancel_order`, `delete_product`, `create_establishment`, `grant_capability`, `create_campaign`, `list_audience_members`) **+ 7 grants directs sur tables** — dont `grant select, insert, update, delete on partners` et `grant update (contact_phone) on establishments`. C'est cette liste-là qu'il faut trancher, RPC par RPC. `is_anonymous` toujours absent du code source (les 100 occurrences sont des bundles `.next/` d'`auth-js`), sort de la ligne `partner_accounts` d'un anonyme, conversion d'identité quand l'invité pose son email, nettoyage des anonymes abandonnés.
- **Chantier front vitrine** — les points ouverts du parcours client cible sont groupés dans `docs/01-cahier-des-charges-client.md` §2f (recherche géo différée, plafonds du panier, forme du voucher, dispo PMS en recherche datée, rattachement d'une commande invitée à un compte). ⚠️ « Source du contact d'un établissement » en est RETIRÉ : tranché le 2026-09-08 (colonne `establishments.contact_phone`, spec 30 §3.2) — `partners.phone` était le mauvais candidat, 0/36 rempli.

- **Le bucket `catalog-media` grossit sans garde-fou** (mesuré le 2026-09-08 : 37 objets `.webp` orphelins, `product_media`/`establishment_media` à 0 ligne) — `cleanup.ts` purge les lignes SQL par CASCADE, jamais les binaires. Distinct de la dette « image orpheline au remplacement » : ici c'est l'accumulation par les e2e admin, et elle ne figurait nulle part.
- **`products.check_in_time`/`check_out_time` : la RÈGLE est tranchée** (l'établissement fait seul foi, spec 30 §3.4), le NETTOYAGE non — la colonne reste éditable dans 6 fichiers d'`apps/admin` et dans le payload JSONB des propositions socio (3 chemins de modération). Un admin peut saisir un horaire qu'aucune page publique n'affichera. Lot admin à part.
- **Rien n'empêche de publier un evento sans `external_booking_url`** — sa fiche affiche alors son occurrence et AUCUN moyen de réserver : un cul-de-sac silencieux, comportement actuel préservé et nommé par la spec 30 §10.5. La garde manque côté admin.

- **Le chemin des propositions SOCIO ne porte ni `external_booking_url` ni `price_label`** (`productEditPayload.ts`) — vrai AUSSI pour les eventos, donc défaut antérieur et non une régression : un socio ne peut pas modifier l'URL d'une vitrine qu'il a proposée. Le chemin admin direct les porte en ÉDITION depuis le 2026-09-08 (spec 30 §10ter) ; en CRÉATION il ne les portait pas non plus — rendre une vitrine non-evento créable depuis l'admin a été corrigé le 2026-09-09 en faisant passer l'insert par `buildProductCreationPayload`.
- **L'UPDATE de `moderate_product_proposal` écrit ses colonnes INCONDITIONNELLEMENT** (constaté le 2026-09-09 en écrivant son test) — une proposition dont le payload ne porte pas une clé EFFACE la colonne correspondante à l'approbation, jusqu'à violer une contrainte (`products_price_cop_required_unless_vitrine` déclenchée en réel). Seules `external_booking_url`/`price_label` en sont exemptées (forme `case when payload ? 'clé'`, migration 20260909180000) ; les ~15 autres colonnes gardent le défaut.
- **L'écran admin d'édition d'un evento ne porte pas `external_booking_url`** (bloc `isEvento ? {} : …` de product-form.tsx) — un admin ne peut pas corriger l'URL d'un evento. La whitelist SQL l'accepte pour tous les types depuis le 2026-09-09 : il ne reste que le geste d'écran.

- **Rien ne teste la création admin d'un produit** — ni `buildProductCreationPayload` ni `product-form.tsx` n'ont de test unitaire, et la seule couverture réelle (`admin-product-create.spec.ts`) est dans la suite e2e en pause. Le correctif vitrine du 2026-09-09 n'est donc protégé par rien (§11.20).

- ⚠️ **La suite pgTAP est INEXPLOITABLE après une exécution e2e** (constaté deux fois le 2026-09-08) : six fichiers comptent `audit_log` en absolu, et tout e2e admin y écrit. `npm run db:setup` la referme. Ce n'est pas une régression — c'est la même dette que la ligne « 6 fichiers pgTAP sensibles au volume » ci-dessous, mais sa CONSÉQUENCE méritait d'être nommée : un chiffre pgTAP mesuré après des e2e ne veut rien dire.

- ⚠️ **`Migas` rend des `<a href>` NATIFS, donc le fil d'Ariane provoque une navigation COMPLÈTE** — il viole l'invariant 9 de la spec 27 depuis sa création (`Breadcrumbs.Item` étend le `Link` de react-aria, pas celui de `@/i18n/navigation`). Invisible sur un listing, sérieux sur une fiche : **cliquer le fil vide le panier**, tenu en mémoire. Deux corrections possibles, aucune triviale : un `RouterProvider` react-aria (ABSENT de la version installée, vérifié le 2026-09-08) ou le panier persistant (cahier §2b.6, déjà décidé, spec à écrire). En attendant, la fiche produit garde son lien « ← Volver al catálogo », qui est le seul lien client-side vers l'accueil — ne pas le supprimer en le prenant pour un doublon.


- 🔴 **`consume_partner_invitation` laisse une session ANONYME devenir partenaire** (prouvé le 2026-09-09 : `{"ok":true,"roles":["referrer"]}`, capacité active, `role_agreements` signés par une identité jetable) — sa garde entière est `auth.uid() is null`. Pas exploitable tant que les sessions anonymes ne sont pas activées ; premier nom de la liste blanche (décision ③).
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
