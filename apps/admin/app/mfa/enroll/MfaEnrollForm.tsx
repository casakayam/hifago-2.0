"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";

// data.totp.qr_code est déjà un SVG prêt à l'emploi renvoyé par Supabase (GoTrue le génère
// server-side) — pas de librairie QR côté client à installer, ce serait réinventer une roue que
// Supabase fournit déjà (docs/specs/07-connexion-inscription-complete.md §5).
export function MfaEnrollForm({ next }: { next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.enroll({ factorType: "totp" }).then(({ data, error: enrollError }) => {
      if (enrollError || !data) {
        setError("No se pudo generar el código QR. Recarga la página.");
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
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    setIsSubmitting(false);

    if (verifyError) {
      setError("Código incorrecto. Inténtalo de nuevo.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  if (error && !factorId) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
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
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
        <TextField name="code" value={code} onChange={setCode} isRequired>
          <Label>Código de 6 dígitos</Label>
          <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
        </TextField>
        {error ? (
          <p role="alert" data-testid="mfa-enroll-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
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
