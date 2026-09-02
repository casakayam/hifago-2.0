# Relais coordinateur → agent B (thème)

> À coller dans le chat de l'agent thème AVANT qu'il conclue. Trouvé en relisant le lot de
> l'agent A, qui vient de terminer son Button.

---

```
Point de jonction entre ton lot et celui de l'agent A, à vérifier avant de conclure. Il ne remet
pas en cause ton mécanisme — il porte sur une conséquence de ton choix que tu n'as peut-être pas
mesurée.

## Le constat

Tu as retenu `color-scheme` + `light-dark()`, et tu ne poses jamais `[data-theme="dark"]` ni
`.dark`. Or HeroUI redéfinit **33 jetons dérivés** dans son bloc `.dark, [data-theme=dark]` de
`node_modules/@heroui/styles/dist/heroui.min.css` — vérifié :

  --accent-soft  --accent-soft-foreground  --accent-soft-hover  --accent-hover
  --danger-soft  --danger-soft-foreground  --danger-soft-hover  --danger-hover
  --default-soft --default-soft-foreground --default-soft-hover --default-hover
  --success-*    --warning-*
  --surface-hover  --background-secondary  --background-tertiary  --background-inverse
  --border-secondary  --border-tertiary  --separator-secondary  --separator-tertiary
  --field-hover  --field-focus  --field-border-hover  --field-border-focus
  --scrollbar-thumb  --scrollbar-track

⚠️ Avec ton sélecteur, **ce bloc ne s'active jamais**. En mode sombre, ces 33 jetons gardent donc
les formules du bloc clair (`:root`, qui matche bien `<html data-theme="vitrine">`), c'est-à-dire
des `color-mix` calibrés pour un fond BLANC.

Exemple concret des deux formules, qui ne sont pas les mêmes :

    clair : --accent-soft-hover: color-mix(in oklab, var(--accent) 16%, transparent);
    sombre: --accent-soft-hover: color-mix(in oklab, var(--accent) 20%, transparent);

## Pourquoi ça compte maintenant

Le Button que l'agent A vient de livrer construit ses variantes `soft`, `outline` et `ghost` sur
`--accent-soft`, `--accent-soft-hover`, `--accent-soft-foreground` et leurs équivalents `default`
et `danger`. Ça fait **9 des 12 combinaisons** de son bouton qui dépendent directement de ces
jetons dérivés — en mode sombre comme en clair.

Ta bonne nouvelle au passage, si tu ne l'avais pas vue : les dérivés viennent tous d'un
`color-mix` sur le jeton de base, donc redéfinir `--accent` suffit à faire suivre `-hover` et
`-soft`. Ton travail se propage bien. C'est UNIQUEMENT la variante sombre des formules qui reste
en suspens.

## Ce qu'on te demande

1. **Mesure**, ne suppose pas : sur une de tes pistes en mode sombre, relève les valeurs
   RÉELLEMENT calculées (`getComputedStyle`, comme le fait déjà `Tokens.stories.tsx`) de
   `--accent-soft`, `--accent-soft-foreground` et `--accent-soft-hover`, et compare-les à ce que
   donnerait le bloc sombre de HeroUI. Dis si l'écart est visible ou négligeable.
2. **Contraste** : le texte d'un bouton `soft` en mode sombre doit tenir 4.5:1. Ajoute ce couple à
   ta campagne de mesures — c'est le cas le plus exposé.
3. Si l'écart compte, tranche et documente : soit tu redéfinis toi-même les dérivés qui dévient
   dans ton bloc sombre, soit tu ajoutes le sélecteur qui réactive celui de HeroUI. ⚠️ Dans le
   second cas, vérifie que ça ne réveille rien d'autre — et surtout que **le thème admin reste
   intact**, il est en préprod.
4. Si l'écart est négligeable, dis-le avec les chiffres : ça ferme le sujet pour de bon.

## Deux choses à savoir de l'autre lot

- L'agent A a mesuré que **`solid/accent` (3.59:1) et `solid/danger` (3.48:1) échouent au contraste
  avec les jetons par défaut de HeroUI**. Ce n'est pas son composant, ce sont les jetons — donc
  c'est ton périmètre. Il a même calculé le correctif : luminosité de `--accent` de 0.6204 à
  0.5626 et de `--danger` de 0.6532 à 0.5902, chroma et teinte inchangés, ce qui donne 4.53 et
  4.52. ⚠️ Tes pistes semblent déjà partir d'accents plus sombres — vérifie simplement que chacune
  passe le seuil, dans les DEUX modes, et rapporte les chiffres.
- ⚠️ **Cross-validation à connaître** : l'agent qui a écrit `TypeBadge` en vague 1 avait mesuré
  indépendamment exactement les mêmes valeurs (3.59 et 3.48) sur `Chip`. Deux mesures
  indépendantes qui concordent : le défaut est réel, pas un artefact de méthode.

Tu ne commites pas. Rapport au coordinateur.
```
