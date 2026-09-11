import { createClient } from "@hifago/supabase/client";

// Extrait le 2026-09-11 (/simplify) : `LogoutButton.tsx` et `DeleteAccountSection.tsx` répétaient
// verbatim la même séquence. Colocalisé ici plutôt que remonté dans `lib/` : les deux seuls
// appelants vivent dans ce même dossier (components/README.md — on ne remonte que ce qui sert au
// moins deux ROUTES, pas deux fichiers d'un même écran).
export async function signOutAndGoHome(router: { push: (href: string) => void; refresh: () => void }) {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push("/");
  router.refresh();
}
