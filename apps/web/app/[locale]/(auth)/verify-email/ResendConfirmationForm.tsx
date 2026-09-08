"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";

const COOLDOWN_SECONDS = 30;

// Adapté de apps/admin/app/verify-email/ResendConfirmationForm.tsx (encore vivant côté admin,
// même besoin ici) — cooldown côté UI en plus du rate-limit natif Supabase (max_frequency,
// config.toml), localisé via useTranslations.
export function ResendConfirmationForm({ email }: { email: string | null }) {
  const t = useTranslations("VerifyEmail");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => value - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Link href="/login" className="text-sm underline">
        {t("backToLogin")}
      </Link>
    );
  }

  async function handleResend() {
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email: email as string });
    if (error) {
      toast.danger(t("resendError"));
    } else {
      toast.success(t("resent"));
    }
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
        {cooldown > 0 ? t("resendCooldown", { seconds: cooldown }) : t("resend")}
      </Button>
      <Link href="/login" className="text-sm underline">
        {t("backToLogin")}
      </Link>
    </div>
  );
}
