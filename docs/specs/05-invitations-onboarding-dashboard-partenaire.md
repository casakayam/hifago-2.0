---
id: specs-invitations-onboarding-dashboard-partenaire
titre: "Invitations partenaire : dashboard d'atterrissage, visibilité établissement, gestion admin"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-15
resume: >
  Le jeton d'invitation partenaire est déjà correctement séparé du mot de passe (vérifié dans le
  code, pas supposé) — cette spec comble les vrais écarts trouvés en creusant : aucune page
  d'accueil/dashboard n'existe après inscription, et rien ne rend visible/actionnable le cas
  Prestador sans établissement rattaché (mécanique déjà sûre, jamais exposée). Ajoute aussi la
  liste et la révocation des invitations côté admin, absentes aujourd'hui.
mots_cles: [invitation, onboarding, dashboard partenaire, jeton, token, établissement, revocation,
  partner_capabilities, hifago]
repond_a:
  - "Où atterrit un partenaire après avoir rejoint via une invitation ?"
  - "Comment l'admin sait-il qu'un Prestador invité attend un établissement ?"
  - "Comment l'admin suit-il et révoque-t-il une invitation déjà envoyée ?"
---

# Invitations partenaire : dashboard d'atterrissage, visibilité établissement, gestion admin

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). **Feature n°29** — numéro de build,
> distinct du `05-` de ce fichier qui est un compteur de docs. Dernière feature attribuée avant
> celle-ci : 28 (`docs/specs/03-admin-creation-etablissement.md`, 2026-08-14) ; la gestion d'images
> (`docs/specs/04-gestion-images.md`, 2026-08-15) n'a délibérément pas pris de numéro.
>
> **Implémentée le 2026-08-15**, spec rédigée puis codée dans la même session (précédent direct :
> spec 01/02, « on créé la spec mais on lance le dev complet directement »). Fichiers réels livrés
> en annexe §11.
>
> **Ajout le 2026-08-15** (même jour, remarque de Jérôme après la première livraison) : la case
> « J'accepte les conditions du rôle partenaire » de `/partner/join` n'avait aucun moyen de faire
> lire ce qu'elle engage — ajout d'un bouton « Voir les conditions » (hors de `Checkbox.Content`,
> qui est une zone entièrement pressable côté react-aria : un bouton imbriqué y aurait aussi
> basculé la case) ouvrant une modale, contenu factice (lorem ipsum) en attendant le vrai texte,
> commun aux deux chemins d'invitation. Au passage, `/login` (partagé admin+socio) est repassé en
> espagnol — il avait été construit en français par erreur, en suivant à tort la convention isolée
> de `/partner/join` plutôt que celle, dominante, du reste d'`apps/admin`.

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

Jérôme a signalé trouver « bête » qu'un code serve de mot de passe à l'inscription d'un partenaire
invité, avec une demande explicite de messages d'erreur clairs (lien expiré/déjà utilisé/jeton
invalide) et d'atterrissage direct sur un dashboard après inscription.

**Vérification faite directement dans le code (pas par déduction)** : ce n'est pas le cas.
`NewInvitationForm.tsx` (`hifago/apps/admin/app/admin/invitations/new/`) sépare déjà un `Código`
d'attribution (texte libre saisi par l'admin, jamais mis dans le lien envoyé) d'un **jeton opaque**
généré côté Postgres (`gen_random_bytes(32)`, seul son SHA-256 persiste dans
`partner_invitations.token_hash`) ; le lien envoyé ne contient que ce jeton
(`/partner/join?token=...`). `JoinForm.tsx` a un vrai champ `Mot de passe` (`type="password"`)
saisi par l'utilisateur ; le jeton n'est vérifié qu'en arrière-plan par une RPC séparée
(`consume_partner_invitation`), jamais comme credential. Comparé à Jérôme via deux maquettes ASCII
(jeton invisible vérifié avant affichage du formulaire vs. champ code visible saisi manuellement) —
confirmé que le comportement actuel (jeton invisible) est exactement ce qu'il veut. Les messages
d'erreur demandés existent déjà, typés et testés : `invitation_not_found`, `already_consumed`,
`already_revoked`, `expired`, `account_already_has_partner`, jeton absent de l'URL (formulaire
jamais affiché dans ce cas).

Ce n'est pas un hasard : c'est la reprise fidèle d'une décision déjà validée sur l'app legacy après
une faille identique — le code promo public y servait autrefois de seule preuve d'autorisation à
créer un compte (`docs/2-reference/08-known-gaps.md` G6), corrigée par la décision D15
(`docs/5-conception/registre-interne.md`) et l'architecture `docs/5-conception/roles-composables.md`
(approuvée 2026-07-17, livrée en prod sous la carte backlog C17). Hifago a donc déjà bien « refait »
ce point, pas réinventé.

En creusant plus loin — le cahier des charges socio (`hifago/docs/02-cahier-des-charges-socio.md`
§3b, validé par Jérôme le 2026-08-11) et le code réel des RPC — deux vrais écarts sont ressortis,
tous les deux **déjà actés dans une décision validée mais jamais construits ou jamais rendus
visibles** :

1. **Aucune page d'accueil/dashboard partenaire n'existe.** `JoinForm.tsx` affiche un message de
   bienvenue inline sur `/partner/join` puis ne redirige nulle part — `/partner` (racine) n'a même
   pas de `page.tsx`. Le cahier des charges cible pourtant *« il accède à son tableau de bord »*.
   C'est l'écart explicitement demandé par Jérôme.
2. **Le chemin « Prestador » ne rattache jamais d'établissement**, alors que le cahier des charges
   l'exige *« dans la même transaction que la création du compte »* avec un invariant anti-vol
   explicite (*« un établissement déjà rattaché à une autre identité n'est jamais volé
   silencieusement »*). En lisant les migrations réelles
   (`20260813211500_partner_capabilities_establishment_scope.sql`,
   `20260813220000_create_establishment_rpc.sql`), ce mécanisme **existe déjà et est déjà sûr** :
   `consume_partner_invitation` crée systématiquement une capacité `operator` « en attente »
   (`establishment_id = null`, index unique partiel qui interdit tout doublon) ; `create_establishment`
   (spec 03, écran admin déjà construit) rattache automatiquement cette capacité en attente dès que
   l'admin crée l'établissement pour ce partenaire — sans jamais pouvoir écraser un établissement
   déjà possédé par un autre partenaire (`establishments.partner_id not null`, RLS admin-only,
   `create_establishment` réservée à `is_admin()`). Le vrai problème n'est donc **pas la mécanique
   transactionnelle** (déjà correcte — la reconstruire en parallèle dupliquerait une logique déjà
   testée et risquerait de la contredire), mais sa **visibilité** : rien aujourd'hui ne montre à
   l'admin quels partenaires Prestador attendent un établissement. Un début d'alerte existe déjà
   côté home admin (Feature 27, `AdminAlerts.tsx`, compteur « Capacidades de prestador en
   revisión ») mais elle renvoie vers la liste générale `/admin/partners`, pas vers une action
   ciblée.

Constat additionnel : aucune liste ni révocation d'invitation n'existe côté admin — seul
`/admin/invitations/new` existe, aucun suivi de ce qui a été envoyé/consommé/expiré.

## 2. Portée

**In** :
- Dashboard partenaire minimal (`/partner`) : statut par rôle obtenu, raccourcis vers les écrans
  existants (Comisiones, Mis actividades, Herramientas).
- Redirection immédiate vers `/partner` après consommation réussie d'une invitation (remplace le
  message inline actuel de `JoinForm.tsx`).
- Liste paginée des invitations côté admin (`/admin/invitations`), avec statut, dates, et un badge
  actionnable « établissement manquant » pour un Prestador consommé sans établissement rattaché.
- Révocation d'une invitation `pending` par l'admin (nouvelle RPC).
- Mise à jour du lien de l'alerte home admin existante (« Capacidades de prestador en revisión »)
  vers cette nouvelle liste actionnable, et préremplissage du partenaire sur l'écran de création
  d'établissement déjà existant (spec 03) depuis le badge.

**Out, explicitement renvoyé ailleurs** :
- Connexion Google « en un clic » (prévue au cahier des charges socio §3b, jamais construite) —
  spec dédiée séparée.
- Ajouter un établissement supplémentaire à un partenaire déjà inscrit — le cahier des charges
  lui-même le laissait « à trancher au chiffrage » ; **tranché depuis par
  `docs/specs/06-gestion-etablissement.md`** (proposition modérée côté partenaire, un seul
  mécanisme pour le premier établissement comme pour un établissement supplémentaire).
- Inviter un coéquipier sur le même compte organisation — toujours hors périmètre, aucune décision
  prise.
- Reconstruction de la logique de rattachement établissement↔partenaire — déjà correcte (§1), on
  la rend seulement visible et accessible en un clic depuis l'admin.
- Contenu approfondi du dashboard (KPIs de vente personnels, historique détaillé) — cette spec pose
  le dashboard minimal et sa navigation, pas son contenu complet à terme.

## 3. Décisions retenues

Ne pas rouvrir :
- **Jeton invisible dans le lien, vérifié automatiquement avant affichage du formulaire** —
  confirmé par Jérôme via comparatif de maquettes. Aucun changement sur `create_partner_invitation`/
  `consume_partner_invitation`/le formulaire `JoinForm.tsx` autre que la redirection finale (§5.2).
- **Route group `(app)`** pour isoler `/partner/join` (doit rester accessible sans authentification,
  c'est le point d'entrée même de l'inscription) du reste de `/partner/*` (guardé) — un utilisateur
  non authentifié doit toujours pouvoir atteindre `/partner/join?token=...`.
- **Aucune nouvelle table ni colonne** pour le rattachement établissement — le mécanisme
  `partner_capabilities.establishment_id` + `create_establishment` (spec 03) est réutilisé tel quel,
  jamais dupliqué.
- **La liste des invitations ne nécessite aucune nouvelle RPC de lecture** — `partner_invitations`
  et `partner_capabilities` ont déjà une policy `select` admin (`partner_invitations_select_admin`,
  `partner_capabilities_select`, `hifago/supabase/migrations/20260813163456_identity_rls.sql`).
  Seule l'écriture (révocation) passe par une RPC, cohérent avec la checklist RPC-only du projet.

## 4. Parcours cible

**Côté partenaire invité** : clic sur le lien reçu → jeton vérifié en arrière-plan → formulaire
(nom/email/mot de passe) ou message d'erreur typé si le lien est invalide/expiré/déjà utilisé/
révoqué → soumission → redirection immédiate vers `/partner` → le dashboard reflète l'état réel au
chargement (rôle(s) obtenu(s), « en attente d'établissement » si operator sans `establishment_id`)
— pas de message éphémère à faire persister entre pages, plus robuste qu'un state perdu au refresh.

**Côté admin** : création d'invitation (écran déjà existant, inchangé) → suivi dans
`/admin/invitations` (statut en temps réel à chaque chargement) → si Prestador consommé sans
établissement, badge visible avec lien direct préremplie vers `/admin/establishments/new` → création
de l'établissement (écran déjà existant, spec 03) → rattachement automatique déjà géré par
`create_establishment`, aucune étape supplémentaire. Une invitation encore `pending` peut être
révoquée directement depuis cette liste.

## 5. Écran(s)

### 5.1 `/partner` — dashboard (nouveau)

Nouveau layout racine `apps/admin/app/partner/(app)/layout.tsx` (garde serveur unique + petite nav)
enveloppant `commissions/`, `products/`, `tools/` (déplacés sous `(app)/` — un route group ne
change pas l'URL, `/partner/commissions` reste `/partner/commissions`). `/partner/join` reste **hors**
de ce groupe, répertoire inchangé, jamais concerné par la garde.

Contenu de la home (`(app)/page.tsx`) : pour chaque capacité (`partner_capabilities` du partenaire
connecté, résolu via `partner_id_for_account`, même RPC que les écrans `/partner/*` existants) —
rôle (`referrer`/`operator`), statut (`onboarding`/`pending_review`/`active`/`suspended`), et pour
un `operator` avec `establishment_id null` un état explicite « en attente de rattachement
établissement » — au moment de cette spec, sans action self-service (le rattachement restait
admin-only, cf. spec 03 §3) ; **devenu actionnable depuis `docs/specs/06-gestion-etablissement.md`**
(lien vers `/partner/establishment/new`, proposition modérée) — le rattachement final reste
exclusivement écrit par `create_establishment`, seule la demande est désormais self-service.
Raccourcis vers Comisiones/Mis actividades/Herramientas (liens simples, pas de duplication de leur
contenu).

### 5.2 `JoinForm.tsx` (modifié)

Remplace l'état `roles` affiché inline par un `router.push("/partner")` immédiat dès que
`consume_partner_invitation` renvoie `ok: true`. Le reste du formulaire (champs, messages d'erreur
typés, jeton invisible) est inchangé (§3).

### 5.3 `/admin/invitations` (nouveau)

Liste paginée serveur (réutilise `resolvePageParams`/`ServerPagination`, `packages/domain`/
`packages/ui`, Feature 27) : code, type (Referente/Prestador), statut, créée le, expire le,
consommée le/par. Pour une ligne `status = consumed` et `onboarding_path = provider`, badge
« Falta establecimiento » si le partenaire résolu a une capacité `operator` avec `establishment_id
null`, avec lien direct vers `/admin/establishments/new?partner_id=<id>`. Bouton Révoquer sur les
lignes `pending` uniquement (RPC `revoke_partner_invitation`, §7).

Résolution du partenaire pour une invitation consommée : `partner_invitations.partner_id` si déjà
renseigné (cas `create_partner_direct`, Feature 26) ; sinon via
`partner_accounts.partner_id` où `id = consumed_by_account_id` (cas `create_partner_invitation`,
Feature 13 — cette RPC ne renseigne jamais `partner_invitations.partner_id` après consommation).

### 5.4 Sidebar admin (modifiée)

Ajout de `{ href: "/admin/invitations", label: "Invitaciones" }` à `NAV_ITEMS`
(`AdminSidebar.tsx`). `CREATE_ITEMS` déjà correct (`Nueva invitación` existe).

### 5.5 `AdminAlerts.tsx` (modifiée)

Le lien de l'alerte « Capacidades de prestador en revisión » pointe désormais vers
`/admin/invitations` au lieu de `/admin/partners` — un seul changement de `href`, la requête de
comptage existante sur la home admin reste inchangée.

### 5.6 `/admin/establishments/new` (modifiée, petit ajout)

Lit `searchParams.partner_id` optionnel et préremplit ce partenaire dans le `SearchableCombobox`
(spec 03) — pas de nouveau composant, simple valeur initiale transmise. Conservé tel quel après
`docs/specs/06-gestion-etablissement.md` : ce chemin reste le filet de sécurité si le partenaire ne
fait pas sa demande lui-même (ex : onboardé hors-ligne, jamais connecté au dashboard) — coexiste
avec la proposition self-service, ne la remplace pas.

## 6. Modèle de données

Aucune nouvelle table ni colonne — tout le nécessaire existe déjà :
`partner_invitations` (statut, dates, `partner_id` nullable, `consumed_by_account_id`),
`partner_capabilities.establishment_id` (nullable, « operator en attente »), `partner_accounts`
(résolution compte→partenaire). Seule nouveauté : la RPC `revoke_partner_invitation` (§7).

## 7. Contrat API/RPC

```sql
revoke_partner_invitation(p_invitation_id uuid) returns jsonb
```

Squelette identique à `create_partner_invitation`/`create_establishment` : `security definer`,
`set search_path = ''`, contrôle `is_admin()` interne (raise exception `42501` sinon), verrouillage
`select ... for update` sur la ligne ciblée (même ressource à protéger sous concurrence qu'une
consommation), refuse avec une raison typée si la ligne n'existe pas
(`invitation_not_found`) ou si son statut n'est déjà plus `pending`
(`already_<statut>`, même vocabulaire que `consume_partner_invitation`) ; sinon
`status = 'revoked'`, `log_admin_action('partner_invitation.revoke', 'partner_invitations',
p_invitation_id, ancien statut, null, null)`, retourne `{ok: true}`.

## 8. Règles et invariants

- `/partner/join` ne doit jamais exiger d'authentification — invariant testable en e2e (accès
  direct au lien sans session active, formulaire toujours atteignable).
- Une invitation `consumed` ou `expired` ne peut jamais être révoquée — seule la transition
  `pending → revoked` est permise, cohérent avec `consume_partner_invitation` qui refuse déjà tout
  statut autre que `pending`.
- Le rattachement établissement↔partenaire reste exclusivement via `create_establishment`
  (spec 03) — jamais de deuxième chemin d'écriture sur `establishments.partner_id` ou
  `partner_capabilities.establishment_id` introduit par cette feature.
- Toute écriture admin reste auditée (`log_admin_action`), invariant transverse déjà en vigueur
  (cahier des charges admin §4).

## 9. Cas limites

- **Révocation d'une invitation déjà consommée/expirée/révoquée** (double-clic, deux onglets admin
  ouverts) → erreur typée `already_<statut>`, pas de crash, le bouton se désactive après un premier
  succès.
- **Partenaire Prestador consommé mais compte supprimé entre-temps** (`consumed_by_account_id`
  introuvable dans `partner_accounts`) → aucun badge affiché pour cette ligne plutôt que de faire
  planter la liste — cas défensif, pas un flux normal.
- **Dashboard partenaire avec plusieurs capacités** (`referrer` + `operator`) → les deux statuts
  s'affichent, pas seulement le premier trouvé.
- **Description/adresse/photos non concernées ici** (déjà couvertes par la spec 03, écran
  inchangé sur ce point).

## 10. Décisions tranchées / points ouverts

- **OAuth Google « en un clic »** — reporté à une spec dédiée séparée (décision Jérôme,
  cette session) : sujet indépendant (config Supabase Auth, écran de choix), pas lié au périmètre
  demandé ici.
- **Ajout self-service d'un établissement supplémentaire** — laissé ouvert à l'écriture de cette
  spec (« à trancher au chiffrage »), **résolu depuis par `docs/specs/06-gestion-etablissement.md`**
  (proposition modérée, cf. §2 ci-dessus).
- **Multi-utilisateur par compte** (inviter un coéquipier sur le même compte organisation) — reste
  hors périmètre, aucune décision prise.
- **Contenu approfondi du dashboard partenaire** (KPIs de vente personnels au-delà du statut de
  rôle, historique) — laissé ouvert, cette spec pose seulement le dashboard minimal et sa
  navigation. À reprendre dans une future spec si le besoin se confirme.
- **Gardes redondantes dans `tools/layout.tsx`/`products/layout.tsx`/`commissions/layout.tsx`** —
  laissées telles quelles (déjà présentes avant cette feature, redondantes avec la nouvelle garde
  racine `(app)/layout.tsx` mais inoffensives) plutôt que retouchées, pour limiter le risque de
  régression sur des écrans déjà en production.

## 11. Annexe — traçabilité code→règle

### Sources ayant informé la spec

| Section | Fichiers sources |
|---|---|
| §1 Contexte (jeton vs mot de passe) | `hifago/apps/admin/app/admin/invitations/new/NewInvitationForm.tsx`, `hifago/apps/admin/app/partner/join/JoinForm.tsx`, `hifago/supabase/migrations/20260813230000_create_partner_invitation_rpc.sql`, `20260813171334_consume_partner_invitation_rpc.sql`, `20260814233000_partner_direct_creation.sql` |
| §1 Contexte (legacy, faille corrigée) | `docs/2-reference/08-known-gaps.md` (G6, G9), `docs/5-conception/registre-interne.md` (D14/D15/D16, invariant #18), `docs/5-conception/roles-composables.md` |
| §1 Contexte (établissement Prestador) | `hifago/docs/02-cahier-des-charges-socio.md` §3b, `hifago/supabase/migrations/20260813211500_partner_capabilities_establishment_scope.sql`, `20260813220000_create_establishment_rpc.sql` |
| §5.1 Dashboard, route group | `hifago/apps/admin/app/partner/{commissions,products,tools}/layout.tsx` (patron de garde existant), `hifago/apps/admin/app/admin/layout.tsx`+`AdminSidebar.tsx` (patron nav, Feature 27) |
| §5.3 Liste invitations, pagination | `docs/specs/02-admin-accueil-et-navigation.md` (`resolvePageParams`, `ServerPagination`) |
| §5.6 Préremplissage partenaire | `docs/specs/03-admin-creation-etablissement.md` (`SearchableCombobox`, `NewEstablishmentForm.tsx`) |
| §7 RPC | `hifago/supabase/migrations/20260813230000_create_partner_invitation_rpc.sql` (squelette repris), `hifago/CLAUDE.md` §3 (checklist RLS/RPC-only) |

### Fichiers réellement livrés

| Élément | Fichier |
|---|---|
| Route group + garde + nav partenaire | `hifago/apps/admin/app/partner/(app)/layout.tsx`, `PartnerNav.tsx` |
| Dashboard partenaire (home) | `hifago/apps/admin/app/partner/(app)/page.tsx` |
| Écrans déplacés sous le route group (URLs inchangées) | `hifago/apps/admin/app/partner/(app)/{commissions,products,tools}/` |
| Redirection post-inscription | `hifago/apps/admin/app/partner/join/JoinForm.tsx` |
| Migration RPC `revoke_partner_invitation` | `hifago/supabase/migrations/20260815160000_revoke_partner_invitation_rpc.sql` |
| Liste + révocation invitations admin | `hifago/apps/admin/app/admin/invitations/page.tsx`, `RevokeInvitationButton.tsx` |
| Préremplissage partenaire (création établissement) | `hifago/apps/admin/app/admin/establishments/new/page.tsx`, `NewEstablishmentForm.tsx`, `hifago/apps/admin/components/searchable-combobox.tsx` (initialisation paresseuse de `query`) |
| Sidebar admin (entrée Invitaciones) | `hifago/apps/admin/app/admin/AdminSidebar.tsx` |
| Alerte home admin (lien mis à jour) | `hifago/apps/admin/app/admin/AdminAlerts.tsx` |
| Tests e2e nouveaux/adaptés | `hifago/apps/admin/e2e/admin-invitations.spec.ts` (nouveau), `partner-join.spec.ts`, `admin-partner-offboarding.spec.ts`, `admin-home-navigation.spec.ts` (route `/admin/invitations` ajoutée à `SIDEBAR_ROUTES`) |
| Modale conditions (ajout du 2026-08-15) | `hifago/apps/admin/app/partner/join/PartnerTermsModal.tsx` (nouveau), `JoinForm.tsx` (bouton déclencheur) |
| `/login` repassé en espagnol (ajout du 2026-08-15) | `hifago/apps/admin/app/login/page.tsx`, `LoginForm.tsx` |

### Écart connu, sans lien avec cette feature

`admin-partner-registry.spec.ts` (bascule du switch « código activo », RPC
`set_partner_code_active`) échoue de façon reproductible, y compris juste après un `db reset`
complet — bug déjà consigné dans `docs/specs/01-admin-creation-partenaire.md` §11 et
`docs/specs/03-admin-creation-etablissement.md` annexe, observé une 4ᵉ fois en vérifiant cette
feature. Aucun fichier touché par cette feature (dashboard partenaire, invitations) n'est en
cause — non provoqué ni corrigé ici.

## 12. Documents liés

- `hifago/docs/02-cahier-des-charges-socio.md` §3b (invitations et onboarding, validé 2026-08-11).
- `docs/2-reference/08-known-gaps.md` (G6, G9) et `docs/5-conception/roles-composables.md` —
  précédent legacy de la faille code-comme-preuve-d'autorisation, déjà corrigée.
- `docs/specs/03-admin-creation-etablissement.md` — rattachement établissement réutilisé tel quel.
- `docs/specs/02-admin-accueil-et-navigation.md` — patrons sidebar/pagination/alertes réutilisés.
- `hifago/CLAUDE.md` §3 (checklist RLS/RPC-only), §12 (journal des features).
