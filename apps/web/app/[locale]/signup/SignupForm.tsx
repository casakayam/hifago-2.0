"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { buildAuthCallbackRedirect } from "@hifago/domain";
import { Button, Input, Label, TextField } from "@hifago/ui";

// Adapté de l'ancien apps/admin/app/signup/SignupForm.tsx (git show bb254e9, supprimé depuis —
// périmètre closed pour l'admin, cf. supabase/config.toml §11.13/§11.14, sans rapport avec ici),
// SANS OAuthSection/Google (hors périmètre feature 32, décision Jérôme — cadrage "minimale") et
// localisé via useTranslations (apps/web est routé ES/EN, contrairement à apps/admin).
export function SignupForm({ next }: { next: string }) {
  const t = useTranslations("Signup");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    // emailRedirectTo absolu, locale déjà encodée dans `next` : ce lien part dans l'email de
    // confirmation (supabase/templates/confirmation.html, {{ .RedirectTo }}), une navigation
    // externe hors client-side router — jamais un chemin nu comme pour router.push ci-dessous.
    // buildAuthCallbackRedirect (@hifago/domain) : même contrat déjà écrit à la main 3 fois côté
    // apps/admin (GoogleButton.tsx, ForgotPasswordForm.tsx, EmailBlock.tsx) — extrait ici plutôt
    // que dupliqué une 4e fois.
    const emailRedirectTo = buildAuthCallbackRedirect({
      origin: window.location.origin,
      next: `/${locale}${next === "/" ? "" : next}`,
    });

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    setIsSubmitting(false);

    if (signUpError) {
      // Message générique (ni email_exists ni user_already_exists distingué) — même discipline
      // que l'ancien écran admin : ne jamais confirmer l'existence d'un compte par ce message.
      setError(t("genericError"));
      return;
    }

    // Compte déjà confirmé (ex. rare cas de lien automatique) : session immédiate, sinon
    // confirmation par email requise.
    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField name="email" value={email} onChange={setEmail} isRequired>
          <Label>{t("email")}</Label>
          <Input type="email" autoComplete="email" />
        </TextField>
        <TextField name="password" value={password} onChange={setPassword} isRequired>
          <Label>{t("password")}</Label>
          <Input type="password" autoComplete="new-password" minLength={6} />
        </TextField>
        <TextField
          name="confirm-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          isRequired
        >
          <Label>{t("confirmPassword")}</Label>
          <Input type="password" autoComplete="new-password" minLength={6} />
        </TextField>
        {error ? (
          <p role="alert" data-testid="signup-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={isSubmitting} data-testid="signup-submit-button">
          {isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        {t("loginLink")}{" "}
        <Link
          href={next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="underline"
        >
          {t("loginLinkAction")}
        </Link>
      </p>
    </div>
  );
}
