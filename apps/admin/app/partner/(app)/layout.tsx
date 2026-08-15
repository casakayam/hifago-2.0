import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { PartnerNav } from "./PartnerNav";

// Feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md) : première garde et
// première nav communes à /partner — jusqu'ici chaque écran (commissions/products/tools)
// dupliquait sa propre garde dans un layout.tsx scopé (elles restent en place, redondantes mais
// inoffensives, cf. spec §10) sans aucune nav partagée. Route group `(app)` : isole ces écrans
// authentifiés de `/partner/join`, qui doit rester accessible sans session (un invité n'est pas
// encore connecté quand il ouvre son lien) — `join/` est un répertoire frère, hors de ce groupe,
// jamais concerné par cette garde.
export default async function PartnerAppLayout({ children }: LayoutProps<"/partner">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner");
  }

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : 2FA rendu optionnel le
  // 2026-08-15 (décision Jérôme) — plus de redirection forcée depuis ce layout.

  return (
    <div className="flex min-h-screen w-full">
      <PartnerNav />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">{children}</div>
    </div>
  );
}
