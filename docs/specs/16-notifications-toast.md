---
id: specs-notifications-toast
titre: "Notifications toast succès/échec sur toute création/édition/suppression (admin + socio)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implémenté
maj: 2026-08-17 (suite — cluster différé converti, bug noValidate corrigé)
resume: >
  Remplace tous les messages inline (paragraphes role="alert"/role="status") par des popups toast
  HeroUI v3 (vert succès / rouge échec) sur toute action de création/édition/suppression d'
  apps/admin — admin, socio et écrans d'authentification. Toast natif HeroUI déjà installé, aucune
  nouvelle dépendance. Piège critique : Toast.Provider n'est pas un wrapper (cf. CLAUDE.md §11.9),
  et noValidate est requis sur chaque <form> pour que la validation JS (donc le toast) se déclenche
  au lieu d'être court-circuitée silencieusement par la validation native du navigateur.
mots_cles: [toast, notification, popup, succès, échec, HeroUI, Toast.Provider, admin, socio]
repond_a:
  - "Comment un écran admin/socio signale-t-il le succès ou l'échec d'une création/édition/suppression ?"
  - "Quel composant utiliser pour un nouveau message de succès/échec, plutôt qu'un texte inline ?"
  - "Quels écrans restent encore à convertir vers le toast, et pourquoi ?"
---

# Notifications toast succès/échec (admin + socio)

> **Cible stack** : Hifago (`apps/admin`, qui porte admin+socio+authentification dans une seule
> app). N'affecte pas `apps/web`.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### API

`toast` et `Toast` sont déjà exportés par `@hifago/ui` (`packages/ui/src/index.ts` fait
`export * from "@heroui/react"`, qui ré-exporte `toast`/`Toast.Provider` — vérifié dans le bundle
runtime installé, pas seulement les types). Import unique dans toute l'app :

```ts
import { toast } from "@hifago/ui";

toast.success("Establecimiento creado.");   // popup vert, disparaît après 4s
toast.danger("No se pudo crear el establecimiento.");   // popup rouge
```

`toast.success(message)`/`toast.danger(message)` prennent une simple chaîne (le titre visible du
toast) — pas de `title`/`description` séparés dans ce projet, un seul message complet par appel,
cohérent avec les messages déjà écrits partout dans le code (une phrase complète en espagnol).

### Montage (une seule fois pour toute l'app)

`apps/admin/app/layout.tsx` (Server Component racine) :

```tsx
import { Toast } from "@hifago/ui";
// ...
<body ...>
  {children}
  <Toast.Provider placement="bottom" />
</body>
```

**`Toast.Provider` en SIBLING de `{children}`, JAMAIS en wrapper autour** — piège critique détaillé
en CLAUDE.md §11 point 9 : son prop `children` est un render-prop consommé PAR TOAST à l'intérieur
de `UNSTABLE_ToastRegion`, pas un slot pour le contenu de la page. Lui passer `{children}` de la
page fait retourner `null` à toute la région (donc à toute l'app) tant qu'aucun toast n'existe —
page blanche totale, zéro erreur console, indétectable au typecheck/build (ne se manifeste que dans
un vrai navigateur). Un seul point de montage couvre `/admin/*`, `/partner/*` et les écrans
d'authentification — le layout racine ne se démonte jamais entre deux routes de la même app, donc
un toast survit à un `router.push()`.

### CSS (safe-area mobile)

`packages/ui/src/styles/globals.css`, dans `@layer base`, scopé `[data-theme="admin"]` :

```css
[data-theme="admin"] .toast-region--bottom,
[data-theme="admin"] .toast-region--bottom-start,
[data-theme="admin"] .toast-region--bottom-end {
  bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
}
```

Le reste du comportement responsive (pleine largeur sous 640px, empilement, timeout 4s) est déjà
géré par HeroUI, sans configuration supplémentaire.

### Pattern de conversion (répété sur chaque écran)

0. **Ajouter `noValidate` sur la balise `<form>`.** Piège critique (constaté 2026-08-17, retour
   direct de Jérôme après le premier passage de cette conversion) : un champ `isRequired`/`required`
   (HeroUI `TextField`/`Input`, ou `type="number" min={...}`) déclenche la validation NATIVE du
   navigateur, qui bloque silencieusement la soumission — le `onSubmit` React (donc `handleSubmit`,
   donc `toast.danger(...)`) ne s'exécute jamais, aucun feedback n'apparaît (ni toast, ni l'ancien
   message inline). Sans `noValidate`, la conversion toast est incomplète même si le reste du
   pattern (1-5 ci-dessous) est appliqué correctement — reproduit sur `product-form.tsx` (champ
   "Precio" avec `min={1}`), corrigé sur les 21 formulaires `onSubmit` de l'app en une seule fois.
1. Importer `toast` depuis `@hifago/ui`.
2. Retirer tout `useState` d'erreur/succès dont le SEUL rôle est d'afficher un message texte.
   Garder un état qui sert aussi à autre chose (ex. désactive un bouton, gate un lien de secours).
3. `setError("...")` → `toast.danger("...")` (texte inchangé).
4. Succès silencieux (`router.push`/`router.refresh()` seul) ou texte inline (`role="status"`,
   span "Guardado.") → ajouter `toast.success("...")` juste avant.
5. Retirer le JSX `{error ? <p role="alert">...}` / `{success ? <p role="status">...}` devenu mort.
6. **Une seule exception** : contenu généré par l'action et destiné à être copié/réutilisé (lien
   d'invitation, QR, checklist d'étapes déjà faites) — reste affiché sur la page, le toast s'ajoute
   en plus pour l'instant de confirmation, il ne remplace jamais ce bloc fonctionnel.

### Invariants

- Aucun message de résultat d'action (succès/échec d'un create/edit/delete) ne s'affiche
  exclusivement en texte inline dans la page — toujours un toast (sauf l'exception §0.6).
- Messages en espagnol, cohérents avec 100% du texte existant d'`apps/admin` (app non localisée).
- `toast.success`/`toast.danger` ne remplacent jamais un contenu fonctionnel généré par l'action
  (lien copiable, QR, historique d'étapes).
- Un seul `Toast.Provider`, monté à la racine — jamais un second Provider imbriqué dans une
  sous-route.

### Cas limites

- Action qui redirige immédiatement après succès (`router.push`) : le toast est déclenché *avant*
  le push — comme le queue de toast est un singleton indépendant du cycle de vie du composant
  routé, il survit et s'affiche sur la page de destination.
- Reclassement d'une photo par flèches ‹ › dans `MediaGallery` : **a bien un `toast.success`**
  ("Foto reordenada.") comme l'ajout ("Foto añadida.") et la suppression ("Foto eliminada.") du même
  fichier. Une première version en avait fait une exception délibérée (jugée trop bruyante pour une
  action répétitive) — retirée après audit du 2026-08-17 : l'invariant "toute action a un toast de
  succès" prime sur ce jugement esthétique, l'incohérence avec les deux fonctions sœurs du même
  fichier était plus gênante que le bruit visuel.
- Connexion (`LoginForm`) et vérification MFA (`MfaVerifyForm`) : pas de `toast.success` — action
  suivie d'une redirection immédiate vers le tableau de bord, un toast y ajouterait un signal sans
  valeur. `toast.danger` reste présent sur l'échec.
- Erreur avec action de secours (ex. `DeleteProductButton` sur un produit déjà commandé, lien
  "Despublícala en su lugar") : le toast rouge s'ajoute, mais le bloc inline avec le lien reste
  affiché (contenu actionnable, pas un simple message).

### Fichiers touchés

Tous convertis — voir §11 pour la liste complète par domaine : fondation (`layout.tsx`,
`packages/ui/src/styles/globals.css`), `media-gallery.tsx` (8 écrans photo), établissements admin,
produits admin (dont `product-form.tsx`, les 3 parcours), partenaires, invitations, tags,
campagnes, commandes, réconciliation, disponibilité partagée, authentification (7 écrans), les 5
formulaires de modération, et tout le domaine socio établissement/produits/join. `noValidate`
ajouté sur les 21 formulaires `onSubmit` de l'app (cf. §0 point 0).

---

## 1. Contexte et problème

Avant cette feature, `apps/admin` (admin + socio + authentification, une seule app) n'avait
**aucun** mécanisme de popup — confirmé exhaustivement par lecture directe de ~60 écrans/
composants. Le feedback était binaire et incomplet : un échec s'affichait en texte inline
(`<p role="alert">` ou `<ErrorMessage>` HeroUI), un succès était presque toujours **silencieux**
(juste `router.push()`/`router.refresh()`, sans aucun message), et quelques écrans remplaçaient
tout le formulaire par un texte de statut au lieu de naviguer. Jérôme a demandé explicitement une
popup verte/rouge pour toute création/édition/suppression, admin et socio confondus, avec un
message explicite — et a précisé en cours d'échange que le toast **remplace** le message inline,
il ne s'y ajoute pas (*« je ne veux pas de message dans l'app, tout sur des toaster »*). Le
périmètre a été confirmé étendu aux écrans d'authentification.

## 2. Portée

**In** : toute la surface `apps/admin` — écrans admin (établissements, produits, partenaires,
tags, invitations, campagnes, commandes, réconciliation, modération de propositions), écrans
socio/partenaire (propositions établissement/produit, photos, retrait de proposition, join), écrans
d'authentification (signup, login, mot de passe, MFA, renvoi email), disponibilité/calendrier
partagé.

**Out** : `apps/web` (vitrine publique cliente, hors du périmètre "plateforme admin (partners
aussi)").

## 3. Décisions retenues

1. Toast natif HeroUI v3 (`@heroui/react@3.2.4`, déjà la dépendance socle du projet) — aucune lib
   externe (`sonner`, `react-hot-toast`), aucun composant à construire dans `packages/ui`.
2. Message = toast uniquement, jamais un ajout à côté d'un message inline conservé (sauf
   l'exception §0.6 — contenu fonctionnel généré par l'action).
3. Messages en espagnol, réutilisant/adaptant le texte déjà écrit dans le code (aucun message
   inventé de zéro).
4. Pas d'abstraction nouvelle (pas de hook `useMutationFeedback` maison) — appel direct
   `toast.success`/`toast.danger` au même point où `setError(...)` était déjà appelé, cohérent avec
   le style du repo (chaque formulaire réimplémente déjà son propre `handleSubmit`).
5. `Toast.Provider` monté une seule fois, à la racine — pas un par sous-route.

## 4. Parcours cible

1. L'utilisateur (admin ou socio) déclenche une création/édition/suppression (soumet un
   formulaire, confirme une suppression dans une modale, bascule un statut).
2. L'appel réseau (RPC Supabase ou Route Handler) se termine.
3. Échec → `toast.danger("<message explicite>")`, popup rouge en bas d'écran, disparaît après 4s
   ou peut être fermée manuellement (desktop).
4. Succès → `toast.success("<message explicite>")`, popup verte, même comportement. Si l'action
   redirige (`router.push`), le toast survit à la navigation.
5. Si l'action produit un contenu à conserver (lien d'invitation, QR), ce contenu reste affiché sur
   la page en plus du toast de confirmation.

## 5. Écran(s)

Voir le tableau détaillé du plan d'exécution et §11 ci-dessous — l'inventaire complet (domaine par
domaine, fichier par fichier) a été établi par lecture exhaustive avant conversion, puis re-vérifié
une seconde fois sur 6 angles morts probables (actions inline de liste, pages détail, écran de
profil, actions en masse, éditeurs purs) : aucun point CRUD supplémentaire trouvé.

## 10. Décisions tranchées / points ouverts

**Résolu — cluster initialement différé pour collision, converti dans une deuxième passe.** Au
premier passage de ce chantier, une autre session travaillait activement et simultanément sur
`apps/admin/components/product-form.tsx`, `tags-multiselect.tsx`, les 5 formulaires de modération
de proposition, et tout le domaine socio établissement/produits/join — travail non commité,
laissé intact (cf. `AGENTS-PARALLELES.md` règle 4 : pas de garde-fou git sur un fichier non commité
modifié des deux côtés). Cette décision a laissé un vrai trou fonctionnel : la création d'une
activité depuis l'espace partenaire (exactement `product-form.tsx`) n'avait ni toast de succès ni
toast d'échec — signalé directement par Jérôme après test réel. Le travail de l'autre session
s'étant stabilisé (plusieurs vérifications de `git status`/timestamp de fichier espacées dans le
temps, confirmées par sa propre entrée de journal de fin de session), le cluster a été converti en
suivant exactement le pattern §0, fichier par fichier avec re-vérification de fraîcheur juste avant
chaque édition (deux fichiers restés hors périmètre à ce moment précis, `EstablishmentPhotosSocioBlock.tsx`/
`ProductPhotosSocioBlock.tsx`, se sont révélés ne nécessiter aucune édition — passthrough pur vers
`MediaGallery`, déjà couvert).

**Tranché — bug racine noValidate.** En testant la conversion `product-form.tsx` réellement dans un
navigateur (pas seulement au typecheck), un second trou est apparu : plusieurs champs `isRequired`
déclenchent la validation NATIVE du navigateur, qui bloque la soumission AVANT que le `onSubmit`
React ne s'exécute — ni l'ancien message inline ni le nouveau toast ne se déclenchaient jamais dans
ce cas précis. `noValidate` ajouté sur les 21 formulaires `onSubmit` de toute l'app (pas seulement
`product-form.tsx`) pour éliminer la classe de bug entière plutôt qu'un seul cas — la validation JS
déjà en place (donc les appels `toast.danger`) couvre exactement les mêmes règles, sans dépendre
d'un mécanisme navigateur qui contredit l'exigence de Jérôme (« tout sur des toaster »).

**Tranché** : les auteurs des messages toast ont réutilisé le texte déjà existant dans le code
(pas de nouveau glossaire) — cohérence avec le reste de l'app sans effort de traduction/rédaction
supplémentaire.

## 11. Annexe — traçabilité code→règle

| Domaine | Fichiers convertis | Statut |
|---|---|---|
| Fondation | `apps/admin/app/layout.tsx`, `packages/ui/src/styles/globals.css` | fait |
| Galerie photo (8 écrans d'un coup) | `packages/ui/src/components/media-gallery.tsx` | fait |
| Établissements (admin) | `NewEstablishmentForm.tsx`, `EstablishmentEditBlock.tsx` | fait |
| Produits (admin) | `DeleteProductButton.tsx`, `ProductHotelRoomsBlock.tsx`, `ProductSlotRulesBlock.tsx`, `ProductTagsBlock.tsx`, `ProductStatusBlock.tsx` | fait |
| Partenaires | `NewPartnerForm.tsx`, `CapabilitiesSection.tsx`, `CodesSection.tsx`, `EstablishmentsSection.tsx`, `OffboardingChecklist.tsx` | fait |
| Invitations | `NewInvitationForm.tsx`, `RevokeInvitationButton.tsx` | fait |
| Tags | `NewTagForm.tsx`, `DeleteTagButton.tsx`, `RenameTagButton.tsx` | fait |
| Campagnes | `NewCampaignForm.tsx`, `ProcessBatchButton.tsx` | fait |
| Commandes / réconciliation | `ChangeStatusDialog.tsx`, `ResolveEntryDialog.tsx` | fait |
| Disponibilité partagée | `availability-calendar.tsx` (`AvailabilityFormFields`) | fait |
| Authentification | `SignupForm.tsx`, `LoginForm.tsx`, `ResetPasswordForm.tsx`, `ForgotPasswordForm.tsx`, `MfaEnrollForm.tsx`, `MfaVerifyForm.tsx`, `ResendConfirmationForm.tsx`, `GoogleButton.tsx` (trouvé par l'audit du 2026-08-17 — échec `signInWithOAuth` avant redirection, zéro feedback, 4 écrans consommateurs), `login/page.tsx`+`LoginForm.tsx` (échec de callback OAuth `?error=auth_callback_failed`, trouvé lors de la vérification finale du 2026-08-17 — message inline `role="alert"` sur un Server Component, converti en `toast.danger` déclenché au montage côté client, garde `useRef` contre le double-montage React StrictMode en dev) | fait |
| Produits (formulaire principal, 3 parcours) | `product-form.tsx`, `tags-multiselect.tsx` (`hotel-rooms-editor.tsx`/`product-photos-staged.tsx` : passthrough `MediaGallery` pur, déjà couverts, zéro édition nécessaire) | fait |
| Modération de propositions | 5 fichiers `proposals/[id]/Moderate*Form.tsx` (écran de remplacement retiré, toast + `router.push("/admin/proposals")`) | fait |
| Socio — établissement | `NewEstablishmentProposalForm.tsx`, `EditEstablishmentProposalForm.tsx`, `PendingCreationBanner.tsx` (`EstablishmentPhotosSocioBlock.tsx` : passthrough `MediaGallery`, déjà couvert) | fait |
| Socio — produits/join | `EditProposalForm.tsx`, `PendingProductCreationsList.tsx`, `JoinForm.tsx` (`ProductPhotosSocioBlock.tsx` : passthrough `MediaGallery`, déjà couvert) | fait |

E2E Playwright mis à jour en parallèle des composants convertis (pattern
`page.getByRole("alertdialog").filter({ hasText: "..." })`) : `admin-establishment-edit.spec.ts`,
`admin-product-create.spec.ts`, `admin-product-delete.spec.ts`, `admin-product-hotel.spec.ts`,
`auth-connection-complete.spec.ts`, `partner-availability.spec.ts`, `admin-moderate-proposal.spec.ts`,
`partner-establishment-proposals.spec.ts`, `partner-propose-establishment-photo.spec.ts`,
`partner-propose-photo.spec.ts`, `partner-propose-product-creation.spec.ts` (les 5 derniers pour le
testid `moderation-success` retiré par la conversion des formulaires de modération).

`noValidate` ajouté sur les 21 formulaires `onSubmit` de l'app entière (pas seulement le cluster
converti dans cette deuxième passe) — voir §0 point 0 et CLAUDE.md §11 point 11.

## 12. Documents liés

- `hifago/CLAUDE.md` §2 point 6 (responsive obligatoire) — a guidé le choix `placement="bottom"` +
  padding `safe-area-inset-bottom`.
- `docs/specs/10-listes-standardisees-admin-socio.md` (brouillon) — composant `DataList`, sans
  rapport direct mais même logique de composant partagé à fort effet de levier que
  `media-gallery.tsx` ici.
- `AGENTS-PARALLELES.md` — règle ayant motivé la décision de différer le cluster §10.
