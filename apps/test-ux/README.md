# Bac à sable UX — hifago

Outil interne pour explorer les parcours UX du portail client (`apps/web`) **en conversation**,
sans écrire de code à la main. Wireframe bas-fidélité volontairement pauvre (gris, blocs
rectangulaires) — le sujet est la disposition et le parcours, jamais l'esthétique finale (couleurs
de marque, typographie), qui reste pilotée par `hifago/DESIGN.md` et le pipeline de design
séparé. Zéro dépendance, zéro build.

Ce n'est pas un composant HeroUI, pas un Storybook, pas un outil pour construire du vrai code —
juste un moyen rapide de dire "voilà où je veux que les choses soient" avant d'implémenter quoi
que ce soit pour de vrai.

## Ouvrir l'outil

Aucun serveur nécessaire : ouvre `index.html` directement dans un navigateur (double-clic, ou
`open index.html` / `open apps/test-ux/index.html` depuis le dossier `hifago/`).

## Utilisation

- **Sélecteur d'écran** (en haut) : saute directement à n'importe quel écran.
- **Clic sur un bloc** avec un lien (surligné en survol) : navigue vers l'écran cible — comme le
  mode "Present" de Figma. Le bouton retour du navigateur fonctionne aussi.
- **Gabarit** (Mobile / Tablette / Desktop) : force une largeur de prévisualisation, pour vérifier
  qu'un écran reste lisible sur mobile sans dupliquer les données — indépendant du redimensionnement
  réel de la fenêtre, qui fonctionne aussi (tout est responsive par défaut via flex/grid).
- Commence par l'écran **"Catalogue de blocs"** (`catalog`) : c'est la légende visuelle de tous les
  types de blocs disponibles, avec leur nom.

## Workflow — pour une future session Claude

Quand Jérôme décrit un écran en langage naturel dans un nouveau chat (ex. *"la home a un header
avec la barre de recherche centrée et le profil ; en dessous une liste de 3 activités avec un
bouton 'afficher plus' ; cliquer une activité ouvre la fiche détail"*) :

1. Ouvrir `screens.js` (le seul fichier à modifier pour ça — jamais `app.js`/`wireframe.css`).
2. Ajouter ou éditer une entrée dans `window.SCREENS` en suivant le schéma ci-dessous.
3. Dire à Jérôme de rafraîchir `index.html` dans son navigateur — aucune commande à lancer, pas de
   build, pas de redémarrage de serveur.

## Schéma d'un écran

```js
window.SCREENS.monEcran = {
  name: "Nom affiché dans le sélecteur et le fil d'ariane",
  route: "/chemin/reel/optionnel",   // juste indicatif, aucun effet fonctionnel
  blocks: [ /* arbre de blocs, voir ci-dessous */ ]
};
```

## Schéma d'un bloc

```js
{
  type: "...",        // obligatoire, voir la liste des types plus bas
  label: "...",       // texte affiché (titre, légende, placeholder…)
  variant: "...",     // optionnel, sens dépend du type (voir plus bas)
  onClick: "idÉcran", // optionnel — rend le bloc cliquable, navigue vers cet écran
  justify: "start" | "center" | "end" | "space-between",  // conteneurs seulement
  align: "start" | "center" | "end" | "stretch",           // conteneurs seulement
  gap: "sm" | "md" | "lg",
  wrap: true,          // autorise le retour à la ligne (conteneurs flex)
  grow: true,          // ce bloc prend l'espace disponible (ex. barre de recherche dans un header)
  width: "240px",      // rarement nécessaire — laisser flex/grid gérer la taille par défaut
  columns: 2,          // grid uniquement : 2/3/4 colonnes, se réduit automatiquement sur mobile
  repeat: 4,           // grid uniquement : répète `item` N fois (ex. une grille de résultats)
  item: { ... },       // grid uniquement : le bloc-modèle à répéter (utilisé avec `repeat`)
  children: [ ... ]     // pour les types conteneurs, la liste des blocs enfants
}
```

## Types de blocs disponibles

Ouvrir l'écran **"Catalogue de blocs"** dans l'outil pour les voir tous rendus. Résumé :

**Conteneurs** (acceptent `children`) :
- `row` — ligne flexible · `col` — colonne flexible
- `header` — bandeau du haut (justify par défaut : space-between) · `footer` — bandeau du bas
- `nav` — barre de liens
- `grid` — grille responsive (`columns` + soit `children` explicites, soit `repeat`+`item`)
- `card` — carte avec bordure/coin arrondi (photo + texte + prix, etc.)
- `list-item` — ligne de liste (avatar + texte, ligne de panier, etc.)

**Contenu** (feuilles) :
- `text` — `variant`: `title` | `subtitle` | `body` | `muted` | `price` | `label`
- `image` — placeholder photo (croix diagonale classique), `label` = légende
- `avatar` — cercle avec initiales (`label`)
- `badge` — pastille (`label`)
- `divider` — simple séparateur horizontal

**Interaction** (feuilles) :
- `button` — `variant`: `primary` | `secondary` | `ghost`
- `searchbar` — barre de recherche (visuelle uniquement, pas de vraie saisie)
- `select` — menu déroulant (visuel)
- `checkbox` — case à cocher (visuelle)
- `form-field` — libellé + zone de saisie (visuelle)

N'importe quel bloc (conteneur ou feuille) peut porter `onClick` pour devenir un hotspot de
navigation.

## Exemple — "3 activités avec un bouton afficher plus, clic → détail"

```js
{ type: "col", gap: "md", children: [
  { type: "text", variant: "subtitle", label: "Actividades cerca de ti" },
  { type: "grid", columns: 3, repeat: 3, item: {
      type: "card", onClick: "activityDetail", children: [
        { type: "image", label: "foto" },
        { type: "text", variant: "subtitle", label: "Nom de l'activité" },
        { type: "text", variant: "price", label: "$45.000" }
      ]
  }},
  { type: "button", variant: "secondary", label: "Ver más" }
]}
```

## Contenu de départ

`screens.js` contient déjà 4 écrans reconstitués depuis le vrai code (`CatalogBrowser.tsx`,
`ProductDetailView.tsx`, `CheckoutForm.tsx`) — `home` → `productDetail` → `checkout` →
`confirmation` — cliquables entre eux dès l'ouverture, pour montrer le mécanisme avant d'y toucher.
Ce sont des points de départ, pas des règles figées : les modifier librement fait partie de l'usage
normal de l'outil.

## Ce que cet outil n'est pas

- Pas un éditeur visuel avec glisser-déposer — le positionnement se pilote en éditant `screens.js`
  en conversation, pas à la souris (choix assumé, voir `hifago/CLAUDE.md` / le plan de design pour
  le contexte).
- Pas la page de test des vrais composants HeroUI (Storybook ou preview interne, décision séparée)
  — celle-ci teste de vrais composants ; ce bac à sable teste des parcours en blocs neutres.
- Pas relié à `npm install`/CI/Vercel — dossier `apps/test-ux/` volontairement sans `package.json`,
  ignoré par les workspaces npm, la CI et les déploiements existants.
