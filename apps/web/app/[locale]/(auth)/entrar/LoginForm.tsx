"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
// ⚠️ `useRouter` vient d'`@/i18n/navigation`, JAMAIS de `next/navigation` (contrôlé par
// scripts/check-i18n-links.sh depuis le 2026-09-07). `localePrefix: "always"` : le routeur nu
// pousse `/pago`, un chemin qui n'existe pas — le proxy le rattrape par une redirection qui
// redevine la langue depuis un cookie au lieu de garder celle de la page lue. Rien ne casse
// visiblement, et c'est bien le problème.
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField } from "@hifago/ui";

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("Login");
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
      setError(t("error"));
      setIsSubmitting(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="email" value={email} onChange={setEmail} isRequired>
        <Label>{t("email")}</Label>
        <Input type="email" autoComplete="email" />
      </TextField>
      <TextField name="password" value={password} onChange={setPassword} isRequired>
        <Label>{t("password")}</Label>
        <Input type="password" autoComplete="current-password" />
      </TextField>
      {error ? (
        <p role="alert" data-testid="login-error" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting}>
        {isSubmitting ? t("submitting") : t("submit")}
      </Button>

      {/* Un client n'a besoin d'aucune capacité pour exister (contrairement à admin, où le
          point d'entrée self-service a été retiré le 2026-08-19 — décision propre à ce
          contexte-là, sans rapport ici) — lien discret vers l'inscription, jamais mis en avant. */}
      <p className="text-center text-sm text-muted">
        <Link
          href={next !== "/" ? `/registro?next=${encodeURIComponent(next)}` : "/registro"}
          className="underline"
        >
          {t("signupLink")}
        </Link>
      </p>
    </form>
  );
}
