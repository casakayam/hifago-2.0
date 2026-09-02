// Une image de la vitrine — avec `alt`, `sizes` et `loading` rendus OBLIGATOIRES par le type.
//
// Créé le 2026-09-01 (vague 1 des atomes, lot « données affichées »). Sa raison d'être tient dans
// ces mots-clés. `components/README.md` exige déjà les deux premiers, mais tant qu'ils restent
// optionnels dans `next/image` la règle n'est qu'un vœu : elle ne se vérifie qu'à la relecture, et
// elle a déjà été manquée — `establishments/[slug]/EstablishmentDetailView.tsx:144` rend un
// `fill` SANS `sizes`, donc sert l'image la plus grande à un téléphone. Ici le compilateur fait
// respecter la règle. C'est le seul mécanisme du lot qui transforme une règle écrite en règle
// vérifiée.
//
// Deuxième moitié de sa valeur : `src === null`. Les deux appelants actuels
// (CatalogBrowser.tsx:98, EstablishmentDetailView.tsx:142) écrivent chacun leur
// `product.imageUrl ? … : null` et laissent donc un TROU à la place du visuel. Le substitut est
// centralisé ici.
//
// ⚠️ Mode `fill` uniquement, dans un conteneur au ratio demandé : c'est le seul mode employé par
// les deux usages existants. Pas de mode `width`/`height` intrinsèque — personne n'en a besoin
// aujourd'hui, et le README interdit d'anticiper.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// `loading` — ajouté le 2026-09-02 (vague 4). Ce qui manquait n'était PAS le lazy loading
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `next/image` charge en lazy par DÉFAUT depuis Next 11 : cet atome le faisait donc déjà, pour
// toutes ses images. Ce qui manquait, c'est l'inverse — `priority`. L'image au-dessus de la ligne
// de flottaison ne doit surtout pas être lazy : c'est elle le LCP, et le navigateur ne la découvre
// qu'après avoir calculé la mise en page. Le LCP est un Core Web Vital, donc un critère de
// classement — la règle touche directement le lot SEO du 2026-09-01.
//
// La règle vient de `docs/specs/04-gestion-images.md §8` (« Le premier slide visible d'un carrousel
// (LCP) est toujours chargé en priorité (`priority`), jamais `lazy` ») et n'était appliquée qu'à UN
// endroit du dépôt, `products/[slug]/ProductPhotos.tsx:24-25`. Elle est reprise telle quelle, pas
// redérivée.
//
// ⚠️ **Obligatoire, et pas un `priority?: boolean` optionnel.** Même raisonnement que pour `alt` et
// `sizes` — et il est validé par les faits : `sizes` a été oublié dans `EstablishmentDetailView`
// précisément parce qu'il était facultatif. L'atome ne peut pas savoir ce qui est au-dessus de la
// ligne de flottaison ; la page, si.
//
// ⚠️ `priority` et `loading="lazy"` sont CONTRADICTOIRES côté next/image : passés ensemble,
// `getImgProps` lève « has both "priority" and "loading='lazy'" properties » et le rendu plante.
// D'où la traduction ci-dessous en DEUX props next/image dont une seule est jamais posée — c'est
// exactement ce que fait `ProductPhotos`, et c'est pourquoi une seule prop d'entrée à deux valeurs
// vaut mieux ici que deux props indépendantes qu'on peut combiner de travers.
//
// Ce que `loading="priority"` produit RÉELLEMENT dans le DOM rendu, mesuré sur Next 16.3.0 et figé
// dans `Image.test.tsx` :
//   • sur la balise `<img>` : RIEN. Pas de `loading="eager"`, pas de `fetchpriority="high"` —
//     seulement l'ABSENCE de `loading="lazy"`. ⚠️ C'est un changement de Next 16 : jusqu'à Next 15,
//     `priority` posait aussi `fetchpriority="high"`. Constaté, non compensé ici (ce serait
//     redériver la règle plutôt que la reprendre) — signalé à Jérôme.
//   • dans `<head>` : un `<link rel="preload" as="image" imagesrcset=… imagesizes=…>`, injecté par
//     `ReactDOM.preload`. C'est LUI qui fait tout le travail — le navigateur découvre l'image sans
//     attendre la mise en page. C'est donc la seule assertion qui prouve vraiment la priorité.
//   • ⚠️ sur une source SVG, `priority` SURVIT (le preload est bien émis, en `href` cette fois),
//     contrairement à `sizes` et `srcset` que next/image jette pour une source non optimisable.
import NextImage from "next/image";

export type ImageProps = {
  /** `null` = pas de visuel : l'atome rend un substitut, jamais un trou. */
  src: string | null;
  /** REQUIS. `""` est licite pour une image purement décorative — mais c'est un choix explicite. */
  alt: string;
  /** REQUIS. Sans lui, next/image sert l'image la plus grande à un téléphone. */
  sizes: string;
  /**
   * REQUIS. `"priority"` pour l'image au-dessus de la ligne de flottaison (le LCP), `"lazy"` pour
   * toutes les autres. Reste exigé même quand `src` vaut `null` — rien n'est alors chargé, donc la
   * valeur n'a aucun effet, mais le contrat de l'atome reste lisible d'un seul coup d'œil.
   */
  loading: "lazy" | "priority";
  ratio?: "4/3" | "16/9" | "1/1";
  testId?: string;
};

// Classes écrites en toutes lettres, jamais construites (`aspect-[${ratio}]`) : Tailwind v4 scanne
// le texte source, une classe interpolée n'existerait pas dans le CSS compilé. Le piège est déjà
// documenté au-dessus du `@source` d'app/globals.css — les composants s'affichent alors SANS STYLE,
// en silence.
const CLASSES_RATIO: Record<NonNullable<ImageProps["ratio"]>, string> = {
  "4/3": "aspect-[4/3]",
  "16/9": "aspect-[16/9]",
  "1/1": "aspect-[1/1]",
};

export function Image({ src, alt, sizes, loading, ratio = "4/3", testId }: ImageProps) {
  // `w-full` et aucune largeur en dur : le conteneur s'adapte à son parent (README, responsive).
  // Pas de `cn` de @hifago/ui ici — il n'y a rien à fusionner, et l'importer tirerait tout le
  // barrel HeroUI dans le graphe de modules d'un composant qui n'en a aucun besoin (CLAUDE.md
  // §11.16). Concaténation directe, donc, et cet atome reste rendable côté serveur.
  return (
    <div className={`relative w-full overflow-hidden ${CLASSES_RATIO[ratio]}`} data-testid={testId}>
      {src === null ? (
        // Un aplat neutre au même ratio, pris sur un jeton du thème (donc juste en vitrine comme en
        // admin). `aria-hidden` : une image absente n'a rien à annoncer, et `alt` décrirait un
        // visuel qui n'est pas là.
        <div
          className="absolute inset-0 bg-surface-secondary"
          aria-hidden="true"
          data-testid={testId ? `${testId}-placeholder` : undefined}
        />
      ) : (
        <NextImage
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover"
          priority={loading === "priority"}
          // ⚠️ `undefined`, jamais `"eager"` : c'est l'absence de la prop qui laisse `priority`
          // agir, et la poser à `"lazy"` en même temps ferait lever next/image. Forme reprise
          // telle quelle de ProductPhotos.tsx:25.
          loading={loading === "priority" ? undefined : "lazy"}
        />
      )}
    </div>
  );
}
