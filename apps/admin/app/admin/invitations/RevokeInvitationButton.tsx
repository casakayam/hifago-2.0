"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Modal } from "@hifago/ui";

// Même motif que ResolveEntryDialog.tsx (reconciliation) : dialogue contrôlé, RPC dédiée. Pas de
// callback onSuccess remonté à un parent avec état local — page.tsx (Server Component) n'a pas
// d'état à faire évoluer, router.refresh() suffit à relire la liste avec le nouveau statut.
export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRevoke() {
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("revoke_partner_invitation", {
      p_invitation_id: invitationId,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      setError("No se pudo revocar la invitación.");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`revoke-invitation-${invitationId}`}
        className="text-sm font-medium text-danger hover:underline"
      >
        Revocar
      </button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Revocar invitación</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  El enlace dejará de funcionar. Esta acción no se puede deshacer.
                </p>
                {error ? (
                  <p role="alert" data-testid="revoke-invitation-error" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="danger"
                  isDisabled={isSubmitting}
                  onPress={handleRevoke}
                  data-testid="confirm-revoke-button"
                >
                  {isSubmitting ? "Revocando…" : "Revocar"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
