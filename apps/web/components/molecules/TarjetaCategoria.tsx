"use client";

import { Card } from "@/components/atoms/Card";
import { Image } from "@/components/atoms/Image";
import type { CategoriaConOferta } from "@/lib/catalog/tipos";

// Une tuile de l'index des catégories, `/es/actividades` (2026-09-08, spec 29 §5a — décisions 6
// et 7).
//
// ⚠️ POURQUOI ELLE N'EST PAS `TarjetaOferta`. Les deux se ressemblent à l'écran et ne décrivent pas
// la même chose : une carte d'offre mène à quelque chose qu'on RÉSERVE (elle porte un prix, un
// établissement, un carrousel de photos réelles), une tuile de catégorie mène à une LISTE (elle
// porte un texte éditorial et une seule image de couverture). Les fusionner obligerait à passer
// la moitié des props à `undefined` d'un côté ou de l'autre, et le premier changement de l'une
// casserait l'autre.
//
// ⚠️ UNE IMAGE, PAS UN CARROUSEL. `PhotoStrip` monte Embla (état, gestionnaires, trois API de
// navigateur) : pour une image unique et fixe, c'est du JavaScript chargé pour rien. L'atome
// `Image` rend le même substitut au même ratio quand `src` vaut `null` — la tuile garde sa forme,
// et c'est ce qu'on verra en local et en e2e, où le seed n'a AUCUNE image (§6e).
//
// ⚠️ `"use client"` imposé par l'import de `Card`, qui tire le barrel `@hifago/ui`
// (CLAUDE.md §11.16). Le composant n'a lui-même aucun état.
//
// Il ne traduit RIEN : le nom et le texte lui arrivent résolus. Pour « Otras actividades », ils
// viennent de next-intl et donc de la page — la couche `lib/catalog/` les laisse vides à dessein.

export type TarjetaCategoriaProps = {
  categoria: CategoriaConOferta;
  /**
   * Déjà traduits — utilisés UNIQUEMENT pour la tuile « Otras actividades », qui n'est pas une
   * ligne de la base et n'a donc ni nom ni texte à elle.
   */
  libellesSinTag: { nombre: string; descripcion: string };
  /** Vrai pour la PREMIÈRE tuile de la grille : elle porte le LCP. */
  prioridad?: boolean;
};

// Chaîne littérale complète, jamais construite : Tailwind ne compile pas une classe interpolée, et
// `sizes` est lu par le navigateur — une valeur fausse sert l'image la plus grande à un téléphone.
// Suit exactement la grille d'`IndiceCategorias` (1 colonne, 2 à `md`, 3 à `lg`).
const SIZES = "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw";

export function TarjetaCategoria({
  categoria,
  libellesSinTag,
  prioridad,
}: TarjetaCategoriaProps) {
  const nombre = categoria.esSinTag ? libellesSinTag.nombre : categoria.nombre;
  const descripcion = categoria.esSinTag ? libellesSinTag.descripcion : categoria.descripcion;

  return (
    <Card
      href={categoria.href}
      title={nombre}
      titleAs="h2"
      testId={categoria.testId}
      media={
        <Image
          src={categoria.foto?.url ?? null}
          // ⚠️ `alt=""` et c'est un CHOIX, pas un oubli. L'image d'une catégorie est purement
          // décorative : elle n'apporte rien que le titre juste en dessous ne dise déjà, et le lien
          // porte ce titre comme nom accessible. Un `alt` qui répéterait « Kayak » ferait annoncer
          // deux fois la même chose à un lecteur d'écran. L'atome exige la prop précisément pour
          // que ce choix soit explicite.
          alt=""
          sizes={SIZES}
          loading={prioridad ? "priority" : "lazy"}
          ratio="4/3"
          testId={`${categoria.testId}-foto`}
        />
      }
    >
      {/* `undefined` et non une chaîne vide : c'est ce que `Card` teste pour ne PAS ouvrir de
          `Card.Content`. Un bloc vide laisserait un écart sous le titre des catégories non
          rédigées, et la grille perdrait son alignement. */}
      {descripcion ? (
        <p className="text-sm text-muted" data-testid={`${categoria.testId}-descripcion`}>
          {descripcion}
        </p>
      ) : undefined}
    </Card>
  );
}
