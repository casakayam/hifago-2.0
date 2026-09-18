"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { toast } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";

// Bloc séparé du formulaire d'édition — même patron que EstablishmentTagsBlock.tsx : action
// distincte, sauvegarde immédiate par ajout/retrait, pas un champ de plus dans un submit.
//
// Copie littérale de `EstablishmentTagsBlock.tsx` — `catalog_amenities`/
// `establishment_amenity_assignments` au lieu de `catalog_tags`/`establishment_tag_assignments`.
// Un établissement est TOUJOURS éligible aux équipements (même raisonnement que les tags) : aucun
// gating par type ici.
//
// ⚠️ `allowCreate={false}` — LISTE FERMÉE (décision Jérôme du 2026-09-17, contrairement aux tags
// éditoriaux) : le référentiel `catalog_amenities` est peuplé uniquement par migration, jamais par
// un admin au quotidien. `TagsMultiSelect` désactive alors proprement la sentinelle « + Crear… »
// (vérifié en le lisant — `canCreate = allowCreate && …` court-circuite).
export function EstablishmentAmenitiesBlock({
  establishmentId,
  allAmenities,
  initialAmenityIds,
}: {
  establishmentId: string;
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
        .from("establishment_amenity_assignments")
        .insert(added.map((amenityId) => ({ establishment_id: establishmentId, amenity_id: amenityId })));
      if (insertError) {
        toast.danger("No se pudo añadir el equipamiento.");
        return;
      }
      toast.success("Equipamiento añadido.");
    }
    if (removed.length > 0) {
      const { error: deleteError } = await supabase
        .from("establishment_amenity_assignments")
        .delete()
        .eq("establishment_id", establishmentId)
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
