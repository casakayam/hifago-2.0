// Feature 32 — même contrat déjà écrit à la main à 3 endroits (apps/admin/components/
// GoogleButton.tsx, apps/admin/app/forgot-password/ForgotPasswordForm.tsx, apps/admin/app/partner/
// (app)/account/EmailBlock.tsx) avant cette extraction. Centralisé ici car
// supabase/templates/confirmation.html construit son lien avec `{{ .RedirectTo }}&token_hash=...` —
// un `emailRedirectTo` sans query string déjà présente casserait ce lien silencieusement (retombe
// sur site_url nu, cf. commentaire du template). Fonction PURE : ne dépend que de l'API URL
// standard (disponible côté navigateur ET Node), pas du SDK Supabase.
export function buildAuthCallbackRedirect(params: { origin: string; next: string }): string {
  const url = new URL("/auth/callback", params.origin);
  url.searchParams.set("next", params.next);
  return url.toString();
}
