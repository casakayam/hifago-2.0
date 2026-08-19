"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (password !== confirmPassword) {
      toast.danger("Las contraseñas no coinciden.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (updateError) {
      toast.danger("No se pudo restablecer la contraseña. Inténtalo de nuevo.");
      return;
    }

    toast.success("Contraseña actualizada.");

    // La session de récupération, une fois le mot de passe posé, est une session valide comme une
    // autre (docs/specs/07-connexion-inscription-complete.md §4) — pas de reconnexion à refaire.
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="password" value={password} onChange={setPassword} isRequired>
        <Label>Nueva contraseña</Label>
        <Input type="password" autoComplete="new-password" minLength={6} />
      </TextField>
      <TextField
        name="confirm-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        isRequired
      >
        <Label>Confirmar contraseña</Label>
        <Input type="password" autoComplete="new-password" minLength={6} />
      </TextField>
      <Button type="submit" isDisabled={isSubmitting} data-testid="reset-password-submit">
        {isSubmitting ? "Guardando…" : "Restablecer contraseña"}
      </Button>
    </form>
  );
}
