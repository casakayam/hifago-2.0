"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@hifago/ui";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { toSlotRuleRows, validateSlotRules, type DraftSlotRule } from "@/lib/products/slotRules";

// Bloc séparé du formulaire d'édition — même patron que ProductTagsBlock.tsx : action distincte,
// sauvegarde immédiate, pas un champ de plus dans le submit principal de ProductForm. Contrairement
// aux tags (ajout/retrait incrémental), le jeu de règles est édité comme un tout : "Guardar
// horarios" remplace toutes les lignes existantes par l'état courant (pas de diff ligne-à-ligne,
// plus simple et suffisant pour le volume attendu — quelques règles par activité).
export function ProductSlotRulesBlock({
  productId,
  initialRules,
}: {
  productId: string;
  initialRules: DraftSlotRule[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);

    const validationError = validateSlotRules(rules);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("product_slot_rules")
      .delete()
      .eq("product_id", productId);
    if (deleteError) {
      setError("No se pudo guardar los horarios.");
      setIsSaving(false);
      return;
    }

    if (rules.length > 0) {
      const rows = toSlotRuleRows(rules).map((row) => ({ product_id: productId, ...row }));
      const { error: insertError } = await supabase.from("product_slot_rules").insert(rows);
      if (insertError) {
        setError("No se pudo guardar los horarios.");
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    setSaved(true);
  }

  return (
    <div className="rounded-lg border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Horarios</h2>
      <SlotRulesEditor rules={rules} onChange={setRules} />
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          isDisabled={isSaving}
          onPress={handleSave}
          data-testid="save-slot-rules-button"
        >
          {isSaving ? "Guardando…" : "Guardar horarios"}
        </Button>
        {saved ? <span className="text-xs text-muted">Guardado.</span> : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
