"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { OAuthSection } from "@/components/GoogleButton";

export function LoginForm({
  next,
  callbackError,
}: {
  next: string;
  callbackError?: "auth_callback_failed" | "google_signup_blocked";
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §5) : /auth/callback redirige ici
  // avec ?error= après un échec d'échange de code — un rendu serveur, donc le seul point où ce
  // toast peut se déclencher est le montage du client côté page de destination. React StrictMode
  // (dev uniquement) peut monter ce composant deux fois et donc déclencher ce toast deux fois —
  // sans effet en production, accepté tel quel (cf. hifago/CLAUDE.md §11).
  // "google_signup_blocked" (3e passe, même journée) : route.ts vient de supprimer un compte
  // fraîchement créé par Google en dehors du contexte /partner/join — message spécifique, jamais
  // le générique "lien invalide" qui ne veut rien dire ici (aucun lien/jeton n'était en jeu).
  useEffect(() => {
    if (callbackError === "google_signup_blocked") {
      toast.danger(
        "Ese Gmail no tiene cuenta todavía. Usa tu enlace de invitación para crear una, o inicia sesión con tu contraseña."
      );
    } else if (callbackError === "auth_callback_failed") {
      toast.danger("El enlace no es válido o ha expirado. Inténtalo de nuevo.");
    }
  }, [callbackError]);

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
      {/* Feature 31 — révision 2026-08-19 (3e passe) : bouton Google restauré ici. Un compte
          fraîchement créé par ce bouton hors contexte d'invitation est nettoyé après coup côté
          serveur (app/auth/callback/route.ts, "google_signup_blocked") plutôt que bloqué en amont
          — Google reste donc utilisable pour un retour de connexion (compte déjà existant, y
          compris un compte accepté via Google sur /partner/join), sans jamais rouvrir
          l'auto-inscription libre que ce bouton permettait avant. */}
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
    </div>
  );
}
