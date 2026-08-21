import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const response = intlMiddleware(request) ?? NextResponse.next();

  // Feature 7 (attribution) — 2e responsabilité de ce proxy : un ?ref=<code> sur n'importe quelle
  // page pose un cookie de session. Volontairement sans maxAge/expires : perdu à la fermeture de
  // l'onglet, cohérent avec « vaut pour la réservation en cours » pour un invité — la durabilité
  // pour un compte enregistré vit côté serveur dans partner_accounts.saved_attribution_code,
  // jamais dans ce cookie. Absent de la requête → cookie existant laissé tel quel (pas effacé),
  // pour survivre à une navigation ultérieure sans ?ref= jusqu'au checkout.
  const refCode = request.nextUrl.searchParams.get("ref");
  if (refCode) {
    response.cookies.set("hifago_ref", refCode, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }

  // Une URL sans préfixe de locale (ex. "/") reçoit déjà sa redirection 307/308 de
  // intlMiddleware ci-dessus — le navigateur va immédiatement la re-suivre et repasser par ce
  // proxy sur l'URL préfixée. Rafraîchir la session Supabase ici serait un aller-retour réseau
  // gaspillé pour une réponse dont le corps n'est jamais consommé.
  if (response.status === 307 || response.status === 308) {
    return response;
  }

  // Rafraîchit la session Supabase à chaque requête (pattern standard @supabase/ssr en
  // middleware) — sans ça, une session de connexion ne survit pas à la navigation côté serveur.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

// Cette app ne sert plus que la vitrine publique (app/[locale]) — admin/partner vivent désormais
// dans apps/admin, donc plus besoin d'exclure ces chemins de la préfixation de locale next-intl
// (l'ancien hack de cohabitation dans une seule app disparaît).
// Feature 32 : "auth" exclu comme "api" l'est déjà — sans ça, une requête vers le futur
// apps/web/app/auth/callback/route.ts (hors [locale]) serait interceptée par intlMiddleware
// (localePrefix "always", aucune locale dans /auth/callback) et redirigée vers /es/auth/callback
// (inexistant) avant même d'atteindre la route.
export const config = {
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
