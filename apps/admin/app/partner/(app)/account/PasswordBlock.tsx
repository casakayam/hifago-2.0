"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Card, Input, Label, TextField, toast } from "@hifago/ui";

// Même appel que ResetPasswordForm.tsx (secure_password_change = false dans supabase/config.toml
// — pas de ré-authentification requise), mais reste sur /partner/account au lieu de rediriger.
export function PasswordBlock() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDirty = password !== "" || confirmPassword !== "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (password !== confirmPassword) {
      toast.danger("Las contraseñas no coinciden.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (error) {
      toast.danger("No se pudo actualizar la contraseña. Inténtalo de nuevo.");
      return;
    }

    toast.success("Contraseña actualizada.");
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <Card data-testid="password-block">
      <Card.Header>
        <Card.Title>Contraseña</Card.Title>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField name="password" value={password} onChange={setPassword} isRequired>
            <Label>Nueva contraseña</Label>
            <Input
              type="password"
              autoComplete="new-password"
              minLength={6}
              data-testid="account-password-input"
            />
          </TextField>
          <TextField
            name="confirm-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            isRequired
          >
            <Label>Confirmar contraseña</Label>
            <Input
              type="password"
              autoComplete="new-password"
              minLength={6}
              data-testid="account-confirm-password-input"
            />
          </TextField>
          <Button
            type="submit"
            isDisabled={isSubmitting || !isDirty}
            data-testid="save-password-button"
            className="self-start"
          >
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      </Card.Content>
    </Card>
  );
}
