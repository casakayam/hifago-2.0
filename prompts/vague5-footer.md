# Vague 5 — Le footer

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.

---

```
Tu construis le footer de la vitrine hifago (apps/web). C'est un composant de design system, dans
Storybook — tu ne crées AUCUNE page et tu ne touches à AUCUNE route.

UN AUTRE AGENT TRAVAILLE EN CE MOMENT sur `components/atoms/Image.*` et
`components/molecules/PhotoStrip.*`. Pas de merge git entre vous : n'y touche pas.

## 1. Ton périmètre exclusif

apps/web/components/organisms/SiteFooter.tsx + .stories.tsx + .test.tsx
apps/web/messages/{es,en}/Chrome.json          ← tu AJOUTES des clés, tu n'en modifies aucune

## 2. À lire d'abord — le footer réutilise, il ne réinvente pas

Le header vient d'être livré. Lis-le avant d'écrire :

- `components/organisms/SiteHeader.tsx` — le ton, la structure, la façon de traiter le responsive.
- `components/organisms/LanguageSwitcher.tsx` — ⚠️ **tu le RÉUTILISES tel quel**, tu n'écris pas un
  second sélecteur de langue. Deux implémentations qui divergent, c'est le défaut classique
  header/footer.
- `components/atoms/LinkButton.tsx` et `IconLink.tsx` — les liens existants.
- `components/README.md` — les conventions font foi.

⚠️ Le `title` d'une story ne suit PAS le dossier : ton footer va dans `"Structure/SiteFooter"`
(convention du 2026-09-02, écrite au README).

## 3. Ce que Jérôme a demandé

- Une **bande de couleur**.
- Une **liste de liens texte** vers les pages institutionnelles.
- ⚠️ **Les libellés sont traduits, et la langue est prévue là aussi** — le `LanguageSwitcher` existant
  trouve sa place dans le footer, en plus du header.

## 4. Les liens

La liste n'est pas à inventer : elle est décidée dans `docs/01-cahier-des-charges-client.md`
(règle du 2026-08-11, ligne ~97) — **mentions légales, politique de confidentialité** (cadre Habeas
Data colombien), **contact**, **aide/FAQ**, et **CGV/CGU**.

⚠️ **Aucune de ces pages n'existe, et ce lot n'en crée aucune.** Les `href` sont donc des
destinations en attente. Deux conséquences à traiter explicitement :
- rassemble-les dans **une seule constante en tête de fichier**, pour qu'un seul endroit change le
  jour où les routes existent ;
- dis dans ton rapport que ces liens pointent vers du vide — un footer qui a l'air fini alors qu'il
  mène à cinq 404 est pire qu'un footer visiblement en chantier.

Deux ajouts tirés du site réel, à inclure :
- **WhatsApp** — le portail legacy en production le porte sur TOUTES ses pages ; c'est le canal de
  contact établi du projet. Lien externe.
- **La ligne d'identité** : « Hifago · Guatapé, Colombia ». Elle existe déjà dans le footer legacy.

## 5. La bande de couleur

⚠️ **Aucune couleur en dur.** Cinq pistes de thème sont montées et Jérôme n'a pas encore tranché
(`Playground/Palette`) : une couleur codée en dur serait fausse dans quatre cas sur cinq, et fausse
en mode sombre. Prends un jeton (`--surface-secondary`, `--accent`… à toi de voir) et dis lequel tu
as retenu et pourquoi.

Le footer doit tenir dans les cinq pistes, en clair comme en sombre. C'est le seul vrai test de ce
choix.

## 6. Contraintes

- Un vrai `<footer>`, et un `<nav>` avec un `aria-label` traduit autour de la liste de liens.
- Liens internes par le `Link` de `@/i18n/navigation` — jamais `next/link` nu. Lien WhatsApp externe :
  `LinkButton` impose déjà `rel` et la mention « nouvel onglet », sers-t'en plutôt que d'écrire un
  `<a>` à la main.
- **Pas de prop `className`.** Cibles tactiles ≥ 44 px.
- **Mobile d'abord** : à 390 px la liste s'empile, elle ne se comprime pas. ⚠️ Ne masque RIEN selon
  la largeur — Google indexe le mobile.
- Toute clé nouvelle existe dans `es` ET `en` (`messages/parity.test.ts` échoue sinon).
- `"use client"` seulement si tu importes `@hifago/ui` ou appelles un hook (CLAUDE.md §11.16).

## 7. Stories

Les deux langues, les deux modes, les gabarits 390 et 1280, et une story où le footer est **sous un
`PageShell` avec du contenu** — isolé, un footer ne dit rien.

## 8. Vérification

    npx tsc --noEmit
    npx eslint components
    npx vitest run

## 9. Ton rapport

Les fichiers créés, le jeton de couleur retenu et pourquoi, la confirmation que les cinq href
pointent vers du vide, comment tu as réutilisé `LanguageSwitcher`, et le résultat exact des
commandes.

Tu ne commites pas.
```
