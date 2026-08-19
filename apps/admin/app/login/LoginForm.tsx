"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { OAuthSection } from "@/components/GoogleButton";

export function LoginForm({ next, hasCallbackError = false }: { next: string; hasCallbackError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §5) : /auth/callback redirige ici
  // avec ?error= après un échec d'échange de code — un rendu serveur, donc le seul point où ce
  // toast peut se déclencher est le montage du client côté page de destination. React StrictMode
  // (dev uniquement) peut monter ce composant deux fois et donc déclencher ce toast deux fois —
  // sans effet en production, accepté tel quel (cf. hifago/CLAUDE.md §11).
  useEffect(() => {
    if (hasCallbackError) {
      toast.danger("El enlace no es válido o ha expirado. Inténtalo de nuevo.");
    }
  }, [hasCallbackError]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
      toast.danger("Correo electrónico o contraseña incorrectos.");
      setIsSubmitting(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <OAuthSection next={next} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
