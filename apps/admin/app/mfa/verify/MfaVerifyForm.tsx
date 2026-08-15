"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";

export function MfaVerifyForm({ factorId, next }: { factorId: string; next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="code" value={code} onChange={setCode} isRequired>
        <Label>Código de 6 dígitos</Label>
        <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus />
      </TextField>
      {error ? (
        <p role="alert" data-testid="mfa-verify-error" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting} data-testid="mfa-verify-submit">
        {isSubmitting ? "Verificando…" : "Verificar"}
      </Button>
    </form>
  );
}
