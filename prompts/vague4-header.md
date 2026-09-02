# Vague 4 — Le header de la vitrine

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.
> Écrit le 2026-09-02, complété des réponses de Jérôme (§5). Prêt à lancer.

---

```
Tu construis le header de la vitrine hifago (apps/web). Il n'en existe AUCUN aujourd'hui : vérifié,
il n'y a ni `<header>`, ni `<nav>`, ni `<footer>` dans toute l'app. Tu pars de zéro.

D'AUTRES AGENTS TRAVAILLENT PEUT-ÊTRE EN CE MOMENT dans le même répertoire de travail (thème,
atome Image). Il n'y a pas de merge git entre vous : respecte strictement ton périmètre.

## 0. À lire avant d'écrire la première ligne

1. `hifago/AGENTS-PARALLELES.md` — les deux blocs.
2. `hifago/apps/web/components/README.md` — les conventions font foi.
3. ⚠️ `hifago/apps/web/components/atoms/Button.tsx`, `IconButton.tsx` et `LinkButton.tsx` — les
   trois ensemble. Ils fixent le vocabulaire (deux axes `variant`/`color`, `"use client"`, pas de
   prop `className`, rayon repris de `var(--radius)`, cible tactile de 44 px) et le §3.1 ci-dessous
   part d'un manque précis dans ce trio.
4. `hifago/apps/web/app/[locale]/layout.tsx` — c'est là que le header sera monté.

## 1. Ce que Jérôme a demandé, mot pour mot

- À GAUCHE : le **logo Hifago**, qui est aussi le retour à l'accueil.
- À DROITE : un **bouton panier** et un **bouton compte**, tous deux **ronds, avec une icône**.
- Le panier porte une **pastille avec un nombre**.
- ⚠️ **Le panier ouvre une PAGE, le compte en ouvre une autre.** Ce ne sont ni des menus déroulants
  ni des tiroirs : ce sont des navigations.
- Un **sélecteur de langue en dropdown CLASSIQUE, avec drapeaux** (espagnol de Colombie ↔ anglais).
- Le header est **collant**.
- ⚠️ **Une version mobile distincte** : logo, bouton panier, et un **bouton à icône qui ouvre un
  menu** — c'est ce menu qui porte le reste (langue, compte).

## 2. Ton périmètre exclusif

apps/web/components/organisms/SiteHeader.tsx        + .stories.tsx + .test.tsx
apps/web/components/organisms/LanguageSwitcher.tsx  + .stories.tsx + .test.tsx
apps/web/public/logo-hifago.svg                     ← provisoire, voir §5.1
apps/web/messages/es/Chrome.json  et  messages/en/Chrome.json   (namespace NOUVEAU)
apps/web/messages/index.ts        ← la seule ligne partagée que tu as le droit de toucher, pour
                                     brancher le namespace. Fais-le en un seul geste, en fin de lot.

Plus, selon ta réponse au §3.1 :
apps/web/components/atoms/IconButton.tsx (+ ses stories/tests) — extension autorisée, voir ci-dessous.

⚠️ `organisms/` existe et est vide. Le dossier est à toi.

## 3. Le point dur — il n'existe pas de LIEN en icône seule

### 3.1 Le manque, vérifié

Jérôme veut deux boutons ronds à icône **qui naviguent vers des pages**. Or dans le trio livré :

- `IconButton` est un vrai `<button>` — il a `shape="circle"` et un `label` accessible REQUIS, mais
  **aucun `href`** : il ne navigue pas.
- `LinkButton` navigue (interne via `@/i18n/navigation`, externe avec `rel` imposé) mais exige
  `children`, un libellé VISIBLE : **il n'a pas de mode icône seule**.

⚠️ **Ce que Jérôme demande n'est donc constructible avec aucun des deux.** Et la distinction n'est
pas cosmétique : un `<button>` qui navigue casse le clic-milieu, le « ouvrir dans un nouvel onglet »
et la copie de lien — sur une icône de panier, ce sont des gestes que les gens font réellement.

**À toi de trancher, et de le justifier en une phrase :** ajouter un `href` optionnel à
`IconButton` (il porte déjà la contrainte de `label` requis, qui est exactement ce dont un lien en
icône seule a besoin), étendre `LinkButton`, ou créer un troisième composant. ⚠️ Quelle que soit ta
réponse, **réutilise `buttonToneClasses`, `HEROUI_VARIANT` et `RADIUS_CLASS` exportés par
`Button.tsx`** : deux tables de couleurs qui divergent, c'est le défaut classique de cette famille.

⚠️ Si tu modifies `IconButton.tsx`, c'est une EXTENSION : tu n'as pas le droit de changer le
comportement existant ni de casser ses tests. Ils sont verts, ils doivent le rester.

### 3.2 La pastille du panier

⚠️ Ne la fabrique pas à la main. HeroUI fournit `Badge` avec exactement ce motif :
`Badge.Anchor` (l'élément sur lequel elle se pose), `Badge.Label` (le nombre), plus `placement`,
`color`, `size` et `variant`. Importé depuis `@hifago/ui`, jamais `@heroui/react`.

Points d'attention :
- ⚠️ **Un nombre affiché ne suffit pas à un lecteur d'écran** : « 3 » à côté de « panier » peut
  s'annoncer n'importe comment. Le nom accessible du lien doit porter le compte en toutes lettres
  (« Panier, 3 articles »), donc être une chaîne traduite avec un paramètre, pas une concaténation.
  Et le pluriel est une affaire de langue : next-intl sait le faire, sers-t'en.
- **Pastille absente quand le panier est vide** — pas un « 0 ». Un zéro permanent est du bruit.
- Prévois le grand nombre. Décide de ce qui se passe au-delà de deux chiffres et dis-le.

### 3.3 Le compte du panier vient d'un état client

`useCart()` (`lib/cart/CartContext.tsx`) expose `lines: CartLine[]`, chaque ligne portant un `qty`.
⚠️ Voir §5 pour ce que la pastille doit compter — c'est une décision de Jérôme, pas la tienne.

⚠️ **Conséquence structurelle** : le header lit un état client, donc il porte `"use client"`. Il
sera monté dans `app/[locale]/layout.tsx`, qui est un Server Component — c'est précisément le
montage que `CLAUDE.md` §11.16 exige (jamais d'import `@hifago/ui` dans un layout, toujours via un
fichier `"use client"` dédié). ⚠️ **Tu ne modifies PAS `layout.tsx`** : tu livres le composant, le
coordinateur le montera. Dis dans ton rapport où exactement il doit être inséré.

⚠️ **L'hydratation** : le panier vit côté client, donc le serveur rend un compte différent du
client au premier rendu. Regarde comment `CartContext` s'initialise avant de décider, et traite le
cas — une pastille qui clignote ou une erreur d'hydratation en console sont deux échecs.

### 3.4 Les icônes

⚠️ **N'importe PAS `lucide-react`.** Vérifié : il est dans `node_modules` mais déclaré par
`packages/ui`, PAS par `apps/web` — l'importer ici créerait une dépendance fantôme, exactement ce
qui a cassé le build Vercel le 2026-08-23 (le hoisting npm local la masque, l'install scopée de
Vercel la révèle).

Deux icônes suffisent (panier, compte) : écris-les en **SVG inline** dans ton composant. Elles
héritent de la couleur par `currentColor`, portent `aria-hidden` (le nom accessible est sur le
lien), et n'ajoutent aucune dépendance.

### 3.5 La sémantique

- Un vrai `<header>`, et un `<nav>` avec un `aria-label` traduit autour des deux liens de droite.
  Aujourd'hui l'app n'a aucun landmark : c'est ce composant qui les introduit.
- ⚠️ **Le logo n'est PAS un `<h1>`.** S'il l'était, les huit pages perdraient leur titre au profit
  de la marque. Le `h1` appartient au contenu de la page ; le logo est un lien vers l'accueil.
- Le lien du logo passe par `@/i18n/navigation` — jamais `next/link` nu, lui seul conserve le
  préfixe de locale.
- Cibles tactiles ≥ 44 px sur les trois éléments cliquables (README), y compris le logo.

### 3.6 Le sélecteur de langue — deux pièges vérifiés

`@/i18n/navigation` exporte `usePathname` et `useRouter` (créés par `createNavigation(routing)`),
et `routing.locales` vaut `["es", "en"]` avec `es` par défaut et le préfixe TOUJOURS présent.

⚠️ **Piège 1 — ne bascule PAS la langue avec `useRouter().replace()`.** Un sélecteur qui ne navigue
qu'en JavaScript ne produit aucun `<a href>` : un crawler ne peut pas suivre le lien, donc la
version anglaise n'est jamais découverte par ce chemin, et le sélecteur ne marche pas sans JS. Le
`Link` de `@/i18n/navigation` accepte une prop `locale` — `<Link href={pathname} locale="en">`
produit un vrai `/en/...`. C'est la forme à retenir. Le lot SEO livré le 2026-09-01 a coûté cher,
ne le défais pas avec un menu.

⚠️ **Piège 2 — les drapeaux en emoji ne s'affichent PAS sous Windows.** Le système n'embarque
aucun glyphe de drapeau : `🇨🇴` y rend deux lettres, « CO ». Si tu veux des drapeaux fiables, ce
sont des SVG inline (même raison qu'au §3.4 : aucune dépendance d'icônes). Mesure-le et dis ce que
tu as choisi.

⚠️ **La correspondance drapeau ↔ langue n'est pas évidente, et c'est une décision à rapporter.**
`es` est ici l'espagnol de COLOMBIE (le site vend à Guatapé) — le drapeau colombien est donc plus
juste que celui de l'Espagne. Pour l'anglais, aucun drapeau n'est correct (Royaume-Uni ? États-Unis ?
ni l'un ni l'autre ne « sont » l'anglais). **Le drapeau ne doit donc jamais être le seul porteur de
l'information** : le nom de la langue est écrit à côté, en toutes lettres et dans SA propre langue
(« Español », « English » — jamais traduit, sinon un anglophone perdu sur `/es` lit « Inglés »).
C'est la même règle que celle du README sur la couleur : jamais l'information portée par le seul
visuel.

⚠️ **N'utilise PAS le `Select` livré par la vague 3.** C'est un contrôle de FORMULAIRE : il porte
un `<select>` natif caché, une valeur, un `name`, et s'annonce comme un champ à remplir. Changer de
langue est une NAVIGATION, pas une saisie. Jérôme a demandé « un dropdown classique » : appuie-toi
sur `Dropdown`/`Menu` de HeroUI (`Menu`, `Menu.Item`, `Dropdown` — vérifiés présents), dont les
entrées peuvent être de vrais liens. Cible tactile ≥ 44 px sur chaque entrée.

### 3.7 La version mobile — et le piège qu'elle tend

Jérôme : sous le point de bascule, le header se réduit à **logo + panier + un bouton à icône qui
ouvre un menu**, ce menu portant la langue et le compte. Breakpoint de référence : `md` = 768 px
(défaut Tailwind v4, non personnalisé ici).

⚠️ **LE PIÈGE, et il touche directement le lot SEO livré la veille.** `components/README.md`
interdit de masquer du contenu selon la largeur, parce que **Google indexe la version mobile**.
Ici la conséquence est précise : les liens du sélecteur de langue sont des `<a href="/en/...">`, et
ce sont eux qui font découvrir la version anglaise par le maillage interne. Si le menu mobile est
**monté à la demande** (rendu seulement après un clic), ces liens **n'existent pas dans le DOM que
Googlebot voit** — puisqu'il voit le rendu mobile.

Donc : **le contenu du menu est TOUJOURS dans le HTML**, seulement masqué visuellement quand le
menu est fermé (`hidden` sur un conteneur déjà rendu, une `disclosure`, un `dialog` monté). Jamais
un rendu conditionnel `{ouvert && <Menu/>}`. Vérifie-le en inspectant le HTML SERVI, pas le DOM
après hydratation — ce n'est pas la même chose et c'est le second qui ment.

⚠️ **On ne duplique pas le header.** Deux balisages `<header>` — un mobile, un desktop — dont l'un
est masqué, c'est deux fois les mêmes liens dans le DOM : contenu dupliqué, deux fois les mêmes
cibles pour un lecteur d'écran, et deux versions qui divergeront. Un seul balisage qui se
réorganise.

⚠️ **L'icône « paramètres ».** Jérôme parle d'un « bouton avec icône param ». Un engrenage annonce
des RÉGLAGES, or il n'y en a aucun sur ce site : ce bouton ouvre un menu. Choisis le glyphe qui dit
ce que le bouton fait, signale ton choix, et laisse Jérôme trancher au rendu. Dans tous les cas le
nom accessible est explicite et traduit (« Menu »), jamais le seul glyphe.

Le comportement d'ouverture doit être complet, pas approximatif : `aria-expanded` sur le bouton,
fermeture par `Échap`, focus rendu au bouton à la fermeture, et le focus qui ne part pas derrière
le panneau. Si tu t'appuies sur `Drawer`/`Popover` de HeroUI (react-aria), tu obtiens ça gratuitement
— dis ce que tu as retenu.

## 4. Traductions

Namespace **`Chrome`**, nouveau, dans `messages/es/Chrome.json` et `messages/en/Chrome.json`.
⚠️ Toute clé existe dans les DEUX langues — `messages/parity.test.ts` échoue sinon, et il vérifie
aussi qu'un namespace créé sur disque a bien été branché dans `messages/index.ts`.

⚠️ Le header est un composant client : il appelle `useTranslations("Chrome")` lui-même, il ne reçoit
pas de chaînes en props (règle du README : c'est l'inverse pour un composant qui traverse la
frontière RSC).

⚠️ **Tu es le premier composant du design system qui traduit.** Plus rien ne vérifie aujourd'hui
que la chaîne i18n fonctionne dans Storybook — la seule story qui l'exerçait a été supprimée. Si
`useTranslations` casse dans le playground, c'est chez toi que ça se verra : le provider est dans
`.storybook/preview.tsx`, ne le modifie pas, signale.

## 5. Les décisions de Jérôme (2026-09-02) — tranchées, tu les appliques

**5.1 Logo.** Il n'existe pas encore. ⚠️ **Aucun logo Hifago n'est dans `apps/web/public/`** —
seulement les SVG par défaut de Next (file, globe, next, vercel, window). Pour ce lot :
**crée un SVG provisoire portant le mot « hifago »**, écrit en toutes lettres, et pose-le dans
`public/`. Il sera remplacé par le vrai. Deux conséquences à traiter, pas à contourner :
- le SVG porte du texte, donc il doit rester lisible à toutes les tailles et suivre la couleur du
  thème (`currentColor` plutôt qu'un noir codé en dur — il devra tenir en mode sombre) ;
- ⚠️ vérifié au lot précédent : `next/image` jette `sizes` ET `srcset` sur une source SVG. Un logo
  n'a de toute façon pas besoin d'être optimisé — dis simplement comment tu le rends et pourquoi.

**5.2 Langue.** ⚠️ **Un sélecteur déroulant avec drapeaux**, espagnol de Colombie ↔ anglais, dans
le header. Voir §3.6 : deux pièges vérifiés, et une contrainte d'accessibilité.

**5.3 Bouton compte.** **Déconnecté → la page de connexion. Connecté → la page du compte.**
⚠️ L'architecture des pages de compte sera revue plus tard (décision explicite de Jérôme) : vise
`/account/orders`, la seule page de compte qui existe aujourd'hui, et **isole cette destination
dans une constante** pour qu'un seul endroit change le jour où elle bouge.

⚠️ Le header est un composant client : il ne peut pas appeler `supabase.auth.getUser()` lui-même
(c'est ce que fait `checkout/page.tsx:27`, un Server Component). L'état de connexion doit donc lui
**arriver en prop**, résolu côté serveur — comme `CheckoutForm` reçoit déjà `isAuthenticated`.
C'est le layout qui le lui passera ; dis dans ton rapport ce qu'il doit résoudre.

**5.4 La pastille.** Elle compte **ce que le visiteur a sélectionné**, donc **le nombre de lignes du
panier** — pas la somme des `qty`. Une réservation « Paseo en lancha, 3 personnes » est UNE chose
sélectionnée, pas trois. ⚠️ Écris-le dans ton commentaire d'en-tête : c'est le genre de décision
qu'un futur lecteur inversera « pour corriger un bug » s'il ne trouve pas la raison.

**5.5 La page du panier.** ⚠️ Vérifié : **aucune route `/cart` n'existe**. `/checkout` est la seule
page qui affiche les lignes du panier aujourd'hui — vise-la, et **isole-la dans une constante**
comme au §5.3 : l'architecture des pages sera revue.

**5.6 Header collant.** Oui. ⚠️ Deux choses à traiter, pas à supposer :
- il mange de la hauteur sur un écran de 844 px — mesure ce qu'il prend réellement et rapporte-le ;
- une barre fixe passe AU-DESSUS du contenu : vérifie qu'elle ne recouvre pas le premier élément
  d'une page, et que l'ancre de focus au clavier ne disparaît pas dessous.

**5.7 Footer.** **Hors périmètre**, lot suivant. Ne le crée pas, même en ébauche.

## 6. Les stories

- Panier vide, 1 article, plusieurs, et un nombre à deux chiffres et plus.
- Connecté / déconnecté.
- ⚠️ Aux gabarits **Mobile 390** et **Desktop 1280** — c'est à 390 px que trois éléments et une
  pastille se marchent dessus.
- Les deux langues (l'espagnol fait 20 à 25 % de plus que l'anglais).
- Clair et sombre.
- Le sélecteur de langue **ouvert**, pas seulement fermé — c'est ouvert qu'on voit s'il déborde.
- ⚠️ **Le menu mobile ouvert ET fermé**, au gabarit 390 : c'est le cœur de ce lot, et ouvert il
  peut recouvrir le contenu ou déborder.
- Une story qui montre le header **au-dessus d'un `PageShell` avec assez de contenu pour défiler**,
  pas isolé : c'est la seule qui révèle l'alignement, la hauteur réelle, et surtout que le header
  collant ne recouvre rien.

Noms d'exports en français.

## 7. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run                 ← dont messages/parity.test.ts

Puis au rendu : les deux gabarits, les deux langues, les deux modes, panneau a11y sans violation,
aucun défilement horizontal.

## 8. Ton rapport

1. Les fichiers créés ou étendus.
2. **Ta réponse au §3.1** : comment tu as obtenu un lien en icône seule, et pourquoi cette
   solution-là.
3. Comment le compte du panier est annoncé à un lecteur d'écran, et comment tu l'as vérifié.
4. Ce que tu as fait du décalage d'hydratation, mesuré et non supposé.
5. Où exactement le header doit être inséré dans `layout.tsx` (que tu n'as pas modifié).
6. Si la chaîne i18n de Storybook a fonctionné du premier coup.
7. Ce que tu as constaté sans corriger.
8. **Le HTML SERVI du menu mobile fermé** (§3.7) : montre que les liens de langue y sont, en
   citant la sortie — c'est la seule preuve qui compte, le DOM après hydratation ne dit rien.
9. Le glyphe retenu pour le bouton de menu, et pourquoi.
10. Le résultat exact des commandes du §7.

Tu ne commites pas.
```
