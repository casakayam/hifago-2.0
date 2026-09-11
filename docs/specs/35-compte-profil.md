# Compte client : profil, édition, déconnexion, suppression

> **Cible stack** : hifago, `apps/web`. Chantier construit **en parallèle** de la spec 34
> (« Mis reservas »), dans le même arbre git — deux agents, deux zones de propriété disjointes de
> `(cuenta)/**`. Cette spec ne couvre QUE le profil ; `(cuenta)/cuenta/reservas/**` et
> `apps/web/lib/orders/**` appartiennent à l'autre lot et n'y sont jamais modifiés.
>
> **Décisions prises en entretien avec Jérôme le 2026-09-11** (huit questions, AskUserQuestion),
> en commençant par la suppression de compte — la seule qui touche au modèle de données
> (`CLAUDE.md` §10), donc la seule qui ne pouvait pas être tranchée seule. Le détail de chaque
> arbitrage et sa raison sont au §3.
>
> **✅ ENTIÈREMENT LIVRÉE le 2026-09-11** — les cinq tranches. Jérôme a autorisé l'implémentation
> directement après lecture de la spec (fast-track explicite, pas de tour de validation section par
> section supplémentaire) ; §10bis documente les trois écarts que le code a corrigés du texte
> initial, trouvés en écrivant T1.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | ✅ livré 2026-09-11 |
| 1 | Contexte et problème | ✅ 2026-09-11 |
| 2 | Portée et tranches | ✅ 2026-09-11 |
| 3 | Décisions retenues (entretien) | ✅ 2026-09-11 |
| 4 | Parcours cible | ✅ 2026-09-11 |
| 5 | Les écrans, bloc par bloc | ✅ 2026-09-11 |
| 6 | Modèle de données (delta) | ✅ 2026-09-11 |
| 7 | Contrat — RPC et Route Handler | ✅ 2026-09-11 (§10bis : écarts corrigés) |
| 8 | Règles et invariants | ✅ 2026-09-11 |
| 9 | Cas limites | ✅ 2026-09-11 |
| 10 | Décisions tranchées seule / points ouverts | ✅ 2026-09-11 |
| 11 | Annexe — traçabilité | ✅ 2026-09-11 |
| 12 | Documents liés | ✅ 2026-09-11 — cahier §2c révisé dans le même geste |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Carte des routes

| URL | Fichier | Contenu |
|---|---|---|
| `/[locale]/cuenta/perfil` | `(cuenta)/cuenta/perfil/page.tsx` | **accueil de la zone compte** : profil, édition, déconnexion, suppression |
| `/api/account/delete` | `app/api/account/delete/route.ts` | Route Handler `service_role`, appelée par le bouton de suppression |

`(cuenta)/layout.tsx` (partagé avec `/cuenta/reservas`, pas dans le périmètre "route" ci-dessus mais
modifié par cette spec — voir §5.0) porte la garde de zone et l'en-tête.

### Ce que ça change, en une phrase

Aujourd'hui la zone `(cuenta)` n'a qu'un écran (réservations), une garde qui laisse passer une
session anonyme, un en-tête minimal propre à elle, et aucun moyen de se déconnecter ou de supprimer
son compte. Après ce lot : un second écran (profil, accueil de la zone), la garde refuse un
anonyme **pour toute la zone**, l'en-tête redevient celui du reste du site, et un client peut se
déconnecter et anonymiser son compte.

### Les quatre objets touchés

| Objet | État | Détail |
|---|---|---|
| `partner_accounts.full_name`/`.phone` | **existent déjà** | ajoutés le 2026-08-19 (`20260819100000_partner_account_self_profile.sql`) pour l'écran socio `apps/admin/app/partner/(app)/account` — **aucune colonne à créer** |
| `update_my_account_profile(p_full_name, p_phone)` | **existe déjà** | RPC `security definer`, déjà `grant`ée à `authenticated` — le profil web l'appelle telle quelle, ne la redéfinit pas |
| `delete_my_account()` | **à créer** | `security definer`, anonymise `partner_accounts` (jamais `orders`/`order_lines`) ; refuse un invité et un compte porteur d'une capacité partenaire |
| `(cuenta)/layout.tsx` | **à corriger** | garde `isRealAccount` (pas `Boolean(user)`), en-tête = `SiteHeader` |

⚠️ **Cette spec réduit son propre périmètre en la rédigeant** : la charge annoncée à Jérôme pendant
l'entretien supposait deux nouvelles colonnes et une nouvelle RPC d'édition. Les deux existent déjà
— trouvé en vérifiant le modèle de données avant d'écrire le §6. Rien de ce que l'entretien a
tranché (§3) n'en est affecté ; seul le §6/§7 en est plus court que prévu.

### Invariants

1. `orders`/`order_lines` ne sont **jamais** modifiées par une suppression de compte — aucune ligne
   de ce lot ne les touche, en écriture comme en lecture.
2. La garde de zone (`(cuenta)/layout.tsx`) refuse une session anonyme **avant** tout enfant —
   jamais seulement une garde d'écran (même invariant que spec 34 §8).
3. `delete_my_account()` ne prend aucun paramètre et lit `auth.uid()` elle-même — jamais un uuid en
   entrée (l'exploit ouvert au backlog sur `is_admin`/`has_capability` ne doit jamais être
   reproduit ici).
4. La confirmation de suppression est **définitive** : aucune fenêtre de grâce, aucun retour arrière
   une fois la RPC exécutée avec succès.

---

## 1. Contexte et problème

### L'état mesuré au départ (2026-09-11)

- `/cuenta/perfil` n'existe pas. `find apps/web/app -path "*cuenta*"` ne rendait que
  `(cuenta)/layout.tsx`, `cuenta/reservas/page.tsx`, `cuenta/reservas/OrdersList.tsx`.
- **Aucune déconnexion** dans `apps/web` : `signOut` n'apparaît nulle part. Un client connecté ne
  peut plus jamais sortir depuis l'interface.
- **Aucune suppression/anonymisation de compte** : rien en base, aucune RPC.
- `(cuenta)/layout.tsx` monte son propre en-tête minimal (un lien « Hifago »), pas `SiteHeader` —
  d'où la demande de Jérôme d'un en-tête commun. Ce layout est un Server Component, `SiteHeader` un
  Client Component ; leur composition est détaillée au §5.0.
- La garde de `(cuenta)/layout.tsx` est `if (!user) redirect(...)` — elle laisse passer une session
  anonyme (`getUser()` rend un utilisateur même pour elle depuis la spec 31). La spec 34 (2026-09-11)
  a fermé ce trou sur SA route (`/cuenta/reservas`, décision ⑦) et a explicitement délégué la
  fermeture au niveau de la zone à ce lot-ci (son §2, « Frontières » : *« La garde de zone pour
  `/cuenta/perfil` : ce n'est pas mon fichier »*).

### Ce que le cahier des charges ne couvre pas

`docs/01-cahier-des-charges-client.md` §2c (compte client, révisé le 2026-09-07) énumère ce que le
compte donne : historique, profil, annulation, contact WhatsApp par réservation. **Il ne dit rien de
la déconnexion ni de la suppression de compte** — deux demandes de Jérôme non encore écrites dans le
périmètre fonctionnel. §2c est révisé dans le même geste que cette spec (§12).

### Pourquoi la suppression est un sujet de modèle de données, pas d'écran

Un compte est référencé à trois endroits qui ne peuvent pas bouger ensemble : l'identité de connexion
(`partner_accounts`/`auth.users`), et la PII **dénormalisée** sur chaque commande
(`orders.holder_name/holder_email/holder_phone`, `order_lines.holder_name/holder_phone/holder_email`)
— cette dernière existe précisément pour que la commande reste lisible indépendamment du compte qui
l'a passée (§3.1). C'est pourquoi `CLAUDE.md` §10 range ce point hors périmètre d'un agent seul, et
pourquoi l'entretien (§3) a précédé tout code.

---

## 2. Portée, tranches et frontières

### In

- L'écran `/cuenta/perfil` : affichage + édition (nom, téléphone), déconnexion, suppression de
  compte.
- La garde de zone `(cuenta)/layout.tsx` et son en-tête.
- `SiteMenu.tsx` : la destination de « Mi cuenta ».
- La RPC `delete_my_account()` et le Route Handler qui l'entoure.
- La révision du cahier §2c pour y faire figurer déconnexion et suppression.
- Un changement, coordonné avec l'autre agent, de la source de pré-remplissage du tunnel
  (`pago/page.tsx` : profil d'abord, dernière commande en repli).

### Out, explicitement

- Édition de l'email ou du mot de passe — restent au flux Supabase Auth natif, hors écran profil
  (dernier écart §2c, déjà au backlog : mot de passe oublié/réinitialisation, absent d'`apps/web`).
- `(cuenta)/cuenta/reservas/**`, `apps/web/lib/orders/**` — chantier de l'autre agent.
- Toute modification du comportement du panier à la déconnexion : le mécanisme existant
  (`CartContext.fetchLines` renvoie `[]` sans session, aucune session anonyme recréée hors d'un
  ajout) couvre déjà le besoin — voir §3.8. Rien à coder.
- Une réparation générale de `?next=` sur toute l'app : seule la garde de `(cuenta)` est concernée
  ici (§9).

### Tranches

✅ **Les cinq tranches sont livrées** (2026-09-11). Séquencement réel : la moitié serveur de T4 a été
faite avec T1 (§10bis) ; l'écran de T4 (boutons déconnexion/suppression) a été construit avec T3,
dans les mêmes fichiers.

| # | Contenu | Preuve de fait | Dépend de |
|---|---|---|---|
| **T1 ✅** | RPC `delete_my_account()`, tests pgTAP | Anonymise `partner_accounts` seul ; refuse anonyme et capacité active ; `orders`/`order_lines` inchangées par mutation — 15/15 pgTAP, 2 mutations vérifiées | — |
| **T2 ✅** | `(cuenta)/layout.tsx` (garde + en-tête), `SiteMenu.tsx` | Garde refuse un anonyme sur TOUTE la zone (pas seulement `/reservas`) ; en-tête = `SiteHeader` ; « Mi cuenta » → `/cuenta/perfil` ; `?next=` résolu en réel (proxy.ts) | — |
| **T3 ✅** | `/cuenta/perfil` — affichage + édition | Nom/téléphone affichés et modifiables, appelle `update_my_account_profile` (existante) — 3 Vitest, mutation vérifiée | T2 |
| **T4 ✅** | Déconnexion + suppression | Route Handler (confirmation serveur, garde professionnelle avant l'API Admin, `email_confirm`) + écran (bouton déconnexion, section de suppression désactivée en amont) — 6 Vitest + 4 Vitest composant, 2 e2e réels | T1, T3 |
| **T5 ✅** | Pré-remplissage du tunnel | `pago/page.tsx` lit le profil en priorité, repli sur la dernière commande — 1 e2e réel qui fait DIVERGER les deux sources, mutation vérifiée | T3, coordonné avec l'autre agent (fichier partagé, non modifié depuis par lui) |

---

## 3. Décisions retenues (entretien du 2026-09-11)

| # | Décision | Raison |
|---|---|---|
| ① | **Compte supprimé + réservation à venir payée** : le compte s'anonymise, la commande continue normalement | `orders`/`order_lines` portent déjà `holder_name/holder_email/holder_phone` en copie indépendante — l'établissement et LobbyPMS n'ont jamais dépendu du compte pour honorer une réservation |
| ② | **La commission du référent ne bouge pas** | `referrer_commission_cop`/`app_commission_cop` sont figées par ligne à la création (migration `20260814180000`) — elles ne dépendent pas de l'existence du compte client |
| ③ | **Périmètre exact de l'anonymisation : `partner_accounts` seule** (+ `auth.users`, hors SQL — §7). `orders`/`order_lines` ne sont **jamais** touchées | Confirmé explicitement par Jérôme après qu'une première formulation ait laissé planer une ambiguïté — c'est la clause qui garantit ① |
| ④ | **Confirmation forte, définitive** — le client retape son email, pas de délai de grâce, pas de réversibilité | Cohérent avec « jamais remboursé » déjà assumé ailleurs sur ce projet (§7/A3 du cahier) |
| ⑤ | **L'email est immédiatement réutilisable** pour un nouveau compte | Une fois `auth.users.email` remplacé, plus aucune ligne ne le porte — un nouveau compte peut s'inscrire avec, comme si l'ancien n'avait jamais existé |
| ⑥ | **Champs du profil : nom + téléphone seulement** | L'email a son propre mécanisme (Supabase Auth, re-vérification) ; le mot de passe aussi (reset, backlog, `apps/admin` en référence) — le profil ne touche que ce qui n'a pas déjà le sien |
| ⑦ | **Le profil devient la source de pré-remplissage du tunnel, la dernière commande n'est qu'un repli** | `pago/page.tsx` lisait jusqu'ici la dernière commande faute d'alternative — le profil est la vérité durable, la commande un instantané passé |
| ⑧ | **`/cuenta/perfil` est l'accueil de la zone compte** — `SiteMenu` y pointe désormais | Pas de nouvel écran hub à construire ; le profil porte un lien vers « Mis reservas » |
| ⑨ | **Le bouton de déconnexion vit seulement sur `/cuenta/perfil`** | Choix explicite de Jérôme (pas le layout partagé, pas `SiteMenu`) |
| ⑩ | **Rien à construire pour le panier à la déconnexion** | `CartContext.fetchLines` renvoie `[]` sans session ; une session anonyme n'est recréée que lazy, au prochain ajout — le panier reste intact en base et réapparaît à la reconnexion au même compte |
| ⑪ | **La suppression est bloquée si le compte porte une capacité partenaire** (référent/opérateur/admin) | Un même compte peut se connecter côté client sur `apps/web` (même email, sessions indépendantes) — éviter de détruire par erreur une identité professionnelle depuis l'écran client |

---

## 4. Parcours cible

```
Client réel connecté
  │
  ▼
/cuenta/perfil (accueil de la zone)
  ├─ Bloc profil            → affiche nom/téléphone, formulaire d'édition
  ├─ Lien « Mis reservas »  → /cuenta/reservas (chantier de l'autre agent)
  ├─ Bouton déconnexion     → supabase.auth.signOut() → redirect("/")
  └─ Bloc suppression
       ├─ capacité active   → bouton désactivé, message explicite, aucun appel réseau
       └─ sinon             → confirmation (retaper l'email) → POST /api/account/delete
                                  ├─ succès → signOut() → redirect("/") avec confirmation
                                  └─ échec  → message inline (SiteToaster non monté, dette connue)

Invité (session anonyme) ou visiteur sans session
  │
  ▼
(cuenta)/layout.tsx : isRealAccount(user) = false → redirect("/entrar")
  (toute la zone, /cuenta/perfil comme /cuenta/reservas)
```

---

## 5. Les écrans, bloc par bloc

### 5.0 `(cuenta)/layout.tsx` — garde de zone et en-tête (T2)

```
(cuenta)/layout.tsx                           Server Component
├─ supabase.auth.getUser()
├─ if (!isRealAccount(user)) redirect("/entrar" [+ ?next=, §9])
└─ <SiteHeader isAuthenticated={true} />       Client Component, déjà compatible :
   {children}                                  CartProvider est monté à [locale]/layout.tsx,
                                                au-dessus de (vitrine) ET (cuenta) — useCart()
                                                fonctionne ici sans rien remonter.
```

`isAuthenticated={true}` est un littéral, pas un nouveau calcul : le guard qui précède vient de le
garantir — même geste que `pago/page.tsx` passant `isRealAccount(user)` à `CheckoutForm`.

⚠️ **Décision prise en rédigeant, mineure** : seul `SiteHeader` est repris, pas `SiteFooter` — Jérôme
a demandé « même en-tête », pas la coquille complète. À confirmer légèrement (§10).

### 5.1 `/cuenta/perfil` — l'écran (T3, T4)

```
cuenta/perfil/page.tsx                        Server Component
├─ generateMetadata()                          robots hérités de (cuenta)/layout.tsx (index:false)
├─ getMyProfile()                              lib/account/getMyProfile.ts — lit partner_accounts
│                                               (full_name, phone) + l'email (auth.users, via
│                                               lib/auth/viewer.ts étendu)
└─ PageShell variant="narrow"
   ├─ Title                                    t("title")
   ├─ ProfileForm (Client)                      initialFullName, initialPhone — appelle
   │                                            supabase.rpc("update_my_account_profile", …)
   │                                            (RPC EXISTANTE, non redéfinie ici)
   ├─ LinkButton → /cuenta/reservas             t("myOrdersCta")
   ├─ LogoutButton (Client)                      supabase.auth.signOut() → redirect("/")
   └─ DeleteAccountSection (Client)
      ├─ capacité active (calculée serveur)     → bouton isDisabled, message inline
      └─ sinon                                  → champ « retaper l'email » + bouton, confirmation
                                                   en un temps fort (pas une boîte de dialogue) →
                                                   POST /api/account/delete
```

### Libellés (namespace `AccountProfilePage`, nouveau)

| Clé | ES | EN |
|---|---|---|
| `title` | Mi perfil | My profile |
| `fullNameLabel` | Nombre completo | Full name |
| `phoneLabel` | WhatsApp | WhatsApp |
| `saveButton` | Guardar | Save |
| `myOrdersCta` | Ver mis reservas | View my reservations |
| `logoutButton` | Cerrar sesión | Log out |
| `deleteSectionTitle` | Eliminar mi cuenta | Delete my account |
| `deleteConfirmLabel` | Escribe tu email para confirmar | Type your email to confirm |
| `deleteButton` | Eliminar cuenta | Delete account |
| `deleteBlockedByCapability` | Esta cuenta también es una cuenta profesional (referente/operador/admin). Desactívala primero desde el panel correspondiente. | This account is also a professional account (referrer/operator/admin). Deactivate it first from the relevant panel. |
| `deleteError` | No se pudo eliminar la cuenta. Inténtalo de nuevo. | Could not delete the account. Try again. |

*(Libellés indicatifs, à raffiner à l'écriture — pas un point à valider avec Jérôme.)*

---

## 6. Modèle de données (delta)

| Objet | État | Détail |
|---|---|---|
| `partner_accounts.full_name` / `.phone` | **existant, réutilisé** | `20260819100000_partner_account_self_profile.sql` |
| `update_my_account_profile(p_full_name, p_phone)` | **existant, réutilisé** | `security definer`, `search_path=''`, déjà `grant`ée à `authenticated` — ne touche que la ligne de l'appelant, jamais `partner_id` |
| `delete_my_account()` | **à créer** | voir §7.1 |
| RLS de `partner_accounts` | **inchangée** | SELECT directe (propre compte + miroir admin) depuis `20260813163456_identity_rls.sql` ; écritures `revoke`es pour `anon`/`authenticated` depuis `20260828000103` — `delete_my_account()` la contourne comme `update_my_account_profile` le fait déjà |

Aucune nouvelle table, aucune nouvelle colonne.

---

## 7. Contrat — RPC et Route Handler

### 7.1 `delete_my_account()`

Forme réelle : `supabase/migrations/20260911140000_delete_my_account.sql` (écrite, appliquée en
local, 15 assertions pgTAP vertes). Les `reason` rendus : `not_authenticated`, `anonymous_session`,
`account_not_found`, `professional_account`, sinon `{ok: true}`.

⚠️ **Trois écarts entre ce que ce §7.1 annonçait et ce que le code a dû faire** — voir §10bis :
la garde professionnelle passe par DEUX chemins (pas un), les refus sont des `jsonb`
(pas des `raise exception`), et le `revoke` doit inclure `authenticated`.

- **Nommée `delete_...` mais n'exécute qu'un `UPDATE`** — jamais un `DELETE FROM auth.users` : la
  même migration qui a créé `partner_accounts` pose `on delete cascade` depuis `auth.users`, mais le
  job de purge des identités anonymes (`20260910130000_purge_expired_anonymous_identities.sql`)
  prouve que `orders.account_id` bloque ce cascade (`foreign_key_violation`) dès qu'une commande
  existe — et *ne purge que les identités sans commande* pour cette raison précise. Un compte client
  réel a presque toujours des commandes (décision ①) : la suppression physique est donc
  structurellement impossible ici, l'anonymisation par `UPDATE` est la seule voie.
- **Bloque sur TOUTE ligne `partner_capabilities`**, quel que soit son `status` (`onboarding`,
  `pending_review`, `active`, `suspended`) — pas seulement `active` au sens littéral. Décision prise
  en rédigeant (§10) : même une capacité suspendue reste un lien professionnel réel qu'un geste
  côté client ne doit pas effacer silencieusement.
- Zéro paramètre, lit `auth.uid()` elle-même (invariant 3 du §0) — pas de fonction de garde séparée
  et réutilisable : un seul appelant, l'inliner évite une surface `grant` de plus à surveiller.
- `partner_id` remis à `null` par prudence (systématiquement déjà `null` ici, la garde ⑪ l'ayant
  vérifié juste avant).

### 7.2 `POST /api/account/delete`

```
1. Client Supabase serveur (cookies) → getUser() → si !isRealAccount(user) → 401
2. supabase.rpc("delete_my_account")            (client scopé à l'appelant — auth.uid() correct)
     ├─ erreur "Sesión anónima" / "Cuenta profesional activa" / "Cuenta no encontrada"
     │    → 409, { ok: false, reason }
     └─ succès
3. createServiceRoleClient().auth.admin.updateUserById(user.id, {
     email: `deleted+${user.id}@hifago.invalid`,   // TLD réservé RFC 2606, jamais un vrai domaine
     password: <secret aléatoire, jamais journalisé>,
     user_metadata: {},
   })
4. → 200, { ok: true }
```

⚠️ **Changer l'email/mot de passe d'`auth.users` passe par l'API Admin (`service_role`), jamais du
SQL direct sur `auth.users`** — le schéma appartient à `supabase_auth_admin`, pas `postgres` ;
`insert into auth.users` est déjà confirmé refusé sur Supabase Cloud (2026-08-21), et rien ne
garantit qu'un `update` direct s'y comporte différemment. L'API Admin est le chemin officiellement
supporté, déjà le patron `service_role` du projet (`CLAUDE.md` §3.5, `packages/supabase/src/service.ts`).
**Non vérifié sur Cloud** — même famille de risque que le `DELETE` du job de purge (backlog) : à
tester en priorité dès qu'un projet préprod existe, avant de faire confiance à ce chemin en
production.

Étape 2 échouée → étape 3 jamais atteinte (le compte n'est pas anonymisé côté `partner_accounts`
mais reste pleinement fonctionnel : pas d'état intermédiaire incohérent). Étape 3 échouée après
l'étape 2 réussie → **incohérence assumée et à documenter** : `partner_accounts` anonymisé mais
connexion encore possible avec l'ancien email — cas à couvrir par un test de mutation (§10, point
ouvert : faut-il une transaction logique entre les deux, ou un job de rattrapage ?).

Côté client : succès → `supabase.auth.signOut()` → `redirect("/")`. La page d'accueil affiche un
message de confirmation via un paramètre d'URL (à préciser à l'écriture, pas un point d'arbitrage).

---

## 8. Règles et invariants

1. Aucune écriture de ce lot ne touche `orders`/`order_lines` (invariant 1, §0).
2. La garde de zone précède tout enfant, jamais une garde d'écran seule (invariant 2, §0) — même
   principe que spec 34 §8.
3. `delete_my_account()` ne reçoit jamais d'identifiant en paramètre (invariant 3, §0).
4. Confirmation de suppression définitive, aucune réversibilité (invariant 4, §0 / décision ④).
5. `update_my_account_profile` n'est pas redéfinie : toute évolution de son contrat (champs, forme)
   est un sujet partagé avec `apps/admin`, jamais un changement local à `apps/web`.
6. Tout lien interne passe par le `Link` de `@/i18n/navigation` (règle générale `apps.md`).
7. `noValidate` sur le formulaire de profil (règle générale `apps.md` — un champ requis natif
   bloquerait `onSubmit` silencieusement).

---

## 9. Cas limites

| Situation | Traitement |
|---|---|
| Session anonyme visite `/cuenta/perfil` | Redirigée par le layout vers `/entrar`, jamais rendue |
| Compte avec capacité partenaire clique « Eliminar » | Bouton déjà désactivé côté rendu (vérifié serveur), aucun appel réseau possible |
| La RPC réussit, l'étape Admin API échoue | Voir §7.2 — incohérence à couvrir, point ouvert §10 |
| Profil jamais édité (nom/téléphone vides) | Le tunnel retombe sur la dernière commande (décision ⑦) ; l'écran profil affiche des champs vides, pas d'erreur |
| Double clic sur « Eliminar » | Bouton désactivé pendant la requête (`isSubmitting`), même patron que `LogoutButton`/`CancelLineButton` |
| `?next=` sur la redirection de garde | Voir §10 — non résolu par cette spec, piste proposée |

---

## 10. Décisions tranchées seule (à valider légèrement) / points ouverts

### Tranchées seule en rédigeant

- Seul `SiteHeader` est repris dans `(cuenta)/layout.tsx`, pas `SiteFooter` (§5.0).
- `delete_my_account()` bloque sur toute ligne `partner_capabilities` quel que soit son `status`,
  pas seulement `active` au sens littéral de la réponse de Jérôme (§7.1).
- Nom de la RPC : `delete_my_account()` malgré son implémentation en `UPDATE` — cohérent avec le
  vocabulaire utilisateur (« supprimer mon compte »), le commentaire SQL porte la nuance.

### Points ouverts

- **`?next=` sur `(cuenta)/layout.tsx`** : piste à tester en priorité à l'implémentation — `proxy.ts`
  reconstruit déjà un `NextResponse` après `intlMiddleware(request)` (il y pose déjà le cookie
  `hifago_ref`) ; tester si `NextResponse.next({ request: { headers } })` composé après coup sur ce
  même objet transmet un `x-pathname` lisible via `headers()` dans le layout. Si ça ne compose pas
  avec ce que `intlMiddleware` a déjà construit (risque réel, non vérifié — c'est précisément ce que
  le commentaire actuel du layout documente comme bloquant), replier sur le comportement actuel
  (redirection nue) et le documenter comme dette assumée plutôt que de câbler quelque chose de
  fragile.
- **Incohérence RPC réussie / Admin API échouée** (§7.2) : accepter le risque en l'état (rare, un
  incident réseau entre deux appels du même Route Handler), ou ajouter un rattrapage ? Proposition :
  accepter pour ce lot, documenter dans la dette technique — un compte dans cet état reste
  entièrement fonctionnel (juste pas encore anonymisé), donc pas d'urgence produit.
- **Révision du cahier §2c** : ajouter déconnexion et suppression au périmètre écrit — geste
  mécanique une fois cette spec validée.

---

## 10bis. Ce que le code a corrigé du texte (T1 + moitié serveur de T4, 2026-09-11)

### La faute réelle : la garde professionnelle ne voyait qu'un chemin sur deux

Le §7.1 rédigé avant de coder ne cherchait que `partner_capabilities.account_id = auth.uid()`. Or
`partner_capabilities_scope` (contrainte de 20260813161117) impose :

    role = 'admin'                   → account_id NOT NULL, partner_id NULL
    role in ('referrer','operator')  → partner_id NOT NULL, account_id NULL

Une capacité de **référent ou d'opérateur n'est donc JAMAIS portée par le compte** : elle est portée
par l'organisation, et le rattachement se lit sur `partner_accounts.partner_id` (c'est exactement
ainsi que `has_capability` fait sa jointure). Le code d'origine aurait laissé un référent supprimer
son compte — précisément les deux profils que la décision ⑪ voulait protéger. Corrigé, et **prouvé
par mutation** : retirer la branche `partner_id` fait rougir les cas 4 et 7 du test.

### Deux conventions du dépôt, pas des préférences

- **Les refus sont des `jsonb {ok:false, reason}`, jamais des `raise exception`** — convention de
  `cancel_order_line` (la RPC sœur, écrite la veille) : la Route Handler mappe une `reason` sans
  jamais analyser un message d'erreur.
- **Le `revoke` inclut `authenticated`** avant de re-`grant` : l'`alter default privileges` du
  projet accorde nommément à `anon`, qu'un `revoke ... from public` seul ne retire pas (piège déjà
  payé par la spec 33).

### Décision ⑤ vérifiée en réel, pas supposée

Le §7.2 pariait que changer l'email par l'API Admin libère l'ancien. Testé sur la stack locale le
2026-09-11 : l'API Admin met aussi à jour `auth.identities` (l'ancien email n'y survit pas), et une
nouvelle inscription avec l'ancien email est **acceptée**. Le pari tenait — mais il ne tenait qu'à
`email_confirm: true` : sans lui GoTrue laisse le changement EN ATTENTE, l'ancienne adresse reste
occupée, et la décision ⑤ serait fausse en silence. C'est le seul invariant du lot qu'aucun écran
ni e2e ne pourrait montrer ; `route.test.ts` l'assert nommément.

### Séquencement changé

La moitié SERVEUR de T4 (Route Handler) a été écrite juste après T1, avant T2/T3 : elle n'a aucune
dépendance à l'écran, et les regrouper garde le travail sensible (RPC destructive + `service_role`)
dans une seule passe. Il ne reste de T4 que son écran.

## 11. Annexe — traçabilité

- Entretien mené le 2026-09-11 (AskUserQuestion, 8 questions, avant toute écriture de code).
- `partner_accounts.full_name`/`.phone` : `20260819100000_partner_account_self_profile.sql`.
- `orders`/`order_lines` PII dénormalisée : `20260813194515_availability_orders_core_tables.sql`,
  `20260817180000_order_lines_holder_name.sql`, `20260819180000_order_lines_holder_contact_operator.sql`.
- Commission figée par ligne : `20260814180000_order_lines_commission_snapshot.sql`.
- Précédent `DELETE FROM auth.users` non vérifié sur Cloud :
  `20260910130000_purge_expired_anonymous_identities.sql`.
- Décision ⑦ (garde anonyme) et délégation de la garde de zone : `docs/specs/34-compte-mes-reservations.md`
  §2, §7.3, et `docs/journal/2026-09.md` (entrée du 2026-09-11, « Spec 34 »).
- `isRealAccount` : `packages/supabase/src/identity.ts`.
- `createServiceRoleClient` : `packages/supabase/src/service.ts`.

## 12. Documents liés

- `docs/01-cahier-des-charges-client.md` §2c — **révisé** (déconnexion, suppression désormais
  présentes, avec renvoi vers cette spec).
- `docs/specs/34-compte-mes-reservations.md` — chantier parallèle, dépendance sur `(cuenta)/layout.tsx`
  (livrée : la garde de zone refuse désormais un invité, comme sa décision ⑦ l'exigeait).
- `docs/specs/27-architecture-vitrine-et-routage.md` §5 — garde de zone, origine du problème `?next=`
  (résolu, §10bis et `proxy.ts`).
- `docs/dette-technique.md` — le point « incohérence RPC/Admin API » (§10) reste ouvert, accepté tel
  quel pour ce lot ; à y porter si personne ne le referme avant que le fichier soit relu.

## 13. Livré et vérifié (2026-09-11)

**Livré** : `delete_my_account()` (migration, RPC) ; Route Handler `/api/account/delete` ; garde de
zone `isRealAccount` + en-tête `SiteHeader` dans `(cuenta)/layout.tsx` ; `?next=` résolu dans
`proxy.ts` ; `SiteMenu` pointant vers `/cuenta/perfil` ; l'écran `/cuenta/perfil` complet (profil,
déconnexion, suppression) ; `pago/page.tsx` lisant le profil en priorité ; cahier §2c révisé.

**Vérifié** : 15 assertions pgTAP (`delete_my_account.test.sql`) + les 4 tests de sécurité/RLS
existants toujours verts après la nouvelle fonction `security definer` ; 690/690 Vitest `apps/web`
(dont 19 neufs sur ce lot) ; 6 e2e réels (2 sur `/cuenta/perfil`, 1 sur le pré-remplissage du
tunnel, 3 de non-régression relancés) ; les six contrôles CI ; rendu réel capturé en 390×844 et
1280×900, ES et EN, y compris l'état « confirmation de suppression ouverte ». **Cinq mutations
exécutées** (la garde professionnelle sur son second chemin, l'anonymisation qui déborderait sur
`orders`, la vérification d'email qui disparaîtrait, `email_confirm` qui manquerait, le
pré-remplissage qui ignorerait le profil) — chacune fait rougir exactement ce qu'elle doit.
**Vérifié en réel, pas supposé** : l'API Admin Supabase libère bien l'ancien email (`auth.users` ET
`auth.identities`), constaté par une requête directe en base après une suppression réelle en e2e —
décision ⑤ prouvée hors mock.

**Non fait, assumé** : point ouvert §10 (incohérence RPC/Admin API) non traité, accepté tel quel ;
`?next=` non re-vérifié sur Vercel (dette nommée, sans risque en cas d'échec silencieux) ; aucune
validation section par section supplémentaire au-delà de l'entretien §3 (Jérôme a autorisé
l'implémentation directement après lecture de la spec).
