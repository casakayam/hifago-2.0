"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Card, Input, Label, TextField, toast } from "@hifago/ui";

export function ProfileBlock({
  initialFullName,
  initialPhone,
}: {
  initialFullName: string;
  initialPhone: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDirty = fullName !== initialFullName || phone !== initialPhone;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!fullName.trim()) {
      toast.danger("El nombre es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_my_account_profile", {
      p_full_name: fullName.trim(),
      p_phone: phone.trim() || undefined,
    });
    setIsSubmitting(false);

    if (error) {
      toast.danger("No se pudo actualizar tu perfil. Inténtalo de nuevo.");
      return;
    }

    toast.success("Perfil actualizado.");
    router.refresh();
  }

  return (
    <Card data-testid="profile-block">
      <Card.Header>
        <Card.Title>Nombre y WhatsApp</Card.Title>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField name="full-name" value={fullName} onChange={setFullName} isRequired>
            <Label>Nombre completo</Label>
            <Input autoComplete="name" data-testid="profile-full-name-input" />
          </TextField>
          <TextField name="phone" value={phone} onChange={setPhone}>
            <Label>WhatsApp</Label>
            <Input
              type="tel"
              autoComplete="tel"
              placeholder="+57 300 1234567"
              data-testid="profile-phone-input"
            />
          </TextField>
          <Button
            type="submit"
            isDisabled={isSubmitting || !isDirty}
            data-testid="save-profile-button"
            className="self-start"
          >
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      </Card.Content>
    </Card>
  );
}
