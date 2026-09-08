import { TarjetaCategoria } from "@/components/molecules/TarjetaCategoria";
import type { CategoriaConOferta } from "@/lib/catalog/tipos";

// La grille de l'index des catégories, `/es/actividades` (2026-09-08, spec 29 §5a).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ PAS DE "use client" ICI, ET C'EST LA DÉCISION STRUCTURANTE DU FICHIER
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Cette grille n'a AUCUN état, aucun gestionnaire d'événement, et ne traduit rien : tout lui arrive
// résolu. Elle n'importe donc rien de `@hifago/ui` — pas même `cn` — et reste un Server Component
// (CLAUDE.md §11.16). Conséquence directe et voulue : le HTML des tuiles est SERVI, pas hydraté.
//
// C'est ce que Google lit, et c'est tout l'objet de cette page : elle existe pour être le point
// d'entrée indexable de chaque catégorie (cahier §2a, « pages de listing navigables et
// indexables »). Poser `"use client"` ici ferait descendre la grille entière dans le navigateur
// pour zéro interactivité ; seule la tuile en a besoin, à cause de `Card`, et c'est elle qui le
// porte. Même raisonnement, même structure que `SeccionOfertas`.

export type IndiceCategoriasProps = {
  /** Déjà triées et déjà résolues — l'ordre vient de `lib/catalog/`, jamais d'ici. */
  categorias: CategoriaConOferta[];
  /** Déjà traduits — pour la seule tuile « Otras actividades », qui n'existe pas en base. */
  libellesSinTag: { nombre: string; descripcion: string };
  testId?: string;
};

// ⚠️ Classes écrites EN TOUTES LETTRES, jamais composées à la volée : Tailwind v4 scanne le TEXTE
// source, une classe fabriquée par interpolation n'est simplement pas générée et la grille
// s'affiche en une colonne sans que rien ne le signale.
//
// Mêmes points de rupture que `SeccionOfertas` et que `ListadoInfinito` — une seule règle de grille
// sur toute la vitrine, et c'est elle que `sizes` suit dans `TarjetaCategoria`.
const CLASES_GRILLA = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3";

export function IndiceCategorias({ categorias, libellesSinTag, testId }: IndiceCategoriasProps) {
  return (
    <ul className={CLASES_GRILLA} data-testid={testId}>
      {categorias.map((categoria, index) => (
        // La clé vient de la donnée, jamais de l'index : une recherche réordonne les tuiles, et
        // React réutiliserait les mauvaises.
        <li key={categoria.slug}>
          <TarjetaCategoria
            categoria={categoria}
            libellesSinTag={libellesSinTag}
            // ⚠️ UNE SEULE image prioritaire : la première tuile, c'est-à-dire le LCP. `prioridad`
            // sans le `index === 0` poserait autant de préchargements que de catégories, la plupart
            // sous la ligne de flottaison — exactement la régression Core Web Vitals que la prop
            // `loading` de l'atome `Image` existe pour éviter.
            prioridad={index === 0}
          />
        </li>
      ))}
    </ul>
  );
}
