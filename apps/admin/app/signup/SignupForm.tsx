"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { OAuthSection } from "@/components/GoogleButton";

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    setIsSubmitting(false);

    if (signUpError) {
      // Ni "email_exists" ni "user_already_exists" n'est traité comme un cas particulier ici —
      // Supabase répond volontairement de façon générique pour ne jamais confirmer l'existence
      // d'un compte (docs/specs/07-connexion-inscription-complete.md §3) ; seules les erreurs de
      // validation réelles (mot de passe trop faible, email invalide, rate-limit) remontent ici.
      toast.danger("No se pudo crear la cuenta. Verifica los datos e inténtalo de nuevo.");
      return;
    }

    // Un compte déjà confirmé (ex. lié automatiquement à une identité Google existante avec le
    // même email vérifié) peut recevoir une session immédiatement — sinon, confirmation requise.
    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
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
        <Button type="submit" isDisabled={isSubmitting} data-testid="signup-submit-button">
          {isSubmitting ? "Creando…" : "Crear cuenta"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="underline">
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
