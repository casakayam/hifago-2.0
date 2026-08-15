---
id: specs-connexion-inscription-complete
titre: "Connexion/inscription complète : Google, email+mot de passe, vérification, mot de passe oublié, 2FA admin"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-15
resume: >
  Parcours de connexion/inscription complet pour hifago, sur Supabase Auth : Google OAuth,
  inscription email/mot de passe avec vérification par email, mot de passe oublié/réinitialisation,
  et 2FA TOTP obligatoire pour le rôle admin — sans reconstruire l'identité unifiée déjà en place
  (partner_accounts/partner_capabilities). Back-end générique pour les deux apps ; front de ce lot
  concentré sur apps/admin.
mots_cles: [auth, connexion, inscription, google, oauth, verification email, mot de passe oublie,
  2fa, mfa, totp, supabase auth, hifago]
repond_a:
  - "Comment un utilisateur se connecte-t-il ou crée-t-il un compte, avec ou sans Google ?"
  - "Comment vérifie-t-on l'email d'une inscription simple ?"
  - "Comment fonctionne le mot de passe oublié ?"
  - "Comment le 2FA admin se déclenche-t-il ?"
---

# Connexion/inscription complète

> **Cible stack** : Hifago uniquement, back-end générique (les deux apps), front `apps/admin`
> uniquement pour ce lot. **Feature n°31** — numéro de build, distinct du `07-` de ce fichier qui
> est un compteur de docs. Dernière feature attribuée avant celle-ci : 30
> (`docs/specs/06-gestion-etablissement.md`, 2026-08-15, session concurrente) ; 29 pour cette même
> session (`docs/specs/05-invitations-onboarding-dashboard-partenaire.md`).
>
> **Implémentée le 2026-08-15**, spec rédigée puis codée dans la même session. Trois écarts par
> rapport au plan initial, découverts en construisant et en vérifiant réellement (navigateur piloté
> + vrais emails Mailpit), détaillés en annexe §11 : (1) le QR TOTP est fourni directement par
> Supabase (`data.totp.qr_code`, SVG déjà prêt) — la dépendance `qrcode` envisagée était inutile et
> n'a pas été ajoutée ; (2) le pré-contrôle du jeton d'invitation ne peut pas lire
> `partner_invitations` via un client `service_role` (table RPC-only, aucun `GRANT SELECT` à ce
> rôle) — nouvelle RPC `check_partner_invitation`, cohérente avec le patron déjà en place partout
> ailleurs dans le projet ; (3) le dispatcher racine (`app/page.tsx`) avait un repli mort
> (`redirect("/partner/join")` pour un compte sans aucun rôle) — invisible avant cette feature
> puisqu'aucun compte sans rôle ne pouvait exister avant l'inscription libre ; corrigé vers
> `redirect("/partner")`.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 6 | Modèle de données | implémenté |
| 7 | Contrat API/RPC | implémenté |
| 8 | Règles et invariants | implémenté |
| 9 | Cas limites | implémenté |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 1. Contexte et problème

Aujourd'hui, `/login` (`apps/admin`, partagé admin+socio) et `/login` (`apps/web`, client) ne font
qu'un `supabase.auth.signInWithPassword({email, password})`. Aucun bouton Google, aucune inscription
libre, aucun « mot de passe oublié », aucune vérification d'email nulle part. Le **seul** point de
création de compte existant est `/partner/join` (invitation, Feature 29), dont le
`supabase.auth.signUp()` suppose `enable_confirmations = false` (config Supabase locale) pour
recevoir une session immédiatement après l'appel.

**L'infrastructure d'identité unifiée est déjà prête, vérifié dans le code — pas à reconstruire** :
`partner_accounts` (miroir 1:1 de `auth.users`, provisionné par un trigger sur **tout** insert dans
`auth.users`, quel que soit le mode d'inscription) + `partner_capabilities` (rôles composables
`referrer`/`operator`/`admin` ; un compte « client » nu = simplement aucune capacité). C'est donc un
problème d'écrans et de configuration Supabase Auth manquants, pas de modèle de données.

**Trois décisions déjà validées par Jérôme, à ne pas rouvrir** :
- `hifago/docs/02-cahier-des-charges-socio.md` §1 (« Périmètre et vision », 2026-08-11) : *« une
  seule base d'utilisateurs »* — client/socio/admin sont des rôles composables sur une même
  identité, jamais des systèmes de comptes séparés.
- `hifago/docs/01-cahier-des-charges-client.md` §2 (2026-08-11) : compte client par email/mot de
  passe **ou** Google, identifié par un email unique quel que soit le mode.
- `hifago/docs/03-cahier-des-charges-admin.md` §1 (2026-08-11, précisé 2026-08-12) : **2FA (TOTP)
  obligatoire pour le rôle admin**, déclenché **à la connexion elle-même**, dès qu'une identité
  porte ce rôle — puisque l'identité est unifiée, ce n'est pas une porte séparée mais une étape
  supplémentaire après n'importe quelle connexion qui aboutit à un compte admin.
- `hifago/docs/04-architecture-cible.md` : décision technique de s'appuyer sur Supabase Auth **à
  fond** (email/mot de passe, Google OAuth, MFA/TOTP) plutôt que reconstruire hashing/OAuth/TOTP à
  la main.

**L'app legacy (hifago.co, en prod) a déjà un système mature à reprendre comme référence de
comportement** (pas de code — architecture différente, JWT custom vs Supabase Auth) : Google en un
clic (GSI ID-token), `/forgot`+`/reset` (lien 1h, hash, usage unique, sert aussi à poser un mot de
passe sur un compte 100 % Google). **Confirmé absent du texte de la doc racine : aucune vérification
d'email à l'inscription**, en legacy — c'est donc une vraie nouveauté demandée par Jérôme, pas la
reprise d'un comportement déjà éprouvé côté produit (seule l'infrastructure technique, côté
Supabase, est une bonne pratique standard, pas une réinvention).

## 2. Portée

**In** :
- Google OAuth (config back-end pour les deux apps ; écrans côté `apps/admin` seulement ce lot).
- Inscription libre email/mot de passe + vérification par email (idem).
- Mot de passe oublié / réinitialisation (idem).
- 2FA TOTP obligatoire pour le rôle admin : enrôlement forcé si absent, vérification à chaque
  connexion qui aboutit à un compte admin.
- Adaptation de `/partner/join` pour rester instantané malgré l'activation de la vérification email.

**Out, explicitement renvoyé ailleurs** :
- Front `apps/web` (client) — décision Jérôme, cette session : le back-end est générique, réutilisable
  sans retouche ; l'écran `apps/web` lui-même est un lot futur.
- Linking manuel explicite (écran « connecter mon compte Google » dans des paramètres) — le linking
  automatique de Supabase (même email vérifié) couvre déjà le besoin exprimé (email unique quel que
  soit le mode de connexion).
- SMTP de production — dépendance opérationnelle hors code, le SMTP par défaut Supabase (limité,
  best-effort) suffit en local/test.
- Codes de secours 2FA — non fournis nativement par Supabase MFA, pas reconstruits ici (cf. §9).
- Passkeys/WebAuthn — non demandé.

## 3. Décisions retenues

Ne pas rouvrir :
- **2FA admin inclus dans ce lot** (pas reporté) — décision Jérôme, cette session.
- **Vérification email — mécanique retenue** (décision Jérôme, cette session) : après inscription
  **ou** connexion, si le compte n'est pas confirmé, redirection vers un écran « Revisa tu correo »
  avec un bouton pour renvoyer l'email. Implique `enable_confirmations = true` côté Supabase
  (bloque `signUp`/`signInWithPassword` pour un compte non confirmé) — **sauf** `/partner/join`, qui
  reste instantané (déjà en prod, Feature 29) : le compte y est créé **déjà confirmé** via un appel
  serveur `service_role` dédié (même patron que le pipeline d'upload d'images,
  `packages/supabase/src/service.ts`) ; `consume_partner_invitation` reste l'unique autorité de
  consommation du jeton (le nouvel appel serveur ne fait qu'un pré-contrôle en lecture seule du
  statut/expiration avant de créer le compte — préserve l'invariant déjà testé « une invitation
  invalide échoue sans créer de compte partiel », `docs/5-conception/roles-composables.md` §9).
- **Périmètre par app** (décision Jérôme, cette session) : back-end/API générique, réutilisable par
  les deux apps. Front concentré sur `apps/admin`. `apps/web` garde son `/login` actuel inchangé.
- **Identifiants Google** : Jérôme fournit un vrai Client ID/Secret pendant le codage (même patron
  que la clé Google Maps, Feature 26) — le vrai flux OAuth est testé de bout en bout, pas seulement
  le code.
- **Bonnes pratiques Supabase Auth retenues** (recherche documentée, pas de réinvention) :
  - Google OAuth en flux *redirect* (pas popup), Route Handler `/auth/callback`
    (`exchangeCodeForSession`), jamais une Server Action.
  - Lien de confirmation/reset construit via `{{ .TokenHash }}` (pas `{{ .ConfirmationURL }}` par
    défaut, vulnérable au pré-fetch des scanners d'email) → callback serveur `verifyOtp({token_hash,
    type})`.
  - `signUp()`/`resetPasswordForEmail()` sur un email déjà pris ou inconnu : réponse toujours
    générique, jamais de fuite d'existence de compte.
  - Linking automatique (même email vérifié → même compte) : comportement par défaut Supabase, zéro
    code, satisfait directement « email unique quel que soit le mode ».
  - UI faite main (`@hifago/ui`, même style que `LoginForm.tsx`/`JoinForm.tsx`), pas
    `@supabase/auth-ui-react` (approche dépréciée).
  - Autorisation serveur toujours via `getUser()` (revérifié cryptographiquement), jamais
    `getSession()` seul — déjà la pratique dans `hifago/`, rien à changer.
  - `apps/admin/proxy.ts` (refresh de session à chaque requête, équivalent du middleware Next 16)
    déjà correct, rien à changer.

## 4. Parcours cible

**Connexion** : `/login` → email/mot de passe ou Google → succès → next (ou `/mfa/verify` si compte
admin sans AAL2) ; échec pour cause de compte non confirmé → `/verify-email`.

**Inscription libre** : `/signup` → email/mot de passe (+confirmation) ou Google → pas de session
(confirmation requise pour email/mot de passe) → `/verify-email` → clic sur le lien reçu →
`/auth/callback` (`verifyOtp`) → session établie → next.

**Mot de passe oublié** : `/forgot-password` → email → toujours un message générique → lien reçu →
`/auth/callback` (session de récupération) → `/reset-password` → nouveau mot de passe → reconnexion.

**2FA admin** : connexion réussie, compte porte la capacité admin → pas de facteur TOTP enrôlé →
`/mfa/enroll` (bloquant) → facteur enrôlé et vérifié → accès. Si facteur déjà enrôlé mais session
AAL1 → `/mfa/verify` (bloquant) → accès.

**Invitation partenaire** (Feature 29, inchangée dans son comportement) : lien reçu → jeton vérifié
en arrière-plan → formulaire (nom/email/mot de passe) → compte créé **déjà confirmé** (nouveau,
service_role) → `consume_partner_invitation` → redirection `/partner`, instantané comme aujourd'hui.

## 5. Écran(s)

Tous dans `apps/admin`, sauf mention contraire.

- **`/login`** (étendu) : bouton « Continuar con Google » → séparateur → formulaire email/mdp
  existant → lien « ¿Olvidaste tu contraseña? » → lien « Crear cuenta ». `signInWithPassword` en
  échec pour cause de compte non confirmé → redirection `/verify-email`.
- **`/signup`** (nouveau) : même bouton Google + formulaire email/mdp (+ confirmation du mdp) →
  `signUp()` côté client. Pas de session (confirmation requise) → redirection `/verify-email`.
- **`/verify-email`** (nouveau) : « Revisa tu correo (adresse) », bouton « Reenviar correo »
  (`auth.resend({type:'signup', email})`, cooldown anti-abus), lien retour connexion.
- **`/forgot-password`** (nouveau) : email → `resetPasswordForEmail()`, message générique toujours
  identique (pas d'énumération de compte).
- **`/reset-password`** (nouveau) : atteint via le lien reçu (session de récupération déjà établie
  par le callback) → nouveau mot de passe → `updateUser({password})`.
- **`/auth/callback`** (nouveau, Route Handler) : gère l'échange de code OAuth
  (`exchangeCodeForSession`) et l'atterrissage des liens email (`verifyOtp` avec `token_hash` +
  `type` — `signup`, `recovery`) selon les paramètres reçus, puis redirige vers `next` (ou
  `/mfa/enroll`/`/mfa/verify` si le compte est admin).
- **`/mfa/enroll`** (nouveau) : affiché quand le compte a la capacité admin et **aucun** facteur TOTP
  enrôlé — QR code (`otpauth://` renvoyé par `mfa.enroll()`, rendu via `qrcode`) + secret en repli
  texte + champ de confirmation à 6 chiffres (`mfa.challengeAndVerify()`). Bloquant : pas d'accès à
  `/admin/*` (ni `/partner/*`) tant que non enrôlé.
- **`/mfa/verify`** (nouveau) : affiché quand le compte a la capacité admin, un facteur TOTP existe,
  mais la session courante est AAL1 — champ à 6 chiffres, même appel de vérification.
- **`/partner/join` → `JoinForm.tsx`** (modifié) : remplace l'appel client `signUp()` par un appel au
  nouveau Route Handler `POST /api/auth/invitation-signup` (§7), le reste (RPC
  `consume_partner_invitation`, redirection `/partner`) inchangé.

## 6. Modèle de données

Aucune nouvelle table. `is_admin(uid)` (`supabase/migrations/20260813163040_identity_invariants.sql`)
étendu pour exiger l'AAL2 (`auth.jwt()->>'aal' = 'aal2'`) quand la capacité admin est active — chokepoint
déjà utilisé par toute la checklist RLS/RPC-only existante, un seul changement centralisé plutôt que
de retoucher chaque RPC admin individuellement. Vérifié à l'implémentation (grep exhaustif) : tous
les appelants sont des auto-contrôles (`is_admin(auth.uid())`), jamais un contrôle du statut admin
d'un tiers. Nouveau helper distinct `has_admin_capability(uid)` : la capacité seule, **sans**
exigence d'AAL2 — nécessaire pour que le garde applicatif (`checkMfaGuard`) puisse d'abord savoir
« ce compte est admin » avant que l'AAL2 soit atteinte, afin de le rediriger vers `/mfa/enroll` ;
`is_admin()` seul ne peut pas servir à cette décision (il est volontairement faux tant que l'AAL2
n'est pas satisfaite — cercle vicieux sinon). Nouvelle RPC `check_partner_invitation` (§7).

## 7. Contrat API/RPC

**`POST /api/auth/invitation-signup`** (nouveau Route Handler) :
```
{ token: string, email: string, password: string }
→ { ok: true } | { ok: false, reason: "invitation_not_found" | "already_consumed" |
    "already_revoked" | "expired" | "email_already_used" | "session_failed" | "invalid_request" }
```
Pré-contrôle en lecture seule via la nouvelle RPC `check_partner_invitation` (ci-dessous), **pas**
une lecture directe de `partner_invitations` via `service_role` comme envisagé initialement — cette
table est RPC-only (aucun `GRANT SELECT` à `service_role`, `service_role` contourne la RLS mais
jamais l'absence de GRANT, `permission denied for table partner_invitations` constaté en écrivant
cette route) → si invalide, erreur typée identique à l'écran actuel → sinon
`service.auth.admin.createUser({email, password, email_confirm: true})` (`service_role`, seul appel
qui en a réellement besoin) puis établissement de la session (cookies) côté serveur via un client
`@supabase/ssr` lié à la réponse → `{ ok: true }`. Auth vérifiée/créée **avant** tout retour au
client, jamais un filet a posteriori (même discipline que `POST /api/upload/[entity]`, cf. backlog
legacy C29). Le client appelle ensuite `consume_partner_invitation` exactement comme aujourd'hui
(nom du signataire transmis à ce moment-là, pas à cette route).

**`check_partner_invitation(p_token text) returns jsonb`** (nouvelle RPC, `security definer`,
`set search_path=''`) : hash le jeton, lit statut/expiration de `partner_invitations`, retourne
`{ok:true}` ou `{ok:false, reason:...}` — mêmes conditions que le début de
`consume_partner_invitation`, sans le verrou `for update` (lecture seule). Callable sans
authentification par `anon`/`authenticated` (`grant execute`) : connaître le jeton brut à 64
caractères hex est la preuve d'autorisation, comme pour `consume_partner_invitation`.

**Config `supabase/config.toml`** :
```toml
[auth.email]
enable_confirmations = true

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```
Templates email confirmation/recovery pointant vers
`/auth/callback?token_hash={{ .TokenHash }}&type=...` (nouveau fichier `hifago/.env`, gitignoré,
+ `.env.example` racine documentant les deux nouvelles variables).

## 8. Règles et invariants

- Un compte non confirmé n'a jamais de session utilisable en dehors de `/verify-email`.
- `/partner/join` reste instantané, jamais régressé par ce lot.
- Aucune invitation invalide ne crée de compte, même partiel (invariant déjà testé, préservé).
- ~~Un compte portant la capacité admin ne peut jamais atteindre `/admin/*` ni `/partner/*` sans
  facteur TOTP enrôlé et vérifié (AAL2)~~ — **suspendu le 2026-08-15** (§10, non conforme
  temporaire) : le 2FA est actuellement optionnel, pas d'AAL2 requis. Cet invariant redevient
  vrai dès que le point ouvert §10 est refermé.
- Jamais de fuite d'information sur l'existence d'un compte (signup, forgot-password) — réponse
  générique dans tous les cas.

## 9. Cas limites

- Email déjà pris à l'inscription → message identique au cas succès (pas d'énumération).
- Lien de confirmation/reset expiré ou déjà utilisé → message d'erreur typé, pas de session.
- Renvoi d'email trop fréquent → cooldown côté UI, en plus du rate-limit Supabase natif.
- Perte de l'authenticator TOTP par un admin → pas de codes de secours natifs côté Supabase MFA ;
  résolution par intervention `service_role` d'un autre admin/dev (retrait du facteur via l'API
  admin), à documenter comme procédure opérationnelle, pas une fonctionnalité self-service.
- Invitation consommée par quelqu'un d'autre entre le pré-contrôle du Route Handler et l'appel RPC
  (fenêtre de concurrence résiduelle) → compte créé mais sans rôle — cas rare, non dangereux (aucune
  capacité accordée), documenté plutôt que masqué.

## 10. Décisions tranchées / points ouverts

- **Front `apps/web`** — déféré (décision Jérôme, cette session), lot futur sur le même back-end.
- **Linking manuel explicite** — déféré, le linking automatique couvre le besoin exprimé.
- **SMTP de production** — dépendance opérationnelle hors code, à traiter quand un projet Supabase
  hébergé existera.
- **Codes de secours 2FA** — non fournis nativement par Supabase, pas reconstruits ici (cf. §9).
- **2FA obligatoire pour le rôle admin — rendu OPTIONNEL le 2026-08-15 (non conforme temporaire à
  `hifago/docs/03-cahier-des-charges-admin.md` §1)** : un vrai test par Jérôme sur son propre compte
  Google a révélé un bug bloquant à l'enrôlement (cause non isolée avec certitude — voir
  `hifago/CLAUDE.md` §12, entrée du 2026-08-15, pour le détail complet et la piste principale).
  `is_admin()` ne requiert plus l'AAL2 tant que la cause exacte n'est pas isolée et corrigée en
  conditions réelles (pas seulement via l'automatisation, qui n'a jamais reproduit le problème) ;
  les écrans `/mfa/enroll`/`/mfa/verify` restent fonctionnels en usage volontaire. **Point ouvert à
  rouvrir**, pas une décision définitive.

## 11. Annexe — traçabilité code→règle

### Sources ayant informé la spec

| Section | Fichiers sources |
|---|---|
| §1 Contexte (identité unifiée déjà prête) | `hifago/supabase/migrations/20260813161117_identity_core_tables.sql`, `20260813163438_identity_account_provisioning.sql`, `20260813163040_identity_invariants.sql` |
| §1 Contexte (décisions cahier des charges) | `hifago/docs/01-cahier-des-charges-client.md` §2, `02-cahier-des-charges-socio.md` §1, `03-cahier-des-charges-admin.md` §1, `04-architecture-cible.md` |
| §1 Contexte (référence legacy) | `docs/2-reference/01-architecture.md`, `02-app-partner.md` (endpoints `/api/auth`), `docs/4-pilotage/backlog.md` (carte C23, Google OAuth) |
| §3/§7 Bonnes pratiques | Documentation officielle Supabase (Server-Side Auth Next.js, Social Login Google, Password-based Auth, Email Templates, Identity Linking) |
| §7 Route Handler service_role | `hifago/packages/supabase/src/service.ts`, `hifago/apps/admin/app/api/upload/[entity]/route.ts` (patron repris) |
| §5 `/partner/join` | `hifago/apps/admin/app/partner/join/JoinForm.tsx`, `docs/specs/05-invitations-onboarding-dashboard-partenaire.md` |

### Fichiers réellement livrés

| Élément | Fichier |
|---|---|
| Config Supabase Auth (confirmations, Google, MFA, templates) | `hifago/supabase/config.toml`, `hifago/supabase/templates/{confirmation,recovery}.html`, `hifago/.env` (nouveau, gitignoré), `hifago/.env.example` (nouveau) |
| Migration `is_admin`/`has_admin_capability` (AAL2) | `hifago/supabase/migrations/20260815250000_admin_2fa_aal2.sql` |
| Migration `check_partner_invitation` | `hifago/supabase/migrations/20260815260000_check_partner_invitation_rpc.sql` |
| Seed — facteur TOTP fixe du compte admin de test | `hifago/supabase/seed.sql` (`auth.mfa_factors`) |
| Garde 2FA partagée | `hifago/apps/admin/lib/mfaGuard.ts`, branchée dans `app/admin/layout.tsx`, `app/partner/(app)/layout.tsx`, `app/page.tsx` |
| Bouton Google | `hifago/apps/admin/components/GoogleButton.tsx` |
| Callback OAuth + email | `hifago/apps/admin/app/auth/callback/route.ts` |
| `/login` (étendu) | `hifago/apps/admin/app/login/{page,LoginForm}.tsx` |
| `/signup` | `hifago/apps/admin/app/signup/{page,SignupForm}.tsx` |
| `/verify-email` | `hifago/apps/admin/app/verify-email/{page,ResendConfirmationForm}.tsx` |
| `/forgot-password` | `hifago/apps/admin/app/forgot-password/{page,ForgotPasswordForm}.tsx` |
| `/reset-password` | `hifago/apps/admin/app/reset-password/{page,ResetPasswordForm}.tsx` |
| `/mfa/enroll`, `/mfa/verify` | `hifago/apps/admin/app/mfa/{enroll,verify}/{page,MfaEnrollForm,MfaVerifyForm}.tsx` |
| Invitation-signup + adaptation JoinForm | `hifago/apps/admin/app/api/auth/invitation-signup/route.ts`, `app/partner/join/JoinForm.tsx` |
| Correctif dispatcher racine (repli mort → `/partner`) | `hifago/apps/admin/app/page.tsx` |
| Générateur TOTP + secret de test partagé (e2e) | `hifago/packages/e2e-support/src/mfa.ts`, `src/auth.ts` (complète le challenge MFA dans `signInAndCollectCookies`/`createSignedInClient`) |
| Tests e2e nouveaux | `hifago/apps/admin/e2e/auth-connection-complete.spec.ts` |
| Tests e2e adaptés (navigation directe au lieu de `.click()` sur le badge établissement) | `hifago/apps/admin/e2e/admin-invitations.spec.ts` |

### Écarts constatés en vérifiant réellement (navigateur piloté + Mailpit), non anticipés par le plan

- **`qrcode` non ajouté** : `mfa.enroll()` renvoie déjà un SVG prêt à l'emploi
  (`data.totp.qr_code`) — la dépendance envisagée aurait été une pure redondance.
- **Liens email sur `127.0.0.1` cassaient la navigation Playwright** (`baseURL` des tests =
  `localhost:3101`, distinct de `127.0.0.1` pour la protection `allowedDevOrigins` de Next 16) —
  templates et `additional_redirect_urls` alignés sur `localhost`.
- **`friendly_name` NULL dans le seed du facteur TOTP cassait TOUTE connexion**, pas seulement
  celle du compte concerné (`sql: Scan error ... converting NULL to string is unsupported` côté
  GoTrue) — corrigé en semant une chaîne vide, jamais NULL, comme le fait `mfa.enroll()` lui-même.
- **Repli mort du dispatcher racine** (`redirect("/partner/join")` pour un compte sans rôle) —
  détail au chapeau de ce document, corrigé vers `/partner`.
- Deux écrans existants (badge « Falta establecimiento » d'`admin-invitations.spec.ts`, revocation
  modal) ont montré une fragilité de clic déjà documentée ailleurs dans ce repo (`hifago/CLAUDE.md`
  §11) sous forte charge de données de test accumulées sur une session longue — confirmé sans lien
  avec ce lot (repasse systématiquement après un `db reset`), un test adapté en navigation directe.

### Écart connu, sans lien avec cette feature

`admin-partner-registry.spec.ts` (bascule du switch « código activo ») et une interaction entre
`admin-product-photos.spec.ts` et `admin-product-price-tiers.spec.ts` (établissement seedé absent
du select après le premier, hors sujet auth) restent les deux seules sources d'échec résiduelles
observées sur la suite complète — toutes deux déjà présentes avant ce lot ou reproduites sans lien
avec le code livré ici.

## 12. Documents liés

- `hifago/docs/01-cahier-des-charges-client.md` §2, `02-cahier-des-charges-socio.md` §1/§3b,
  `03-cahier-des-charges-admin.md` §1, `04-architecture-cible.md`.
- `docs/specs/04-gestion-images.md` — patron `service_role` réutilisé pour le Route Handler.
- `docs/specs/05-invitations-onboarding-dashboard-partenaire.md` — `JoinForm.tsx`,
  `consume_partner_invitation`, dashboard partenaire touchés par la garde 2FA.
- `docs/2-reference/02-app-partner.md`, `docs/4-pilotage/backlog.md` (C23) — référence de
  comportement de l'app legacy.
