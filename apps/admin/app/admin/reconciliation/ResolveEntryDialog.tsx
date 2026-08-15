"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, Modal, TextArea } from "@hifago/ui";

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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setNote("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Motif obligatoire — même exigence que set_order_line_status (feature 10) et
    // resolve_reconciliation_entry côté serveur (feature 22) : un message clair immédiat évite un
    // aller-retour réseau pour une erreur évidente.
    if (note.trim() === "") {
      setError("El motivo es obligatorio.");
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
      setError(rpcError?.message ?? "No se pudo resolver la entrada.");
      return;
    }

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
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Modal.Body className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="resolution-note">Motivo de la resolución</Label>
                  <TextArea
                    id="resolution-note"
                    name="resolution-note"
                    required
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    data-testid="resolution-note-input"
                  />
                </div>
                {error ? (
                  <p role="alert" data-testid="resolve-dialog-error" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
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
