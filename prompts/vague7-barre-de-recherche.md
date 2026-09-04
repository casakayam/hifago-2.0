# Vague 7 — La grande barre de recherche

> Bloc à coller dans un chat neuf, depuis un répertoire de travail dans `hifago/`.

---

```
Tu construis LA barre de recherche de la vitrine hifago (apps/web). C'est le composant le plus
visible du site : plus grand que tous les autres champs, et unique dans sa forme.

D'AUTRES AGENTS TRAVAILLENT PEUT-ÊTRE EN CE MOMENT (toasts, calendrier). Respecte strictement ton
périmètre.

## 0. À lire d'abord

1. `hifago/apps/web/components/README.md` — les conventions font foi.
2. `hifago/apps/web/components/atoms/Field.tsx` — le champ ORDINAIRE. Le tien ne doit lui
   ressembler ni en taille ni en forme, mais il doit parler le même vocabulaire de props
   (`error`, `hint`, `testId`, pas de `className`).
3. `hifago/apps/web/app/[locale]/CatalogBrowser.tsx` — la recherche actuelle, que ce composant
   remplacera : un filtrage EN DIRECT côté client, sur le seul `product.name`, sans bouton, sans
   `Entrée`, sans suggestions.
4. `hifago/CLAUDE.md` §11 point 7 — le piège e2e du `ComboBox` de ce dépôt.

## 1. Ce que Jérôme a demandé, mot pour mot

- Un input **plus grand que les autres et unique dans la forme**.
- **Sans cliquer sur « Rechercher »**, il propose des choses liées au texte tapé — des activités,
  ou autre chose : ça peut être une **catégorie**.
- **Si on appuie sur « Rechercher »** (ou `Entrée`), ça filtre vraiment.
- Référence de facture : la barre de recherche de getyourguide.com.

**Où elle vit** (décision de Jérôme, 2026-09-02) : dans le **premier bloc sous le header**, sur
l'accueil. ⚠️ Donc **PAS dans le header**, et **PAS collante au défilement** — contrairement à la
référence. Deux conséquences directes :
- elle a de la place, elle peut être franchement grande : c'est la demande « plus grand que les
  autres » ;
- elle n'a **aucune contrainte de hauteur** imposée par une barre de navigation, donc ne cherche pas
  à la comprimer.

⚠️ Conséquence à connaître, à signaler et non à corriger : depuis une fiche produit, il n'y aura
alors aucun moyen de relancer une recherche sans revenir à l'accueil. C'est assumé pour ce lot.

**Ce que cette référence donne réellement, mesuré au navigateur le 2026-09-02** (pas décrit de
mémoire) :

    <input type="text" name="q" autocomplete="off" enterkeyhint="search"
           role="combobox" aria-autocomplete="list" aria-expanded="false"
           aria-label="Sugerencias de búsqueda"
           placeholder="Buscar lugares o actividades">

⚠️ `type="text"`, pas `type="search"` — et `enterkeyhint="search"` est bien là, ce qui confirme
le §7. Le champ fait **687 px sur un écran de 1280**, soit plus de la moitié de la page : c'est ça,
« plus grand que les autres ».

**Desktop** : une pilule unique qui contient TROIS segments — texte, date, participants — puis le
bouton « Buscar ». ⚠️ Les segments date et participants sont **hors de ton périmètre** : Jérôme n'a
demandé que le champ texte. Ne les construis pas, mais **ne rends pas leur ajout impossible** : la
pilule doit pouvoir accueillir un segment de plus un jour.

**Mobile** : une seule pilule, loupe et texte d'invite, **sans les segments et sans bouton** — ce
qui est exactement la décision de Jérôme au §7. Elle devient collante en haut au défilement.

**Avant la frappe**, leur liste est déjà ouverte, avec 7 destinations populaires portant chacune sa
ligne secondaire (« París — Ciudad en Francia »). C'est la réponse à « que montrer avant que
l'utilisateur ait tapé ».

⚠️ Le back-end n'est pas pensé, et la recherche partira sur une **route dédiée** qui n'existe pas
encore. Voir §4 : c'est la contrainte qui décide de la forme de ton API.

## 2. ⚠️ LE POINT DUR — deux actions dans un seul champ, et le bug qu'il faut fermer

Un dropdown à la frappe (`ComboBox`/`Autocomplete` en react-aria) **capture `Entrée`** pour valider
l'option surlignée. Or `Entrée` doit aussi lancer la recherche. Ce sont deux modèles d'interaction
différents dans le même champ, et les confondre produit le bug classique de ce motif :

> on tape « kayak », une suggestion est surlignée, on appuie sur `Entrée` en pensant chercher
> « kayak » — et on se retrouve sur une autre fiche produit.

⚠️ **CE N'EST PAS UNE HYPOTHÈSE : getyourguide.com a exactement ce défaut, mesuré au navigateur
le 2026-09-02.** Trois gestes, sur `kayak` :

| Geste | Ce qui se passe RÉELLEMENT |
|---|---|
| `Entrée` seul | va sur `?q=**Dubrovnik**` — une SUGGESTION, jamais le texte tapé |
| `FlècheBas` + `Entrée` | idem, `?q=Dubrovnik` |
| Bouton « Buscar » | `?q=**kayak**` — le texte tapé |

Chez eux, la recherche en texte libre n'existe QUE par le bouton. La première option est
présélectionnée (`aria-selected="true"`) dès l'ouverture, et `Entrée` l'active.

⚠️ **Et c'est précisément pour ça qu'on ne copie pas ce modèle.** Jérôme a tranché : **pas de
bouton sur mobile**, le clavier suffit. Combiné au modèle GetYourGuide, ça donnerait un site où
**on ne peut JAMAIS chercher en texte libre depuis un téléphone** — on taperait « kayak » et on
atterrirait sur Dubrovnik, sans aucun recours. Les deux décisions sont incompatibles, et c'est la
règle ci-dessous qui les réconcilie.

**La règle à tenir, et elle n'est le défaut d'aucune bibliothèque :**

- `Entrée` **soumet toujours le texte tapé**, comme le bouton « Rechercher » ;
- **SAUF** si l'utilisateur est explicitement descendu sur une suggestion avec les flèches — là,
  `Entrée` active cette suggestion ;
- un **clic** sur une suggestion l'active toujours ;
- à l'ouverture du dropdown, **aucune suggestion n'est présélectionnée**. C'est cette absence de
  présélection qui rend la règle sûre.

⚠️ **Tu ne devines PAS quelle primitive HeroUI convient, tu le prouves.** `SearchField`,
`ComboBox`, `Autocomplete` et `InputGroup` existent tous (vérifié dans
`node_modules/@heroui/react/dist/components/`). `SearchField` apporte la loupe et le bouton
d'effacement, et la sémantique `type="search"` ; `ComboBox` apporte le dropdown et la navigation
clavier mais son `Entrée` est justement le problème. Essaie, mesure le comportement de `Entrée`
dans un vrai navigateur, et dis dans ton rapport ce que tu as retenu ET ce que tu as écarté, avec
ce que tu as observé. Une composition `SearchField` + listbox est une réponse valable si les
primitives toutes faites ne tiennent pas la règle.

## 3. Les suggestions

**Elles sont hétérogènes**, et leur nature est **OUVERTE** : produits, catégories, et
**établissements** — ces derniers sont déjà chargés côté client par `page.tsx`
(`id, slug, name, description`), et chercher « Casa Kayam » doit proposer le LIEU, pas seulement ses
chambres une par une. C'est l'équivalent chez nous de ce que la référence appelle une
« destination ».

⚠️ **Ne fige donc PAS la nature dans une union à deux valeurs.** Le type d'une suggestion doit
pouvoir en accueillir une quatrième sans toucher au composant. C'est le genre de détail qui coûte
une refonte six semaines plus tard.

⚠️ **Tu n'implémentes AUCUNE logique de recherche** (décision de Jérôme, 2026-09-02 : « on ne
s'occupe pas de la requête encore »). Le composant reçoit une liste de suggestions déjà constituée
et ne sait pas d'où elle vient. Tes stories fournissent les leurs à la main.

⚠️ **Correction d'après mesure (2026-09-02) : ne les groupe PAS avec des intitulés de section.**
Vérifié sur getyourguide.com — leur liste est **plate**, sans un seul `role="group"`. La nature de
chaque entrée est portée par une **ligne secondaire** sous le libellé, et ça suffit :

    Tours en canoa y kayak        Kayak de mar
    26 actividades • Nerja        Actividad en Dubrovnik, Croacia
    └─ une CATÉGORIE              └─ une ACTIVITÉ

C'est plus simple qu'un groupement, ça mélange librement les natures par pertinence plutôt que par
type, et ça évite les intitulés de groupe non sélectionnables qui compliquent la navigation
clavier. **Reprends ce modèle** : un libellé, une ligne secondaire qui dit ce que c'est et où.

✔ **Bonne nouvelle vérifiée : ça ne coûte AUCUN appel réseau.** `app/[locale]/page.tsx` charge le
catalogue **sans `.limit()`** — tout est déjà côté client. Donc pas de debounce à régler, pas
d'état de chargement, pas de course entre deux réponses, pas de `useEffect` d'appel. Ne construis
pas cette machinerie « au cas où » : le README interdit l'anticipation, et le jour où une vraie
recherche serveur arrivera, elle changera l'origine des suggestions, pas ta forme d'API.

⚠️ Le composant **ne calcule PAS les suggestions lui-même** : il les reçoit. C'est ce qui le garde
utilisable quand la source changera, et testable sans monter un catalogue.

Ce sur quoi on cherche aujourd'hui : le seul `name`. La carte porte aussi `descriptionSnippet`,
`type` et `subtitle` — « kayak » ne trouve donc pas une activité dont seule la description en parle.
Ce n'est pas ton périmètre (c'est l'appelant qui filtre), mais **signale-le**.

⚠️ **Avant que l'utilisateur ait tapé quoi que ce soit**, à l'ouverture : ne montre pas un dropdown
vide. Les catégories sont disponibles gratuitement côté client — les proposer est un point de
départ honnête. Un « recherches récentes » demanderait du `localStorage`, donc une décision de plus :
ne le fais pas, propose-le.

## 4. ⚠️ Le composant ne navigue pas, il ÉMET

La route de résultats n'existe pas et n'est pas encore pensée. Ton composant ne doit donc **jamais**
coder une destination en dur.

- soumission → il **appelle une fonction avec la requête** ; c'est la page qui décidera d'aller
  vers `/search?q=…` ou de filtrer sur place ;
- suggestion activée → il **remonte la suggestion choisie** ; c'est l'appelant qui sait qu'un
  produit mène à sa fiche et une catégorie au catalogue filtré.

C'est ce qui permet de livrer ce composant **sans créer aucune route ni toucher une seule page** —
et c'est la condition pour que ce lot reste dans le périmètre.

⚠️ Prévois quand même que l'appelant puisse rendre chaque suggestion comme un **vrai lien**
(`<a href>`) : un résultat qu'on ne peut pas ouvrir dans un nouvel onglet est une régression par
rapport à une liste de cartes. Dis comment ton API le permet.

## 5. Ton périmètre exclusif

apps/web/components/organisms/SearchBar.tsx + .stories.tsx + .test.tsx

Story sous `"Saisie/SearchBar"` — ⚠️ le `title` ne suit PAS le dossier, c'est la convention du
README. `organisms/` parce que le composant porte un état et une navigation.

⚠️ **AUCUN FILTRE dans ce lot** (décision de Jérôme, 2026-09-02 : « c'est une recherche juste, on
parlera des filtres plus tard dans un autre prompt »). Pas de sélecteur de type, pas de date, pas de
participants, pas de tri. Le catalogue actuel porte un filtre par type (`CatalogBrowser.tsx`) : tu
ne le reprends pas, tu ne le remplaces pas, tu ne prépares pas sa place. Il fera l'objet de son
propre lot.

**Tu ne touches à rien d'autre** : aucune page, aucune route, aucun autre composant, aucune
dépendance, aucune clé i18n (une organism reçoit ses libellés traduits en props ou appelle
`useTranslations` — regarde comment `SiteHeader` s'y prend et fais pareil).

**Tu ne lances aucun serveur** : 3100 et 6006 sont pris. `-p 6007` si besoin, arrêté en partant.
**Tu ne commites pas.**

## 6. Accessibilité — c'est le composant le plus exposé du site

⚠️ **Un défaut mesuré chez la référence, à NE PAS reproduire.** Sur getyourguide.com,
`aria-activedescendant` reste **`null`** même après avoir navigué aux flèches — seul
`aria-selected` bouge. Un lecteur d'écran n'annonce donc jamais l'option active : on navigue à
l'aveugle. C'est le défaut le plus courant de ce motif, et il ne se voit pas à l'œil.

Une liste de suggestions sous un champ est l'un des motifs les plus faciles à rendre inutilisable.
Le minimum, vérifié au clavier ET au panneau a11y :

- le champ annonce qu'il a une liste associée, et laquelle ; l'option active est annoncée quand on
  navigue aux flèches ;
- `Échap` ferme le dropdown **sans perdre le texte tapé** ;
- les intitulés de groupe ne sont **pas** sélectionnables et sont reliés à leur groupe ;
- le focus ne part jamais derrière le panneau, et revient au champ à la fermeture ;
- le nombre de résultats est annoncé quand il change (une liste qui se vide en silence n'existe pas
  pour un lecteur d'écran) ;
- **cible tactile ≥ 44 px** sur chaque suggestion et sur le bouton. ⚠️ Mesure-le à 390 px et
  rapporte le chiffre — une liste dense sur écran étroit est exactement là où cette règle casse.

## 7. Le responsive — décision de Jérôme, et ce qu'elle rend obligatoire

**Sur mobile, PAS de bouton « Rechercher »** (décision de Jérôme, 2026-09-02) : le clavier virtuel
porte déjà sa touche de validation, et à 390 px un grand champ plus un bouton ne tiennent pas côte
à côte sans que l'un des deux devienne minuscule. Le bouton apparaît à partir du point de bascule.
C'est exactement ce que fait la référence sur mobile — mesuré : une seule pilule, sans segments et
sans bouton.

⚠️ **CETTE DÉCISION REND `enterkeyhint="search"` OBLIGATOIRE, PAS OPTIONNEL.** Sans cet attribut,
la touche de validation du clavier affiche « Retour » ou « OK » selon la plateforme — donc
l'affordance sur laquelle repose toute la décision n'est pas communiquée à l'utilisateur, qui n'a
alors AUCUN moyen visible de lancer sa recherche. `type="search"` dans un `<form>` aide aussi sur
iOS. **Vérifie ce que la touche affiche réellement** (émulateur mobile ou vrai téléphone), ne le
suppose pas — et rapporte-le.

⚠️ Deux cas à traiter, pas à ignorer :
- quelqu'un qui tape, puis referme le clavier en touchant ailleurs, n'a plus rien pour soumettre ;
- un lecteur d'écran sur mobile ne présente pas la touche de validation comme un bouton.

Donc : masquer le bouton **visuellement** (il reste dans l'arbre d'accessibilité) n'est pas la même
chose que le retirer du DOM. Tranche entre les deux et argumente — c'est exactement le genre de
détail qui rend un champ inutilisable pour une partie des visiteurs sans que personne ne s'en
aperçoive.

⚠️ Note bien cette exception dans ton commentaire d'en-tête : le README interdit de masquer selon
la largeur, parce que Google indexe le mobile. La règle vise le **contenu indexable**, pas un
contrôle de soumission — mais sans un mot d'explication, le prochain agent « corrigera » ce qui est
une décision.

Le dropdown ne doit provoquer aucun défilement horizontal ni sortir de l'écran.

## 8. Les stories

- Vide, au repos.
- **Ouvert avant la frappe** (les catégories proposées).
- **Ouvert avec des suggestions des deux natures**, groupées.
- **Aucun résultat** — l'état le plus fréquent et le plus négligé.
- **Un texte long**, et une suggestion au libellé très long (l'espagnol fait 20 à 25 % de plus).
- ⚠️ **Une story interactive** où le texte soumis s'affiche à l'écran : c'est la seule façon pour
  Jérôme de vérifier que `Entrée` soumet bien le texte tapé et non une suggestion.
- Les gabarits **390 et 1280**, les deux modes **clair/sombre**, les cinq pistes.

Noms d'exports en français.

## 9. ⚠️ Le piège de test de ce dépôt

`CLAUDE.md` §11 point 7 : sur un `ComboBox` HeroUI, cliquer une option d'une liste **non filtrée**
échoue de façon intermittente à committer la sélection — constaté en vrai le 2026-08-14. La parade
vérifiée : **taper une requête d'abord**, puis cliquer l'option par son nom. Applique-la dans tes
tests, même si tu ne retiens pas `ComboBox`.

## 10. Vérification

Depuis `hifago/apps/web` :

    npx tsc --noEmit
    npx eslint components
    npx vitest run

Puis au rendu réel : panneau a11y sans violation, navigation entièrement au clavier, aucun
défilement horizontal à 390 px.

## 11. Ton rapport

1. Les fichiers créés.
2. **La primitive retenue et celles écartées**, avec le comportement de `Entrée` que tu as OBSERVÉ
   dans chacune — mesuré, pas supposé. C'est le cœur de ce lot.
3. Comment tu garantis qu'aucune suggestion n'est présélectionnée à l'ouverture.
4. La forme d'API pour la soumission et pour l'activation d'une suggestion, et comment l'appelant
   peut rendre une suggestion comme un vrai lien.
5. Ta décision responsive à 390 px, la taille tactile mesurée, **et ce que la touche de validation
   du clavier affiche réellement** avec ton `enterkeyhint` — observé, pas supposé.
6. Ce que le panneau a11y remonte sur une liste de suggestions groupée.
7. Ce que tu as constaté sans corriger.
8. Le résultat exact des commandes du §10.

Tu ne commites pas.
```
