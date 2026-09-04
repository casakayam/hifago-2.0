# Vague 6 — Agent A : les notifications toast

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.

---

```
Tu montes les notifications toast (succès / erreur) de la vitrine hifago (apps/web).

UN AUTRE AGENT TRAVAILLE EN CE MOMENT sur le calendrier (`components/molecules/Calendar.*`).
Périmètres disjoints — n'y touche pas.

## 0. À lire d'abord, dans cet ordre

1. ⚠️ `hifago/docs/specs/16-notifications-toast.md` **§0 « Contrat compact »** — il est écrit pour
   être lu SEUL, sans le reste de la spec. API, montage, CSS safe-area, pattern de conversion,
   invariants, cas limites. Tout y est déjà tranché pour l'admin ; tu portes la même décision à la
   vitrine, tu ne la rouvres pas.
2. ⚠️ `hifago/CLAUDE.md` §11 point 9 — le piège critique de ce composant précis. Lis-le en entier.
3. `apps/admin/app/layout.tsx` lignes 40-50 — le précédent qui marche, commentaire compris.
4. `hifago/apps/web/components/README.md` — les conventions.

## 1. Le constat qui justifie ce lot

⚠️ **`Toast.Provider` n'est monté NULLE PART dans `apps/web`.** Vérifié. Or
`app/[locale]/verify-email/ResendConfirmationForm.tsx:36,38` appelle déjà `toast.danger()` et
`toast.success()` — **ces deux notifications n'apparaissent donc jamais**. C'est un bug vivant, pas
une amélioration : le seul retour visuel de l'écran « renvoyer l'email de confirmation » est muet.

## 2. ⚠️ LE PIÈGE — lis-le deux fois, il rend la page BLANCHE sans une erreur

`Toast.Provider` n'est PAS un provider React classique. Son prop `children` est un **render-prop
consommé par Toast** à l'intérieur de `UNSTABLE_ToastRegion` — pas un slot pour le contenu de la
page. Écrire `<Toast.Provider>{children}</Toast.Provider>` fait retourner `null` à toute la région,
donc **à toute l'app**, tant qu'aucun toast n'existe :

- page blanche totale ;
- **aucune erreur console, aucune exception** ;
- `npm run build` et `next start` passent sans le moindre avertissement.

Ça ne se voit que dans un vrai navigateur. La forme correcte est un **SIBLING** de `{children}` :

    <body>
      {children}
      <Toast.Provider placement="bottom" />
    </body>

C'est ce que fait `apps/admin/app/layout.tsx:50`, avec le commentaire qui l'explique juste au-dessus.

## 3. Ton périmètre exclusif

apps/web/components/organisms/SiteToaster.tsx  + .stories.tsx + .test.tsx
packages/ui/src/styles/globals.css             ← UNIQUEMENT la règle safe-area (voir §5)

⚠️ **Tu ne modifies PAS `app/[locale]/layout.tsx`.** C'est une page, et le périmètre de ce chantier
exclut les pages. Tu livres le composant et tu dis dans ton rapport **la ligne exacte** à insérer et
où — le coordinateur s'en charge. (Même règle que pour le header, livré la veille.)

## 4. Le composant

`toast` et `Toast` sont exportés par `@hifago/ui` (le barrel réexporte `@heroui/react`) :

    import { toast } from "@hifago/ui";
    toast.success("Te enviamos un nuevo correo de confirmación.");
    toast.danger("No pudimos enviar el correo. Inténtalo de nuevo.");

⚠️ Une seule chaîne par appel, jamais `title` + `description` séparés — décision de la spec 16,
cohérente avec tous les messages déjà écrits dans le code (une phrase complète en espagnol).

Ce que `SiteToaster` apporte par rapport à un `<Toast.Provider>` posé nu :
- ⚠️ il rend le piège du §2 **impossible à rejouer** : il n'accepte pas de `children`, donc personne
  ne peut l'utiliser en wrapper. C'est la vraie raison d'être du composant — la même approche que
  `Image` qui rend `alt` obligatoire par le type, ou `IconButton` son `label`.
- `"use client"` obligatoire (il importe le barrel, CLAUDE.md §11.16) ;
- il fixe le `placement` pour toute la vitrine plutôt que de le laisser à chaque appelant.

⚠️ Réfléchis au placement pour une VITRINE, ne recopie pas `bottom` de l'admin par réflexe : sur
mobile, un toast en bas peut recouvrir le bouton principal d'un tunnel de réservation. Mesure-le
dans une story et argumente ton choix — c'est une vraie décision, pas un défaut à hériter.

## 5. Le CSS safe-area

La spec 16 pose une règle pour l'admin (`globals.css`, `@layer base`) :

    [data-theme="admin"] .toast-region--bottom, … { bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); }

⚠️ **Il n'y a pas d'équivalent `vitrine`.** Sans lui, un toast en bas passe sous la barre de
navigation d'un iPhone. Si tu retiens un placement bas, ajoute la règle scopée `vitrine` — et
**ne touche pas au bloc admin**, il est en préprod.

## 6. Quand un toast, et quand PAS un toast

⚠️ Lis le « Pattern de conversion » de la spec 16 §0 avant de répondre à ça.

La vitrine porte aujourd'hui **sept** messages d'erreur inline, écrits à la main en
`<p role="alert" className="text-sm text-danger">` : `LoginForm.tsx:50`, `SignupForm.tsx:94`,
`CheckoutForm.tsx:281,404`, `OrdersList.tsx:89`, `LodgingReservationForm.tsx:435,528`.

**Tu n'en convertis AUCUN** (ce sont des pages). Mais dis dans ton rapport, pour chacun, s'il
relève du toast ou doit rester inline — et pourquoi. Le critère n'est pas cosmétique : une erreur
attachée à un endroit précis de l'écran (« cette nuit n'est pas disponible ») doit rester à cet
endroit ; une erreur sur une action qui vient de se terminer (« le paiement a échoué ») est un
événement, donc un toast. Un toast qui remplace une erreur ancrée fait perdre le contexte.

⚠️ Signale aussi que ces sept `<p>` emploient `text-danger`, le jeton d'APLAT mesuré à 3.56:1 —
sous le seuil WCAG de 4.5:1. La correction équivalente a été faite le 2026-09-02 pour les messages
de CHAMP (`.error-message`, recalibrée dans le thème) mais ne couvre pas ces sept-là. Ne les
corrige pas, constate-le.

## 7. Les stories

⚠️ Une story de toast est particulière : le composant ne rend rien tant qu'aucun toast n'existe.
Il te faut donc des boutons qui en déclenchent — c'est la seule façon de le regarder.

- Un bouton « succès », un bouton « erreur », un bouton qui en empile plusieurs d'un coup.
- ⚠️ **Un message long**, en espagnol : c'est lui qui révèle le comportement en pleine largeur sous
  640 px.
- Les deux gabarits (390 / 1280), les deux modes clair/sombre, les cinq pistes.
- ⚠️ Vérifie que le toast n'est pas coupé par le bord de l'iframe Storybook et qu'il ne recouvre
  rien d'essentiel à 390 px.

Noms d'exports en français.

## 8. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run

Depuis `hifago/` :

    bash scripts/check-design-system.sh
    npm run build --workspace=apps/admin      ← prouve que la règle CSS n'a pas cassé l'admin

## 9. Ton rapport

1. Les fichiers créés ou modifiés.
2. **La ligne exacte à insérer dans `app/[locale]/layout.tsx`, et où** — que tu n'as pas modifié.
3. Le placement retenu et pourquoi, mesuré à 390 px.
4. Ta réponse au §6 : lesquels des sept messages relèvent du toast, lesquels restent inline.
5. Comment tu as rendu le piège du §2 impossible à rejouer.
6. Ce que tu as constaté sans corriger.
7. Le résultat exact des commandes du §8.

Tu ne commites pas.
```
