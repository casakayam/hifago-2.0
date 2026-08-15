"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Modal } from "@hifago/ui";

// Mirroir de apps/admin/app/admin/invitations/RevokeInvitationButton.tsx — pattern déjà utilisé
// dans le projet pour une confirmation destructive (Modal + Button variant="danger"), pas
// AlertDialog (jamais consommé nulle part malgré sa présence dans @heroui/react).
export function DeleteTagButton({
  tagId,
  label,
  usageCount,
}: {
  tagId: string;
  label: string;
  usageCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDelete() {
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: deleteError } = await supabase.from("catalog_tags").delete().eq("id", tagId);

    setIsSubmitting(false);

    if (deleteError) {
      setError("No se pudo eliminar la etiqueta.");
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
        data-testid={`delete-tag-${tagId}`}
        className="text-sm font-medium text-danger hover:underline"
      >
        Eliminar
      </button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Eliminar etiqueta</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  {usageCount > 0
                    ? `"${label}" será retirada de ${usageCount} actividad${usageCount > 1 ? "es" : ""}. Esta acción no se puede deshacer.`
                    : `Esta acción no se puede deshacer.`}
                </p>
                {error ? (
                  <p role="alert" data-testid="delete-tag-error" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="danger"
                  isDisabled={isSubmitting}
                  onPress={handleDelete}
                  data-testid={`confirm-delete-tag-${tagId}`}
                >
                  {isSubmitting ? "Eliminando…" : "Eliminar"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
