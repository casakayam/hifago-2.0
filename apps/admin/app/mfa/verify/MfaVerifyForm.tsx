"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";

export function MfaVerifyForm({ factorId, next }: { factorId: string; next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="code" value={code} onChange={setCode} isRequired>
        <Label>Código de 6 dígitos</Label>
        <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus />
      </TextField>
      <Button type="submit" isDisabled={isSubmitting} data-testid="mfa-verify-submit">
        {isSubmitting ? "Verificando…" : "Verificar"}
      </Button>
    </form>
  );
}
