import { NextResponse } from "next/server";
import { createClient } from "@hifago/supabase/server";
import { resolveOrigin } from "@hifago/domain";

const EMAIL_OTP_TYPES = ["signup", "recovery", "email_change", "invite", "email"] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return EMAIL_OTP_TYPES.includes(value as EmailOtpType);
}

// Sous-ensemble simplifié de apps/admin/app/auth/callback/route.ts (feature 32) : point
// d'atterrissage pour la confirmation d'inscription client (verifyOtp, token_hash construit par
// supabase/templates/confirmation.html via {{ .RedirectTo }}) — et pour un futur flux OAuth
// (exchangeCodeForSession), non utilisé aujourd'hui côté apps/web (pas de Google ici, hors
// périmètre feature 32). PAS de nettoyage de compte fantôme ni de garde MFA/AAL2 : les deux sont
// spécifiques à is_admin()/AAL2 (admin uniquement) — un client n'a ni capacité ni 2FA à vérifier.
// Route Handler (pas une Server Action) : seul un vrai handler de requête écrit les cookies de
// session sur la réponse de redirection. Hors [locale] (comme app/api/*) — apps/web/proxy.ts
// exclut explicitement "auth" de son matcher pour que cette route ne soit jamais interceptée par
// le middleware next-intl.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  // Jamais une redirection ouverte : uniquement un chemin relatif propre au site.
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";
  // Même piège que api/payments/create/route.ts (feature 32) : request.url seul retombe sur
  // l'adresse locale du serveur derrière un reverse proxy/tunnel — X-Forwarded-Host prime.
  const origin = resolveOrigin({
    requestUrl: request.url,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
  });

  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && isEmailOtpType(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing_code_or_token_hash") };

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_callback_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
