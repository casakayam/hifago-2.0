# Suite — une cinquième piste : flashy, bordure noire, fond blanc

> À coller dans le chat de l'agent thème. Il connaît déjà le fichier et sa mécanique.

---

```
Jérôme a regardé tes quatre pistes et en demande une CINQUIÈME, dans une direction que tu n'as pas
couverte. Ses mots : « une nouvelle flashy, bordure noire, fond blanc de base, et des couleurs
flashy jaune rouge vert bleu ».

C'est une direction néo-brutaliste : fond blanc, traits noirs francs, aplats saturés. Elle
s'oppose frontalement à tes quatre autres, qui sont toutes des palettes teintées et douces — c'est
justement l'intérêt de l'ajouter, ne l'adoucis pas pour la faire ressembler aux autres.

## Ce qu'on te demande

Une piste de plus, `[data-theme="vitrine"][data-piste="<nom>"]`, exactement dans la structure que
tu as posée : `light-dark()` sur chaque jeton, `color-scheme: light dark`, et ajoutée à la story de
comparaison au même titre que les quatre autres. Choisis son nom dans le même registre que
`embalse` / `zocalo` / `cal` / `hifago`.

⚠️ **Tu ne touches à AUCUNE des quatre pistes existantes**, ni au bloc `admin`, ni aux composants.
Tu ajoutes.

## La correspondance des couleurs, qui tombe juste

Les quatre couleurs demandées correspondent une à une aux familles de jetons qui existent déjà :

    jaune → --warning      rouge → --danger      vert → --success      bleu → --accent

Aucune famille à inventer. ⚠️ Mais leur SENS change : dans les autres pistes, `--danger` veut dire
« attention, destructif ». Ici le rouge est aussi une couleur de marque. Dis comment tu gères ça —
si le rouge devient décoratif, plus rien ne signale visuellement une action destructrice, et c'est
un vrai problème d'interface, pas un détail de palette.

## ⚠️ La tension à résoudre — flashy CONTRE contraste, et il faut la dire à Jérôme en chiffres

C'est le point dur de cette piste, et il ne se contourne pas :

- Un jaune vraiment flashy sur fond blanc, c'est de l'ordre de **1.1:1**. Il ne peut donc JAMAIS
  être une couleur de texte sur blanc, et il ne peut pas porter du texte blanc non plus.
- Un vert flashy sur blanc tourne autour de **2:1**. Même conclusion.
- Un rouge flashy portant du texte blanc est autour de **3.5:1** — sous le seuil de 4.5:1.
- Seul le bleu passe confortablement avec du texte blanc.

**La réponse n'est PAS de désaturer** — Jérôme a demandé flashy, et une palette flashy assagie pour
passer un seuil serait la pire des deux options. La réponse néo-brutaliste est structurelle :
**l'aplat saturé porte du texte NOIR**, et le texte sur fond blanc reste noir. C'est ce que les
jetons `--<famille>-foreground` expriment déjà, famille par famille — un `--warning-foreground`
quasi noir est parfaitement légitime.

Ce qu'on attend de toi :
1. Garde les couleurs franchement flashy.
2. Choisis le `-foreground` de chaque famille pour que l'aplat passe **4.5:1**, en mesurant.
3. ⚠️ **Dis explicitement ce que chaque couleur ne peut PAS faire** — « le jaune ne sera jamais un
   texte, seulement un aplat » est une contrainte de conception que Jérôme doit connaître AVANT de
   choisir cette piste, pas après.
4. Si une couleur ne passe dans aucune configuration, dis-le avec le chiffre plutôt que de
   l'ajuster jusqu'à ce que ça passe sans le signaler.

## La bordure noire et le fond blanc — c'est structurel, pas seulement chromatique

Ces jetons existent, sers-t'en, ils font une bonne moitié de l'identité :

    --border-width  --field-border-width   → le trait franc (admin est à 0px, `embalse` à 1px)
    --border  --field-border               → sa couleur
    --radius  --field-radius               → ⚠️ voir ci-dessous
    --surface-shadow  --field-shadow       → l'ombre portée dure, sans flou, typique du style

⚠️ **`--radius` a déjà un consommateur.** Le Button livré hier reprend `var(--radius)` au facteur 1
et Jérôme a demandé **8 px** (`0.5rem`) le 2026-09-02. Si ta piste veut des angles francs, dis-le
plutôt que de le poser en silence : ça change tous les boutons du site.

⚠️ Le fond blanc et le trait noir sont posés en `light-dark()`, donc tu dois trancher **ce que
cette piste devient en sombre**. L'inversion évidente (fond noir, traits blancs, mêmes aplats) est
une réponse valable — mais mesure-la, les aplats saturés se comportent très différemment sur noir,
et un `-foreground` noir sur un aplat jaune reste juste alors qu'un fond blanc devenu noir change
tout le reste.

## Un point de jonction avec le lot Button

⚠️ Le `Button` livré n'expose que **trois** couleurs : `accent`, `neutral`, `danger`. Ton jaune
(`warning`) et ton vert (`success`) ne sont donc PAS atteignables depuis un bouton aujourd'hui —
seulement depuis `TypeBadge`, qui utilise les quatre familles. Ce n'est pas ton périmètre et tu ne
touches pas au composant : **signale-le simplement**, pour que le coordinateur décide s'il faut
ouvrir l'axe couleur du bouton avant que cette piste soit adoptée.

## Vérification

Les mêmes que ton lot précédent, plus :

    npm run build --workspace=apps/admin      ← le thème admin doit rester intact

Au rendu : ta cinquième piste dans `Playground/Palette`, en clair ET en sombre, aux gabarits
Mobile 390 et Desktop 1280, panneau a11y sans violation.

## Ton rapport

1. Le nom de la piste et son parti pris en une phrase.
2. **Tous les contrastes mesurés**, dans les deux modes.
3. ⚠️ **Ce que chaque couleur flashy ne peut pas faire**, en clair — la liste des interdits que
   cette piste impose.
4. Ce que tu as fait du `--radius` (et donc des boutons), et de la double casquette du rouge.
5. Ce que tu as fait du mode sombre, et pourquoi.
6. Le résultat exact des commandes.

Tu ne commites pas.
```
