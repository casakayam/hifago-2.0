"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { toast } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";

// Bloc séparé du formulaire d'édition — même patron que ProductTagsBlock.tsx/ProductStatusBlock.tsx :
// action distincte, sauvegarde immédiate par ajout/retrait, pas un champ de plus dans le submit
// principal d'EditProductForm.
//
// Copie littérale de `ProductTagsBlock.tsx` — `catalog_amenities`/`product_amenity_assignments` au
// lieu de `catalog_tags`/`product_tag_assignments`. Monté uniquement quand `hasAmenities` (lodging),
// cf. `productTypeGating.ts` et `page.tsx`.
//
// ⚠️ `allowCreate={false}` — LISTE FERMÉE, même raison que EstablishmentAmenitiesBlock.tsx.
export function ProductAmenitiesBlock({
  productId,
  allAmenities,
  initialAmenityIds,
}: {
  productId: string;
  allAmenities: TagOption[];
  initialAmenityIds: string[];
}) {
  const [selectedAmenityIds, setSelectedAmenityIds] = useState(initialAmenityIds);

  async function handleChange(nextIds: string[]) {
    const supabase = createClient();
    const added = nextIds.filter((id) => !selectedAmenityIds.includes(id));
    const removed = selectedAmenityIds.filter((id) => !nextIds.includes(id));

    if (added.length > 0) {
      const { error: insertError } = await supabase
        .from("product_amenity_assignments")
        .insert(added.map((amenityId) => ({ product_id: productId, amenity_id: amenityId })));
      if (insertError) {
        toast.danger("No se pudo añadir el equipamiento.");
        return;
      }
      toast.success("Equipamiento añadido.");
    }
    if (removed.length > 0) {
      const { error: deleteError } = await supabase
        .from("product_amenity_assignments")
        .delete()
        .eq("product_id", productId)
        .in("amenity_id", removed);
      if (deleteError) {
        toast.danger("No se pudo quitar el equipamiento.");
        return;
      }
      toast.success("Equipamiento quitado.");
    }
    setSelectedAmenityIds(nextIds);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <TagsMultiSelect
        availableTags={allAmenities}
        selectedTagIds={selectedAmenityIds}
        onChange={handleChange}
        allowCreate={false}
        label="Equipamiento"
        placeholder="Buscar equipamiento…"
        emptyMessage="Ningún equipamiento disponible."
        testId="amenities-multiselect"
      />
    </div>
  );
}
