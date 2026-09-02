"use client";

import type { ReactNode } from "react";
import { Card as HeroUICard } from "@hifago/ui";
import { Link } from "@/i18n/navigation";

// La carte de la vitrine (2026-09-02, vague 3). Surcouche de l'API compound de HeroUI
// (`Card.Header` / `Card.Title` / `Card.Description` / `Card.Content`), employée cinq fois dans
// l'app : catalogue, fiche produit ×2, fiche établissement ×2.
//
// `"use client"` obligatoire : ce fichier importe le barrel `@hifago/ui`, dont le graphe de
// modules fait planter `next build` dès qu'il atteint un Server Component (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. LA CARTE CLIQUABLE — le cas qui justifie ce composant
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Deux des cinq usages enveloppent la carte ENTIÈRE dans un `<Link>` (`CatalogBrowser.tsx:94` et
// `EstablishmentDetailView.tsx:139`). C'est le motif le plus courant d'un catalogue, et il a deux
// défauts qui ne se voient pas à l'œil :
//
//   a. ⚠️ Le nom accessible du lien est la concaténation de TOUT son contenu. Sur la carte du
//      catalogue, NVDA annonce aujourd'hui « lien, Habitación privada con vista al lago, 2
//      habitaciones, Amplia habitación con balcón privado sobre el embalse… » — un seul libellé
//      interminable, et la liste des liens de la page devient inutilisable.
//   b. ⚠️ Un second élément interactif dans la carte (un bouton « ajouter au panier », un lien
//      vers l'établissement) produirait un lien DANS un lien : du HTML invalide, que les
//      navigateurs réparent en fermant le premier `<a>` — donc une carte qui ne navigue plus.
//
// LA SOLUTION RETENUE : seul le TITRE est un lien ; son pseudo-élément `::after` est étiré sur
// toute la carte. C'est le motif « stretched link ». Ce qu'il donne, vérifié au rendu et pas
// supposé :
//   • le nom accessible du lien est exactement le titre — un libellé, pas un paragraphe ;
//   • le lien reste un VRAI lien : `<a href>`, donc clic milieu, « ouvrir dans un nouvel onglet »,
//     « copier l'adresse » et mise en favori fonctionnent. La navigation n'est PAS remplacée par
//     un `onClick`, ce qui aurait supprimé tout cela sans rien annoncer ;
//   • toute la surface reste cliquable, parce que le `::after` la recouvre ;
//   • un second élément interactif redevient possible — bouton, champ, second lien — et il n'est
//     PAS imbriqué dans le lien : deux frères dans le DOM, pas un `<a>` dans un `<a>`. La carte le
//     remonte elle-même au-dessus de l'overlay (voir `ENFANTS_INTERACTIFS_CLASS`), donc l'appelant
//     n'a rien à savoir de ce mécanisme : `children` accepte ce qu'on veut, comme sur une carte
//     ordinaire.
//
// ⚠️ Le prix, assumé et connu du motif : la sélection de texte à la souris dans une carte
// cliquable est avalée par l'overlay. Le compromis penche du bon côté — un catalogue se parcourt,
// il ne se recopie pas.
//
// ⚠️ Conséquence sur le type : quand `href` est fourni, `title` devient REQUIS **et de type
// `string`**, pas `ReactNode`. C'est ce qui garantit que le nom accessible du lien est un libellé
// lisible et non le rendu textuel d'un bloc de JSX. Même mécanisme que le `alt` d'`Image` et le
// `label` d'`IconButton` : la règle est portée par le compilateur, pas par la relecture.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. LES TROIS `className` DE L'EXISTANT — ce qu'ils cherchaient à obtenir
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le README interdit la prop `className`. Les trois valeurs passées aujourd'hui ne deviennent pas
// trois props pour autant : deux le deviennent, une DISPARAÎT.
//
//   • `text-lg` / `text-2xl` sur `Card.Title` (`ProductDetailView.tsx:118` et `:207`) → `titleSize`.
//     `.card__title` est en `text-sm` chez HeroUI ; les deux fiches voulaient un titre de page.
//   • `flex flex-col gap-6` sur `Card.Content` (`ProductDetailView.tsx:123`) → `contentGap`.
//     `.card__content` est DÉJÀ `flex flex-1 flex-col gap-1` : de ces quatre classes, une seule
//     changeait quelque chose, l'écart. Les trois autres étaient recopiées pour rien.
//   • `h-full overflow-hidden` sur la carte du catalogue (`CatalogBrowser.tsx:95`) → RIEN, et
//     c'est le constat le plus utile du lot :
//       – `h-full` ne servait qu'à rattraper le `<Link>` intercalé entre la grille et la carte :
//         c'est LUI qui était l'élément de grille et qui s'étirait, pas la carte. Sans cet
//         emballage — et la carte cliquable le supprime — la carte est l'élément de grille, et
//         `align-items: stretch` (le défaut d'une grille CSS) l'étire toute seule. Vérifié au
//         rendu : quatre cartes de hauteurs de texte différentes, quatre hauteurs égales, sans
//         aucune classe de hauteur ;
//       – ⚠️ `overflow-hidden` était INERTE. `.card` porte `p-4`, donc l'image était déjà en
//         retrait de 16 px des bords : il n'y avait rien à rogner. Cette classe dit pourtant
//         l'intention — une image à fleur de carte, rognée au rayon des angles. `media` la
//         réalise vraiment, en annulant le padding (`-mx-4 -mt-4`) et en rognant sur la carte.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. CE QUE CE COMPOSANT NE FAIT PAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Pas de prop `variant` (les quatre fonds de HeroUI), pas de `footer` : aucun des cinq usages
// n'en a besoin, et le README interdit d'anticiper. Ils s'ajouteront le jour où un écran les
// demande.
export type CardTitleLevel = "h2" | "h3" | "h4";
export type CardTitleSize = "sm" | "md" | "lg";
export type CardContentGap = "sm" | "md" | "lg";
export type CardLayout = "stack" | "row";

type CardCommun = {
  /** Le corps de la carte. Rendu dans `Card.Content` — absent, le bloc n'existe pas. */
  children?: ReactNode;
  /**
   * Le visuel de tête, typiquement l'atome `<Image>`. En `stack` il vient à fleur de carte et est
   * rogné au rayon des angles ; en `row` il devient une vignette de 64 px à gauche.
   */
  media?: ReactNode;
  /** Ligne courte entre le titre et la description, déjà traduite (le « 3 habitaciones » du catalogue). */
  subtitle?: ReactNode;
  description?: ReactNode;
  /** L'écart entre les blocs du corps. `sm` = le défaut de HeroUI. */
  contentGap?: CardContentGap;
  /** `row` = vignette à gauche, texte à droite — la ligne produit d'une fiche établissement. */
  layout?: CardLayout;
  testId?: string;
};

type CardTitre = {
  title: ReactNode;
  /**
   * ⚠️ REQUIS, jamais deviné — même règle que l'atome `Title` : « un seul `<h1>`, une hiérarchie
   * sans saut » se décide dans la page, qui en a la vue d'ensemble, pas dans la carte. HeroUI rend
   * un `<h3>` d'office, ce qui produit un saut de niveau dès qu'une carte suit un `<h1>`.
   */
  titleAs: CardTitleLevel;
  /** L'apparence, décorrélée du niveau — même séparation que `Title`. */
  titleSize?: CardTitleSize;
};

export type CardProps = CardCommun &
  (
    | ({ href?: undefined } & (CardTitre | { title?: undefined; titleAs?: undefined; titleSize?: undefined }))
    | ({
        /** Rend TOUTE la carte cliquable. Chemin interne : le préfixe de locale est conservé. */
        href: string;
        /** ⚠️ Devient le nom accessible du lien — donc une chaîne, jamais du JSX. Voir l'en-tête. */
        title: string;
      } & Omit<CardTitre, "title">)
  );

// Chaînes littérales complètes, jamais construites par concaténation : Tailwind v4 scanne ce
// fichier comme du texte (`@source` dans app/globals.css) et ne voit que des classes écrites en
// toutes lettres. Une classe interpolée n'existerait pas dans le CSS compilé — et la carte
// s'afficherait sans style, en silence.
const TITLE_SIZE_CLASSES: Record<CardTitleSize, string> = {
  sm: "", // `.card__title` de HeroUI, inchangé.
  md: "text-lg",
  lg: "text-2xl",
};

// `.card__content` est déjà `gap-1` côté HeroUI ; ces classes vivent dans la couche `utilities` et
// gagnent donc la cascade sur son `@apply` de la couche `components` (même mécanisme que celui
// mesuré pour l'axe couleur de `Button`).
const CONTENT_GAP_CLASSES: Record<CardContentGap, string> = {
  sm: "",
  md: "gap-3",
  lg: "gap-6",
};

// L'overlay qui rend toute la carte cliquable. `after:content-['']` est écrit explicitement bien
// que Tailwind v4 le pose par défaut : sans lui, le pseudo-élément n'est pas généré et la carte
// n'est plus cliquable qu'au titre — une panne muette qu'aucun test de rendu ne verrait.
// `z-[1]` le fait passer AU-DESSUS du visuel (`Image` rend un conteneur `relative`), et laisse
// `z-[2]` libre pour un futur élément interactif de la carte.
const OVERLAY_CLASS = "after:absolute after:inset-0 after:z-[1] after:content-['']";

// L'affordance de la carte cliquable, et son anneau de focus.
//
// ⚠️ `hover:border-accent` est écrit aujourd'hui sur `EstablishmentDetailView.tsx:140` et n'a
// AUCUN effet : `.card` ne déclare pas de bordure, et Tailwind met `border-width: 0` par défaut —
// changer la couleur d'une bordure inexistante ne peint rien. L'intention (souligner la carte
// survolée en couleur d'accent) est reprise ici avec un `ring`, qui, lui, se voit.
//
// ⚠️ L'anneau de FOCUS est indispensable, pas décoratif : le focus clavier atterrit sur le lien du
// titre, dont l'anneau natif n'entoure que quelques mots au milieu d'une carte entièrement
// cliquable. `status-focused` est l'utility de HeroUI elle-même — le même anneau que ses boutons
// et ses champs, posé sur la carte plutôt que sur le texte.
const CLICKABLE_CLASS =
  "transition-shadow hover:ring-2 hover:ring-accent has-[[data-card-link]:focus-visible]:status-focused";

/**
 * ⚠️ CE QUI REMET LES ENFANTS INTERACTIFS AU-DESSUS DE L'OVERLAY — automatiquement.
 *
 * L'overlay qui rend la carte cliquable est en `z-[1]`. Sans ces deux classes, un bouton, un
 * champ ou un second lien posé dans `children` passe DESSOUS et son clic part au lien de la carte.
 * Mesuré le 2026-09-02, sur une carte cliquable : un `<button>` sans `z-index` a l'overlay sous le
 * curseur (`elementFromPoint` renvoie le `<a>`) et le clic est reçu par le lien, pas par lui. Sur
 * une carte non cliquable, les trois mêmes enfants reçoivent leur clic normalement.
 *
 * La panne est SILENCIEUSE : rien ne casse, rien n'avertit, le bouton a l'air normal et navigue à
 * la place d'agir. Elle ne pouvait pas être laissée à la vigilance de l'appelant — c'est la même
 * décision que le `alt` d'`Image` ou le `rel` de `LinkButton`, appliquée à une règle de CSS plutôt
 * qu'à une prop.
 *
 * ⚠️ `a:not([data-card-link])` exclut le lien du titre : c'est LUI qui porte l'overlay, le
 * remonter au-dessus de son propre pseudo-élément n'aurait pas de sens.
 *
 * Ne couvre pas un élément rendu focalisable par `tabindex` seul, ni un `div` avec un gestionnaire
 * de clic — ni l'un ni l'autre n'existe dans ce dépôt, et `relative z-[2]` reste posable à la main
 * pour un cas exotique. Chaîne écrite en toutes lettres, comme partout ici : Tailwind scanne le
 * texte source.
 */
const ENFANTS_INTERACTIFS_CLASS =
  "[&_:is(button,select,input,textarea,[role=button],a:not([data-card-link]))]:relative [&_:is(button,select,input,textarea,[role=button],a:not([data-card-link]))]:z-[2]";

export function Card({
  children,
  media,
  title,
  titleAs,
  titleSize = "sm",
  subtitle,
  description,
  contentGap = "sm",
  layout = "stack",
  href,
  testId,
}: CardProps) {
  const estLigne = layout === "row";
  const BaliseTitre = titleAs ?? "h3";

  const classesCarte = [
    // Le `overflow-hidden` n'est posé QUE là où il rogne vraiment quelque chose : le visuel à
    // fleur de carte. Ailleurs il retirerait sans raison l'`overflow-visible` de HeroUI, dont
    // dépendent les surcouches (popover, tooltip) qui débordent d'une carte.
    media && !estLigne ? "overflow-hidden" : "",
    estLigne ? "flex-row items-center gap-4" : "",
    href ? `${CLICKABLE_CLASS} ${ENFANTS_INTERACTIFS_CLASS}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const tete =
    title || subtitle || description ? (
      <HeroUICard.Header>
        {title ? (
          <HeroUICard.Title
            className={TITLE_SIZE_CLASSES[titleSize]}
            render={(props) => <BaliseTitre {...props} />}
          >
            {href ? (
              // `data-card-link` plutôt que le sélecteur `a` : il désigne CE lien-là, et pas un
              // autre lien qui vivrait dans la carte — sinon focaliser ce dernier allumerait
              // l'anneau de toute la carte.
              <Link
                href={href}
                data-card-link=""
                className={OVERLAY_CLASS}
                data-testid={testId ? `${testId}-link` : undefined}
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </HeroUICard.Title>
        ) : null}
        {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
        {description ? <HeroUICard.Description>{description}</HeroUICard.Description> : null}
      </HeroUICard.Header>
    ) : null;

  const corps = children ? (
    <HeroUICard.Content className={CONTENT_GAP_CLASSES[contentGap]}>{children}</HeroUICard.Content>
  ) : null;

  return (
    <HeroUICard className={classesCarte} data-testid={testId}>
      {media ? (
        <div
          className={
            estLigne
              ? "w-16 shrink-0 overflow-hidden rounded-md"
              : // Annule le `p-4` de `.card` : le visuel touche les bords et se fait rogner au
                // rayon des angles par le `overflow-hidden` posé plus haut.
                "-mx-4 -mt-4"
          }
          data-testid={testId ? `${testId}-media` : undefined}
        >
          {media}
        </div>
      ) : null}
      {estLigne ? (
        // `min-w-0` : sans lui, un enfant flex refuse de descendre sous la largeur de son contenu
        // et un titre long pousse la vignette hors de la carte.
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {tete}
          {corps}
        </div>
      ) : (
        <>
          {tete}
          {corps}
        </>
      )}
    </HeroUICard>
  );
}
