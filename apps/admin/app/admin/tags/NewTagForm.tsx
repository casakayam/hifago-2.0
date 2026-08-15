"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";
import { slugify } from "@/lib/utils";

export function NewTagForm() {
  const router = useRouter();
  const [labelEs, setLabelEs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!labelEs.trim()) {
      setError("El nombre de la etiqueta es obligatorio.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("catalog_tags").insert({
      label: { es: labelEs.trim() },
      slug: slugify(labelEs),
    });

    setIsSubmitting(false);

    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "Ya existe una etiqueta con ese nombre."
          : "No se pudo crear la etiqueta.",
      );
      return;
    }

    setLabelEs("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-4">
      <TextField fullWidth name="label-es" value={labelEs} onChange={setLabelEs} isRequired>
        <Label>Nueva etiqueta</Label>
        <Input id="label-es" data-testid="new-tag-input" />
      </TextField>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting} data-testid="create-tag-button">
        {isSubmitting ? "Creando…" : "Crear etiqueta"}
      </Button>
    </form>
  );
}
