import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import type { AmenidadPorCategoria } from "./tipos";

// Regroupement + résolution de langue des équipements structurés (migration 20260917110000,
// décision Jérôme du 2026-09-17) — partagé entre `producto.ts` et `establecimiento.ts`, même
// discipline que `resolverPrecio`/`resolverModoReserva` de `tipos.ts` : fonction pure, testable
// isolément, JAMAIS dupliquée entre les deux couches de données.
//
// ⚠️ C'est ICI, et seulement ici, que `resolveLocalizedField`/`asLocalizedField` interviennent
// pour ce domaine : la résolution de langue vit dans la couche de données, jamais dans un
// composant (`.claude/rules/apps.md`).

/** La forme brute d'une ligne d'assignation jointe à son équipement et sa catégorie — le shape
 *  exact que renvoie la jointure emboîtée `amenity:catalog_amenities(label, category:…)`. */
export type FilaAmenidad = {
  amenity: {
    label: unknown;
    sort_order: number;
    category: { label: unknown; sort_order: number } | null;
  } | null;
};

export function agruparAmenidadesPorCategoria(
  filas: FilaAmenidad[],
  locale: string
): AmenidadPorCategoria[] {
  const porCategoria = new Map<string, { orden: number; items: { orden: number; texto: string }[] }>();

  for (const fila of filas) {
    const amenity = fila.amenity;
    if (!amenity?.category) continue;

    const categoria = resolveLocalizedField(asLocalizedField(amenity.category.label), locale);
    const item = resolveLocalizedField(asLocalizedField(amenity.label), locale);
    // Une catégorie ou un libellé qui ne résout à rien dans aucune langue (donnée corrompue) est
    // ignoré plutôt que d'afficher une case vide — même philosophie que `stayRatesFromColumn`
    // côté admin : une donnée illisible n'est jamais une raison de faire planter la fiche.
    if (!categoria || !item) continue;

    const entree = porCategoria.get(categoria) ?? { orden: amenity.category.sort_order, items: [] };
    entree.items.push({ orden: amenity.sort_order, texto: item });
    porCategoria.set(categoria, entree);
  }

  return [...porCategoria.entries()]
    .sort((a, b) => a[1].orden - b[1].orden)
    .map(([categoria, { items }]) => ({
      categoria,
      items: items.sort((a, b) => a.orden - b.orden).map((i) => i.texto),
    }));
}
