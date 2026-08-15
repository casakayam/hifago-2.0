"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (updateError) {
      setError("No se pudo restablecer la contraseña. Inténtalo de nuevo.");
      return;
    }

    // La session de récupération, une fois le mot de passe posé, est une session valide comme une
    // autre (docs/specs/07-connexion-inscription-complete.md §4) — pas de reconnexion à refaire.
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
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
      {error ? (
        <p role="alert" data-testid="reset-password-error" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting} data-testid="reset-password-submit">
        {isSubmitting ? "Guardando…" : "Restablecer contraseña"}
      </Button>
    </form>
  );
}
