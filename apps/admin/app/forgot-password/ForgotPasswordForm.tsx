"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";

// Message toujours générique, y compris en cas d'erreur réseau/validation (docs/specs/
// 07-connexion-inscription-complete.md §3/§8) : jamais de confirmation ou d'infirmation de
// l'existence d'un compte pour cette adresse — même principe que POST /forgot en legacy (toujours
// 200).
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", "/reset-password");
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo.toString() });

    setIsSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted" data-testid="forgot-password-sent">
          Si existe una cuenta con ese correo, te enviamos un enlace para restablecer tu
          contraseña. Vale una hora y se usa una sola vez.
        </p>
        <Link href="/login" className="text-sm underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="email" value={email} onChange={setEmail} isRequired>
        <Label>Correo electrónico</Label>
        <Input type="email" autoComplete="email" />
      </TextField>
      <Button type="submit" isDisabled={isSubmitting} data-testid="forgot-password-submit">
        {isSubmitting ? "Enviando…" : "Enviar enlace"}
      </Button>
      <Link href="/login" className="self-center text-sm underline">
        Volver a iniciar sesión
      </Link>
    </form>
  );
}
