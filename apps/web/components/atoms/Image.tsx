// Une image de la vitrine — avec `alt` et `sizes` rendus OBLIGATOIRES par le type.
//
// Créé le 2026-09-01 (vague 1 des atomes, lot « données affichées »). Sa raison d'être tient dans
// ces deux mots-clés. `components/README.md` exige déjà les deux, mais tant qu'ils restent
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
import NextImage from "next/image";

export type ImageProps = {
  /** `null` = pas de visuel : l'atome rend un substitut, jamais un trou. */
  src: string | null;
  /** REQUIS. `""` est licite pour une image purement décorative — mais c'est un choix explicite. */
  alt: string;
  /** REQUIS. Sans lui, next/image sert l'image la plus grande à un téléphone. */
  sizes: string;
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

export function Image({ src, alt, sizes, ratio = "4/3", testId }: ImageProps) {
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
        <NextImage src={src} alt={alt} fill sizes={sizes} className="object-cover" />
      )}
    </div>
  );
}
