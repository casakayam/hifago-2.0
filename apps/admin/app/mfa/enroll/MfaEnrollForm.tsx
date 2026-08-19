"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";

// data.totp.qr_code est déjà un SVG prêt à l'emploi renvoyé par Supabase (GoTrue le génère
// server-side) — pas de librairie QR côté client à installer, ce serait réinventer une roue que
// Supabase fournit déjà (docs/specs/07-connexion-inscription-complete.md §5).
export function MfaEnrollForm({ next }: { next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Distinct de la validation du code (toast seul, transitoire, réessayable) : un échec ici est
  // une panne au montage qui bloque tout l'écran (factorId ne sera jamais posé, "Activar" reste
  // désactivé pour toujours, rien ne relance l'appel) — le toast s'efface en 4s et laisse
  // l'utilisateur sur un écran mort sans explication ni instruction de secours. Message persistant
  // en plus du toast, même pattern que l'exception documentée docs/specs/16-notifications-toast.md
  // (cas limites) pour une erreur avec action de secours.
  const [enrollFailed, setEnrollFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.enroll({ factorType: "totp" }).then(({ data, error: enrollError }) => {
      if (enrollError || !data) {
        toast.danger("No se pudo generar el código QR. Recarga la página.");
        setEnrollFailed(true);
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
    });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    setIsSubmitting(false);

    if (verifyError) {
      toast.danger("Código incorrecto. Inténtalo de nuevo.");
      return;
    }

    toast.success("Verificación en dos pasos activada.");
    router.push(next);
    router.refresh();
  }

  if (enrollFailed) {
    return (
      <p role="alert" data-testid="mfa-enroll-error" className="text-sm text-danger">
        No se pudo generar el código QR. Recarga la página.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      {qrCode ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URI SVG renvoyé par Supabase, pas une image Storage à optimiser via next/image.
        <img src={qrCode} alt="Código QR de verificación en dos pasos" width={200} height={200} />
      ) : (
        <p className="text-sm text-muted">Generando código…</p>
      )}
      {secret ? (
        <p className="text-center text-xs text-muted">
          ¿No puedes escanear? Ingresa este código manualmente:{" "}
          <code className="font-mono" data-testid="mfa-secret">
            {secret}
          </code>
        </p>
      ) : null}
      <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
        <TextField name="code" value={code} onChange={setCode} isRequired>
          <Label>Código de 6 dígitos</Label>
          <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
        </TextField>
        <Button
          type="submit"
          isDisabled={isSubmitting || !factorId}
          data-testid="mfa-enroll-submit"
        >
          {isSubmitting ? "Verificando…" : "Activar"}
        </Button>
      </form>
    </div>
  );
}
