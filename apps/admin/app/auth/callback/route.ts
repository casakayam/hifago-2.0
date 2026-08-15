import { NextResponse } from "next/server";
import { createClient } from "@hifago/supabase/server";
import { checkMfaGuard } from "@/lib/mfaGuard";

const EMAIL_OTP_TYPES = ["signup", "recovery", "email_change", "invite", "email"] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return EMAIL_OTP_TYPES.includes(value as EmailOtpType);
}

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §5) — point d'atterrissage unique
// pour deux flux distincts : l'échange de code OAuth Google (exchangeCodeForSession) et la
// vérification des liens email construits avec {{ .TokenHash }} (verifyOtp), jamais le
// {{ .ConfirmationURL }} par défaut de Supabase (vulnérable au pré-fetch des scanners d'email).
// Route Handler, jamais une Server Action : seul un vrai handler de requête peut écrire les cookies
// de session sur la réponse de redirection.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  // Jamais une redirection ouverte : uniquement un chemin relatif propre au site, même garde que
  // login/page.tsx.
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && isEmailOtpType(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing_code_or_token_hash") };

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_callback_failed", url.origin));
  }

  // 2FA admin déclenchée à la connexion elle-même (§8) — un compte admin qui vient de confirmer
  // son email ou de se connecter via Google n'échappe pas à l'AAL2.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const mfa = await checkMfaGuard(supabase, user.id);
    if (mfa.action === "enroll") {
      return NextResponse.redirect(
        new URL(`/mfa/enroll?next=${encodeURIComponent(next)}`, url.origin)
      );
    }
    if (mfa.action === "verify") {
      return NextResponse.redirect(
        new URL(`/mfa/verify?next=${encodeURIComponent(next)}`, url.origin)
      );
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
