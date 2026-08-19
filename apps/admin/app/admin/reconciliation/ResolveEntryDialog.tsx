"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, Modal, TextArea, TextField, toast } from "@hifago/ui";

// Même motif que ChangeStatusDialog (feature 10, apps/admin/app/admin/orders/ChangeStatusDialog.tsx) :
// dialogue contrôlé, motif obligatoire vérifié côté client (message immédiat) ET côté
// serveur (resolve_reconciliation_entry, feature 22), onSuccess/onOpenChange remontés au parent
// plutôt qu'un router.refresh() — la liste se met à jour par état local, pas par re-fetch complet.
export function ResolveEntryDialog({
  entryId,
  open,
  onOpenChange,
  onSuccess,
}: {
  entryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setNote("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Motif obligatoire — même exigence que set_order_line_status (feature 10) et
    // resolve_reconciliation_entry côté serveur (feature 22) : un message clair immédiat évite un
    // aller-retour réseau pour une erreur évidente.
    if (note.trim() === "") {
      toast.danger("El motivo es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("resolve_reconciliation_entry", {
      p_entry_id: entryId,
      p_note: note.trim(),
    });
    setIsSubmitting(false);

    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      toast.danger(rpcError?.message ?? "No se pudo resolver la entrada.");
      return;
    }

    toast.success("Entrada resuelta.");
    onSuccess();
    reset();
    onOpenChange(false);
  }

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={open}
        onOpenChange={(next) => {
          if (!next) reset();
          onOpenChange(next);
        }}
      >
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Resolver entrada</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Modal.Body className="flex flex-col gap-4">
                <TextField fullWidth isRequired value={note} onChange={setNote}>
                  <Label htmlFor="resolution-note">Motivo de la resolución</Label>
                  <TextArea id="resolution-note" name="resolution-note" data-testid="resolution-note-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-resolve-button">
                  {isSubmitting ? "Guardando…" : "Resolver"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
