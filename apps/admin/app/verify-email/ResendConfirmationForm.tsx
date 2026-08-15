"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@hifago/ui";

const COOLDOWN_SECONDS = 30;

// Cooldown côté UI (docs/specs/07-connexion-inscription-complete.md §9) en plus du rate-limit
// natif de Supabase (max_frequency, config.toml) — évite un aller-retour réseau pour un clic
// répété évident, pas un remplacement du rate-limit serveur.
export function ResendConfirmationForm({ email }: { email: string | null }) {
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => value - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Link href="/login" className="text-sm underline">
        Volver a iniciar sesión
      </Link>
    );
  }

  async function handleResend() {
    setStatus("idle");
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email: email as string });
    setStatus(error ? "error" : "sent");
    setCooldown(COOLDOWN_SECONDS);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="outline"
        isDisabled={cooldown > 0}
        onPress={handleResend}
        data-testid="resend-confirmation-button"
      >
        {cooldown > 0 ? `Reenviar correo (${cooldown}s)` : "Reenviar correo"}
      </Button>
      {status === "sent" ? (
        <p role="status" className="text-sm text-success">
          Correo reenviado.
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          No se pudo reenviar el correo. Inténtalo de nuevo en unos segundos.
        </p>
      ) : null}
      <Link href="/login" className="text-sm underline">
        Volver a iniciar sesión
      </Link>
    </div>
  );
}
