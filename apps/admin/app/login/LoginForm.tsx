"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";
import { GoogleButton } from "@/components/GoogleButton";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Feature 31 (docs/specs/07-connexion-inscription-complete.md §5) : un compte non confirmé
      // ne peut pas se connecter (enable_confirmations = true) — signInWithPassword échoue avec ce
      // code précis plutôt qu'un message générique, redirigé vers l'écran de renvoi d'email.
      if (signInError.code === "email_not_confirmed") {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setError("Correo electrónico o contraseña incorrectos.");
      setIsSubmitting(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <GoogleButton next={next} />

      <div className="flex items-center gap-3 text-xs text-muted" role="separator">
        <div className="h-px flex-1 bg-border" />
        o
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField name="email" value={email} onChange={setEmail} isRequired>
          <Label>Correo electrónico</Label>
          <Input type="email" autoComplete="email" />
        </TextField>
        <TextField name="password" value={password} onChange={setPassword} isRequired>
          <Label>Contraseña</Label>
          <Input type="password" autoComplete="current-password" />
        </TextField>
        <Link href="/forgot-password" className="self-start text-xs text-muted underline">
          ¿Olvidaste tu contraseña?
        </Link>
        {error ? (
          <p role="alert" data-testid="login-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={isSubmitting}>
          {isSubmitting ? "Iniciando…" : "Iniciar sesión"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        ¿No tienes cuenta?{" "}
        <Link href="/signup" className="underline">
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
