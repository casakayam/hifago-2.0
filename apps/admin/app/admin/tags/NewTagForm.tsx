"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { slugify } from "@/lib/utils";

export function NewTagForm() {
  const router = useRouter();
  const [labelEs, setLabelEs] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!labelEs.trim()) {
      toast.danger("El nombre de la etiqueta es obligatorio.");
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
      toast.danger(
        insertError.code === "23505"
          ? "Ya existe una etiqueta con ese nombre."
          : "No se pudo crear la etiqueta.",
      );
      return;
    }

    toast.success("Tag creado.");
    setLabelEs("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex items-end gap-4">
      <TextField fullWidth name="label-es" value={labelEs} onChange={setLabelEs} isRequired>
        <Label>Nueva etiqueta</Label>
        <Input id="label-es" data-testid="new-tag-input" />
      </TextField>
      <Button type="submit" isDisabled={isSubmitting} data-testid="create-tag-button">
        {isSubmitting ? "Creando…" : "Crear etiqueta"}
      </Button>
    </form>
  );
}
