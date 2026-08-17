"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";

// Bloc séparé du formulaire d'édition — même patron que ProductStatusBlock.tsx/
// ProductPhotosBlock.tsx : action distincte, sauvegarde immédiate par ajout/retrait, pas un champ
// de plus dans le submit principal d'EditProductForm.
export function ProductTagsBlock({
  productId,
  allTags,
  initialTagIds,
}: {
  productId: string;
  allTags: TagOption[];
  initialTagIds: string[];
}) {
  const [selectedTagIds, setSelectedTagIds] = useState(initialTagIds);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(nextIds: string[]) {
    setError(null);
    const supabase = createClient();
    const added = nextIds.filter((id) => !selectedTagIds.includes(id));
    const removed = selectedTagIds.filter((id) => !nextIds.includes(id));

    if (added.length > 0) {
      const { error: insertError } = await supabase
        .from("product_tag_assignments")
        .insert(added.map((tagId) => ({ product_id: productId, tag_id: tagId })));
      if (insertError) {
        setError("No se pudo añadir el tag.");
        return;
      }
    }
    if (removed.length > 0) {
      const { error: deleteError } = await supabase
        .from("product_tag_assignments")
        .delete()
        .eq("product_id", productId)
        .in("tag_id", removed);
      if (deleteError) {
        setError("No se pudo quitar el tag.");
        return;
      }
    }
    setSelectedTagIds(nextIds);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <TagsMultiSelect
        availableTags={allTags}
        selectedTagIds={selectedTagIds}
        onChange={handleChange}
        testId="tags-multiselect"
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
