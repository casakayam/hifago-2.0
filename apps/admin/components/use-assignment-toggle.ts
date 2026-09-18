"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { toast } from "@hifago/ui";

// Extrait du patron dupliqué 4× (revue de packaging admin, 2026-09-17) : state local + insert/
// delete sur une table de jointure + 2 toasts — EstablishmentTagsBlock.tsx, ProductTagsBlock.tsx,
// EstablishmentAmenitiesBlock.tsx (déjà documenté par son auteur comme "copie littérale" de
// EstablishmentTagsBlock.tsx), ProductAmenitiesBlock.tsx. Hook plutôt qu'un composant générique
// unique : un composant générique aurait obligé les 4 points d'appel à passer un nom de table en
// chaîne de caractères à la place d'un composant nommé explicitement — perte de lisibilité au call
// site pour un gain marginal. Les 4 fichiers gardent leur nom, leurs props externes, leur
// emplacement ; chacun devient un wrapper qui appelle ce hook puis rend `<TagsMultiSelect />`.
export function useAssignmentToggle({
  table,
  entityIdColumn,
  assignedIdColumn,
  entityId,
  initialAssignedIds,
  addedMessage,
  removedMessage,
  addErrorMessage,
  removeErrorMessage,
}: {
  table:
    | "product_tag_assignments"
    | "product_amenity_assignments"
    | "establishment_tag_assignments"
    | "establishment_amenity_assignments";
  entityIdColumn: "product_id" | "establishment_id";
  assignedIdColumn: "tag_id" | "amenity_id";
  entityId: string;
  initialAssignedIds: string[];
  addedMessage: string;
  removedMessage: string;
  addErrorMessage: string;
  removeErrorMessage: string;
}): { selectedIds: string[]; handleChange: (nextIds: string[]) => Promise<void> } {
  const [selectedIds, setSelectedIds] = useState(initialAssignedIds);

  async function handleChange(nextIds: string[]) {
    const supabase = createClient();
    const added = nextIds.filter((id) => !selectedIds.includes(id));
    const removed = selectedIds.filter((id) => !nextIds.includes(id));

    // `table` est une union des 4 tables de jointure possibles : le client Supabase typé exige
    // alors une forme satisfaisant les 4 tables À LA FOIS (contravariance sur `.from()` lui-même,
    // pas seulement sur `.insert()`) — aucun objet ni cast en aval ne peut satisfaire ça. La seule
    // vraie garantie vient de la construction de `table`/`entityIdColumn`/`assignedIdColumn`
    // TOUJOURS en triplet cohérent par le fichier appelant (les 4 wrappers ne les mélangent
    // jamais) : `.from(table)` lui-même est donc le bord du cast, même convention que
    // `productCreationPayload.ts`/`productEditPayload.ts` (Record<string, unknown> →
    // TablesInsert<"products">) mais appliquée un cran plus tôt puisque c'est la table, pas
    // seulement la ligne, qui est dynamique ici.
    const query = supabase.from(table as never);

    if (added.length > 0) {
      const rows = added.map((assignedId) => ({ [entityIdColumn]: entityId, [assignedIdColumn]: assignedId }));
      const { error: insertError } = await query.insert(rows as never[]);
      if (insertError) {
        toast.danger(addErrorMessage);
        return;
      }
      toast.success(addedMessage);
    }
    if (removed.length > 0) {
      const { error: deleteError } = await query
        .delete()
        .eq(entityIdColumn, entityId)
        .in(assignedIdColumn, removed);
      if (deleteError) {
        toast.danger(removeErrorMessage);
        return;
      }
      toast.success(removedMessage);
    }
    setSelectedIds(nextIds);
  }

  return { selectedIds, handleChange };
}
