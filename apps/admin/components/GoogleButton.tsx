"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@hifago/ui";

// Flux redirect (pas popup) — bonne pratique Supabase Auth (docs/specs/
// 07-connexion-inscription-complete.md §3) : Google redirige vers l'URL de callback Supabase
// (déclarée côté Google Cloud Console), qui redirige ensuite vers /auth/callback (Route Handler,
// exchangeCodeForSession). `next` survit au aller-retour via le paramètre de redirectTo — jamais
// dans un state client, perdu au retour d'un domaine tiers.
export function GoogleButton({ next = "/" }: { next?: string }) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  async function handleClick() {
    setIsRedirecting(true);
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });

    if (error) {
      setIsRedirecting(false);
    }
    // Pas de redirection manuelle en cas de succès : signInWithOAuth navigue déjà le navigateur
    // vers Google lui-même.
  }

  return (
    <Button
      type="button"
      variant="outline"
      fullWidth
      isDisabled={isRedirecting}
      onPress={handleClick}
      data-testid="google-signin-button"
    >
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" className="shrink-0">
        <path
          fill="#EA4335"
          d="M24 9.5c3.4 0 6.4 1.2 8.8 3.5l6.6-6.6C35.3 2.5 30 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.7 6c1.9-5.7 7.2-9.7 13.8-9.7z"
        />
        <path
          fill="#4285F4"
          d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.4-4.6 7.1l7.4 5.7c4.3-4 6.8-9.9 6.8-17.3z"
        />
        <path
          fill="#FBBC05"
          d="M10.2 19.2 2.5 13.2C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.8l7.8-6c-.5-1.5-.8-3-.8-4.8s.3-3.3.7-4.8z"
        />
        <path
          fill="#34A853"
          d="M24 48c6 0 11.3-2 15-5.4l-7.4-5.7c-2 1.4-4.6 2.2-7.6 2.2-6.6 0-11.9-4-13.8-9.7l-7.7 6C6.5 42.6 14.6 48 24 48z"
        />
      </svg>
      {isRedirecting ? "Redirigiendo…" : "Continuar con Google"}
    </Button>
  );
}
