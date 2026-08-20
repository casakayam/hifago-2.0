"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Card, Input, Label, TextField, toast } from "@hifago/ui";

// double_confirm_changes = true (supabase/config.toml) : rien ne change tant que les DEUX
// adresses (ancienne et nouvelle) n'ont pas confirmé via /auth/callback (déjà géré, type
// "email_change" présent dans EMAIL_OTP_TYPES) — le message ci-dessous doit rester visible en
// permanence, pas seulement après soumission.
export function EmailBlock({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setIsSubmitting(true);
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", "/partner/account");
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: redirectTo.toString() }
    );
    setIsSubmitting(false);

    if (error) {
      toast.danger("No se pudo actualizar el correo. Inténtalo de nuevo.");
      return;
    }

    toast.success("Revisa tu correo actual y el nuevo para confirmar el cambio.");
  }

  return (
    <Card data-testid="email-block">
      <Card.Header>
        <Card.Title>Correo de acceso</Card.Title>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField name="email" value={email} onChange={setEmail} isRequired>
            <Label>Correo electrónico</Label>
            <Input type="email" autoComplete="email" data-testid="account-email-input" />
          </TextField>
          <p className="text-sm text-muted">
            El cambio no se aplica hasta confirmar los enlaces enviados a tu correo actual y al
            nuevo.
          </p>
          <Button
            type="submit"
            isDisabled={isSubmitting}
            data-testid="save-email-button"
            className="self-start"
          >
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      </Card.Content>
    </Card>
  );
}
