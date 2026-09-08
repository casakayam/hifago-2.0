// Le bloc « aucun résultat » de l'accueil filtrée (2026-09-08, lot D, Tranche 1 de
// docs/specs/28-vitrine-accueil-et-resultats.md §0 — cas limite « Critères, aucun résultat nulle
// part : état vide explicite sous la barre, la barre reste utilisable »).
//
// Il n'existait NULLE PART dans le dépôt : l'ancien accueil (`CatalogBrowser`) filtrait en mémoire
// et affichait une chaîne `noResults` nue au milieu de sa grille. La spec 28 retire cette clé et
// remonte l'état vide au niveau de la page. Il vit dans `molecules/` et non dans le `page.tsx` de
// l'accueil parce que les pages de listing (spec 29) en auront besoin telles quelles — la
// convention « une spec d'écran NOMME les composants manquants » de components/README.md §« Quand
// une spec d'écran a besoin d'un composant qui n'existe pas » l'a d'ailleurs nommé d'avance.
//
// ⚠️ Aucun titre, au sens HTML : deux `<p>`, jamais un `<h*>`, et surtout pas l'atome `Title`.
// La spec 28 §0.152 impose « un seul `<h1>` ; les titres de section sont des `<h2>` », et l'accueil
// pose déjà ce `<h1>` (masqué visuellement) plus un `<h2>` par section. Un état vide qui entrerait
// dans cette hiérarchie y ajouterait un niveau parasite, variable selon qu'il y a des résultats ou
// non — c'est-à-dire une structure de titres qui change avec les données. Le test tient cette
// règle explicitement, parce que rien à l'écran ne la trahirait (§11.20 de CLAUDE.md : une règle
// que rien ne vérifie n'est pas une règle).
//
// ⚠️ N'importe RIEN de `@hifago/ui`, pas même `cn`, et ne porte donc PAS `"use client"` : il est
// rendu par le `page.tsx` de l'accueil, qui est un Server Component (CLAUDE.md §11.16 — l'import
// du barrel casse `next build` par transitivité). Il n'a besoin d'aucune primitive HeroUI : des
// classes fixes suffisent. Même raison pour le `sousId` local ci-dessous plutôt que celui de
// `atoms/Field.tsx`, qui est un fichier client.
//
// Ce qu'il ne rend PAS, volontairement : aucun bouton, aucune illustration. Le bloc de recherche
// reste monté juste au-dessus et c'est LUI l'action — un « Réinitialiser » ici dupliquerait une
// commande déjà à l'écran, à trois centimètres de distance. Et pas de `role="status"` non plus :
// changer de critères provoque une navigation, pas une mise à jour en place, et un `aria-live`
// posé au montage n'annonce rien tout en polluant le premier rendu.
export type EstadoVacioProps = {
  /** Déjà traduit — une molécule reçoit son libellé, la page traduit. */
  titulo: string;
  /** Déjà traduite. Optionnelle : une phrase qui dit quoi faire ensuite. */
  descripcion?: string;
  testId?: string;
};

export function EstadoVacio({ titulo, descripcion, testId }: EstadoVacioProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);

  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center" data-testid={testId}>
      {/*
        `max-w-prose` sur les deux paragraphes : ce n'est pas une largeur en dur (c'est `65ch`, donc
        exprimé en caractères) mais la borne de longueur de ligne exigée par components/README.md
        § Lisibilité. Sans elle, un texte centré s'étale sur toute la largeur d'un écran 1280 et
        devient illisible — ce que la story `TextoLargo` existe pour montrer.
      */}
      <p className="max-w-prose text-base font-medium" data-testid={sousId("titulo")}>
        {titulo}
      </p>
      {descripcion ? (
        <p className="max-w-prose text-sm text-muted" data-testid={sousId("descripcion")}>
          {descripcion}
        </p>
      ) : null}
    </div>
  );
}
