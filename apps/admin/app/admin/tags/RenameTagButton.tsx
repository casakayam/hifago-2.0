"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, Modal, TextField } from "@hifago/ui";
import { slugify } from "@/lib/utils";

export function RenameTagButton({ tagId, currentLabel }: { tagId: string; currentLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [labelEs, setLabelEs] = useState(currentLabel);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRename() {
    setError(null);

    if (!labelEs.trim()) {
      setError("El nombre de la etiqueta es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("catalog_tags")
      .update({ label: { es: labelEs.trim() }, slug: slugify(labelEs) })
      .eq("id", tagId);

    setIsSubmitting(false);

    if (updateError) {
      setError(
        updateError.code === "23505"
          ? "Ya existe una etiqueta con ese nombre."
          : "No se pudo renombrar la etiqueta.",
      );
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLabelEs(currentLabel);
          setError(null);
          setOpen(true);
        }}
        data-testid={`rename-tag-${tagId}`}
        className="text-sm font-medium text-foreground hover:underline"
      >
        Editar
      </button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Renombrar etiqueta</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <TextField fullWidth value={labelEs} onChange={setLabelEs} isRequired>
                  <Label>Nombre</Label>
                  <Input data-testid="rename-tag-input" />
                </TextField>
                {error ? (
                  <p role="alert" data-testid="rename-tag-error" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  isDisabled={isSubmitting}
                  onPress={handleRename}
                  data-testid={`confirm-rename-tag-${tagId}`}
                >
                  {isSubmitting ? "Guardando…" : "Guardar"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
